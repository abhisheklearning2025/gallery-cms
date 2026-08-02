'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import bcrypt from 'bcryptjs';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { drainStorageDeletions } from '@/lib/storage-cleanup';
import { galleryTag } from '@/lib/gallery-data';
import { slugify, validateSlug, slugProblemMessage } from '@/lib/slug';
import type { GalleryRow } from '@/lib/types';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

async function currentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/admin/login');
  return user;
}

async function owned(id: string, userId: string): Promise<GalleryRow> {
  const { data } = await supabaseAdmin()
    .from('galleries')
    .select('*')
    .eq('id', id)
    .maybeSingle<GalleryRow>();
  if (!data || data.owner_id !== userId) redirect('/admin');
  return data;
}

// ── login / logout ──────────────────────────────────────────────────────────

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/admin');

  if (!email || !password) return { error: 'Email and password are both required.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return {
      error:
        error.message === 'Invalid login credentials'
          ? 'That email and password don’t match.'
          : error.message,
    };
  }

  redirect((next.startsWith('/admin') ? next : '/admin') as Route);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/admin/login');
}

// ── galleries ───────────────────────────────────────────────────────────────

export async function createGallery(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await currentUser();

  const title = String(formData.get('title') ?? '').trim() || 'Untitled gallery';
  const tagline = String(formData.get('tagline') ?? '').trim() || 'drag to explore';
  const requested = String(formData.get('slug') ?? '').trim().toLowerCase();
  const slug = requested || slugify(title);

  const problem = validateSlug(slug);
  if (problem) return { error: `That link won’t work. ${slugProblemMessage(problem)}` };

  const { data, error } = await supabaseAdmin()
    .from('galleries')
    .insert({
      owner_id: user.id,
      slug,
      title,
      tagline,
      accent: String(formData.get('accent') ?? '#5A6CFF'),
      bg: String(formData.get('bg') ?? '#0E0E11'),
      visibility: (formData.get('visibility') as string) || 'public',
      status: 'draft',
    })
    .select('id')
    .single<{ id: string }>();

  if (error) {
    if (error.message.includes('galleries_slug_key')) {
      return { error: `“${slug}” is already taken — pick another link.` };
    }
    if (error.message.startsWith('SLUG_RESERVED')) {
      return { error: `“${slug}” is reserved by the app. Try “${slug}-gallery”.` };
    }
    return { error: error.message };
  }

  redirect(`/admin/g/${data.id}/media` as Route);
}

export async function updateGallery(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await currentUser();
  const id = String(formData.get('id') ?? '');
  const gallery = await owned(id, user.id);

  const patch: Record<string, unknown> = {};

  const title = formData.get('title');
  if (title !== null) patch.title = String(title).trim() || 'Untitled gallery';

  const tagline = formData.get('tagline');
  if (tagline !== null) patch.tagline = String(tagline).trim() || 'drag to explore';

  for (const key of ['accent', 'bg'] as const) {
    const v = formData.get(key);
    if (v !== null) patch[key] = String(v);
  }

  for (const key of ['drift_speed', 'density'] as const) {
    const v = formData.get(key);
    if (v !== null) patch[key] = Number(v);
  }

  const showFilters = formData.get('show_filters');
  if (showFilters !== null) patch.show_filters = showFilters === 'on' || showFilters === 'true';

  // ── slug is immutable by default after publish (§7) ─────────────────────
  const newSlug = formData.get('slug');
  if (newSlug !== null) {
    const slug = String(newSlug).trim().toLowerCase();
    if (slug !== gallery.slug) {
      const confirmed = formData.get('confirm_slug_change') === 'true';
      if (gallery.status === 'published' && !confirmed) {
        return {
          error:
            'This gallery is live. Changing the link breaks every URL already shared — confirm the change first.',
        };
      }
      const problem = validateSlug(slug);
      if (problem) return { error: `That link won’t work. ${slugProblemMessage(problem)}` };
      patch.slug = slug;
    }
  }

  // ── visibility / password ────────────────────────────────────────────────
  const visibility = formData.get('visibility');
  if (visibility !== null) {
    const v = String(visibility) as GalleryRow['visibility'];
    const password = String(formData.get('password') ?? '');

    if (v === 'password') {
      if (password) patch.password_hash = await bcrypt.hash(password, 10);
      else if (!gallery.password_hash) {
        return { error: 'Set a password before switching this gallery to password-protected.' };
      }
    } else {
      patch.password_hash = null;
    }
    patch.visibility = v;
  }

  const { error } = await supabaseAdmin().from('galleries').update(patch).eq('id', gallery.id);
  if (error) {
    if (error.message.includes('galleries_slug_key')) return { error: 'That link is already taken.' };
    if (error.message.startsWith('SLUG_RESERVED')) return { error: 'That link is reserved by the app.' };
    return { error: error.message };
  }

  // Both the old and the new slug need flushing when the link changed.
  // updateTag (not revalidateTag) inside a Server Action: it gives
  // read-your-own-writes, so the redirect after saving never shows stale data.
  updateTag(galleryTag(gallery.slug));
  if (patch.slug) updateTag(galleryTag(patch.slug as string));
  revalidatePath('/admin');
  revalidatePath(`/admin/g/${gallery.id}`);

  return { ok: true };
}

export async function deleteGallery(formData: FormData) {
  const user = await currentUser();
  const id = String(formData.get('id') ?? '');
  const gallery = await owned(id, user.id);

  // The before-delete trigger queues every R2 object under this gallery; the
  // drain below actually removes them, so nothing is orphaned (§7).
  await supabaseAdmin().from('galleries').delete().eq('id', gallery.id);
  await drainStorageDeletions();

  updateTag(galleryTag(gallery.slug));
  revalidatePath('/admin');
  redirect('/admin');
}
