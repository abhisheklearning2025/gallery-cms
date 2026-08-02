export const SLUG_MIN = 3;
export const SLUG_MAX = 48;

/** Matches the DB CHECK constraint in 0001_schema.sql. */
export const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,46})[a-z0-9]$/;

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, '-and-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
}

export type SlugProblem = 'too-short' | 'too-long' | 'format' | null;

export function validateSlug(slug: string): SlugProblem {
  if (slug.length < SLUG_MIN) return 'too-short';
  if (slug.length > SLUG_MAX) return 'too-long';
  if (!SLUG_RE.test(slug)) return 'format';
  return null;
}

export function slugProblemMessage(p: SlugProblem): string | null {
  switch (p) {
    case 'too-short':
      return `Needs at least ${SLUG_MIN} characters.`;
    case 'too-long':
      return `Maximum ${SLUG_MAX} characters.`;
    case 'format':
      return 'Lowercase letters, numbers and hyphens only, and it can’t start or end with a hyphen.';
    default:
      return null;
  }
}
