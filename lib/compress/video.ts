import { VIDEO_RENDITIONS, VIDEO_LADDER, formatBytes } from '../limits';
import type { CompressResult, CompressedRendition } from './types';

/**
 * Video compression, in the browser (§2.7).
 *
 * Strategy, in order of preference:
 *
 *   1. WebCodecs. One playback pass feeds TWO VideoEncoders at once — the 720p
 *      audio-free `loop` for the wall and the 1080p `full` for the lightbox —
 *      so a 10s clip costs about 10s, not 20s. Muxed with mp4-muxer.
 *      Audio for `full` is decoded via AudioContext and re-encoded as AAC
 *      (or Opus where AAC encoding isn't offered).
 *   2. ffmpeg.wasm, for browsers without VideoEncoder.
 *   3. The server route, for anything that fails both.
 *
 * This runs on the main thread rather than in a worker, because decoding needs
 * an HTMLVideoElement, which workers don't have. That is fine in practice: the
 * VideoEncoder does its work on its own threads, so the only main-thread cost
 * is one drawImage per frame. Images — the bulk of any upload — do run in a
 * worker (see pool.ts).
 */

type Report = (pct: number, note?: string) => void;

export function webCodecsAvailable(): boolean {
  return typeof globalThis.VideoEncoder !== 'undefined' && typeof globalThis.VideoFrame !== 'undefined';
}

export async function compressVideo(file: File, report: Report = () => {}): Promise<CompressResult> {
  if (webCodecsAvailable()) {
    try {
      return await compressWithWebCodecs(file, report);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A cap breach is a real rejection — don't retry it more slowly in wasm.
      if (/still .* after|over the/.test(message)) throw err;
      report(0, 'falling back to ffmpeg.wasm');
    }
  }
  return compressWithFfmpegWasm(file, report);
}

// ── WebCodecs ───────────────────────────────────────────────────────────────

async function compressWithWebCodecs(file: File, report: Report): Promise<CompressResult> {
  const url = URL.createObjectURL(file);
  try {
    const video = await loadVideo(url);
    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    const durationS = video.duration;

    report(4, 'poster frame');
    const poster = await grabPoster(video, Math.min(1, durationS / 2));

    let attempt = 0;
    let full: { blob: Blob; bytes: number } | null = null;
    let loop: { blob: Blob; bytes: number } | null = null;

    // Adaptive ladder (§2.7): CRF-equivalent steps, up to 3 passes.
    for (const step of VIDEO_LADDER) {
      attempt++;
      report(10, `encoding (pass ${attempt} · ${step.label})`);

      const pass = await encodePass(video, {
        srcW,
        srcH,
        durationS,
        fullMaxHeight: step.maxHeight,
        bitrateScale: step.bitrateScale,
        // Only encode the loop on the first pass — it has its own fixed target
        // and doesn't need the ladder.
        includeLoop: attempt === 1,
        report: (p) => report(10 + p * 0.8, `encoding (pass ${attempt} · ${step.label})`),
      });

      full = pass.full;
      if (pass.loop) loop = pass.loop;
      if (full.bytes <= VIDEO_RENDITIONS.full.hardMax) break;
    }

    if (!full || !loop) throw new Error('Encoding produced no output.');

    if (full.bytes > VIDEO_RENDITIONS.full.hardMax) {
      throw new Error(
        `${file.name} is still ${formatBytes(full.bytes)} after three compression passes — it's ` +
          `${Math.round(durationS)}s long. Trim it to under 30s and try again.`,
      );
    }
    if (loop.bytes > VIDEO_RENDITIONS.loop.hardMax) {
      throw new Error(
        `The looping version of ${file.name} came out at ${formatBytes(loop.bytes)}, over the ` +
          `${formatBytes(VIDEO_RENDITIONS.loop.hardMax)} limit. High-motion footage compresses badly — ` +
          `a steadier or shorter clip will work.`,
      );
    }

    report(100, 'done');

    const renditions: CompressedRendition[] = [
      { name: 'poster', blob: poster.blob, bytes: poster.blob.size, contentType: 'image/jpeg' },
      { name: 'grid', blob: loop.blob, bytes: loop.bytes, contentType: 'video/mp4' },
      { name: 'full', blob: full.blob, bytes: full.bytes, contentType: 'video/mp4' },
    ];

    return {
      kind: 'video',
      renditions,
      width: srcW,
      height: srcH,
      durationS,
      lqip: poster.lqip,
      compressedBy: 'webcodecs',
      sourceBytes: file.size,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface PassOptions {
  srcW: number;
  srcH: number;
  durationS: number;
  fullMaxHeight: number;
  bitrateScale: number;
  includeLoop: boolean;
  report: (pct01: number) => void;
}

async function encodePass(video: HTMLVideoElement, opts: PassOptions) {
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');

  const fullDims = fit(opts.srcW, opts.srcH, opts.fullMaxHeight);
  const loopDims = fit(opts.srcW, opts.srcH, VIDEO_RENDITIONS.loop.maxHeight);
  const loopCutoffS = Math.min(opts.durationS, VIDEO_RENDITIONS.loop.maxDurationS);

  // Bitrates chosen to land near the CRF values in §2.6 for typical footage.
  const fullBitrate = Math.round(fullDims.h * fullDims.w * 0.11 * opts.bitrateScale);
  const loopBitrate = Math.round(loopDims.h * loopDims.w * 0.075);

  const fullTarget = new ArrayBufferTarget();
  const fullMuxer = new Muxer({
    target: fullTarget,
    video: { codec: 'avc', width: fullDims.w, height: fullDims.h },
    fastStart: 'in-memory', // == -movflags +faststart
  });

  const fullEncoder = new VideoEncoder({
    output: (chunk, meta) => fullMuxer.addVideoChunk(chunk, meta),
    error: (e) => {
      throw e;
    },
  });
  fullEncoder.configure({
    codec: 'avc1.640028', // H.264 High @ 4.0
    width: fullDims.w,
    height: fullDims.h,
    bitrate: fullBitrate,
    framerate: 30,
    avc: { format: 'avc' },
  });

  let loopMuxer: InstanceType<typeof Muxer> | null = null;
  let loopTarget: InstanceType<typeof ArrayBufferTarget> | null = null;
  let loopEncoder: VideoEncoder | null = null;
  let loopCanvas: OffscreenCanvas | null = null;
  let loopCtx: OffscreenCanvasRenderingContext2D | null = null;

  if (opts.includeLoop) {
    loopTarget = new ArrayBufferTarget();
    loopMuxer = new Muxer({
      target: loopTarget,
      video: { codec: 'avc', width: loopDims.w, height: loopDims.h },
      fastStart: 'in-memory',
    });
    const muxer = loopMuxer;
    loopEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        throw e;
      },
    });
    loopEncoder.configure({
      codec: 'avc1.640028',
      width: loopDims.w,
      height: loopDims.h,
      bitrate: loopBitrate,
      framerate: 30,
      avc: { format: 'avc' },
    });
    loopCanvas = new OffscreenCanvas(loopDims.w, loopDims.h);
    loopCtx = loopCanvas.getContext('2d', { alpha: false });
  }

  // ── audio for the full rendition (the loop is deliberately silent) ────────
  const audio = await encodeAudio(video, fullMuxer, opts.durationS).catch(() => null);

  // ── one playback pass, both encoders ─────────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    let frames = 0;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    video.currentTime = 0;
    video.muted = true;

    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      try {
        const tUs = Math.round(meta.mediaTime * 1_000_000);
        const keyFrame = frames % 60 === 0;

        const frame = new VideoFrame(video, { timestamp: tUs });
        fullEncoder.encode(frame, { keyFrame });

        if (loopEncoder && loopCtx && loopCanvas && meta.mediaTime <= loopCutoffS) {
          loopCtx.drawImage(video, 0, 0, loopCanvas.width, loopCanvas.height);
          const small = new VideoFrame(loopCanvas, { timestamp: tUs });
          loopEncoder.encode(small, { keyFrame });
          small.close();
        }

        frame.close();
        frames++;
        opts.report(Math.min(0.98, meta.mediaTime / Math.max(0.001, opts.durationS)));

        if (!video.ended) video.requestVideoFrameCallback(onFrame);
        else finish();
      } catch (err) {
        reject(err);
      }
    };

    video.onended = finish;
    video.onerror = () => reject(new Error('Playback failed while encoding.'));
    video.requestVideoFrameCallback(onFrame);
    video.play().catch(reject);
  });

  video.pause();

  await fullEncoder.flush();
  fullEncoder.close();
  if (audio) await audio.finish();
  fullMuxer.finalize();
  const fullBlob = new Blob([fullTarget.buffer as ArrayBuffer], { type: 'video/mp4' });

  let loopOut: { blob: Blob; bytes: number } | null = null;
  if (loopEncoder && loopMuxer && loopTarget) {
    await loopEncoder.flush();
    loopEncoder.close();
    loopMuxer.finalize();
    const blob = new Blob([loopTarget.buffer as ArrayBuffer], { type: 'video/mp4' });
    loopOut = { blob, bytes: blob.size };
  }

  return { full: { blob: fullBlob, bytes: fullBlob.size }, loop: loopOut };
}

/**
 * Decodes the source's audio with WebAudio and re-encodes it into the full
 * rendition. Silent failure is fine — a clip with no audio track, or a browser
 * without an AAC encoder, simply produces a silent `full`, and the wall's loop
 * has no audio by design anyway.
 */
async function encodeAudio(
  video: HTMLVideoElement,
  muxer: { addAudioChunk: (c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata) => void },
  durationS: number,
): Promise<{ finish: () => Promise<void> } | null> {
  if (typeof globalThis.AudioEncoder === 'undefined') return null;

  const res = await fetch(video.src);
  const raw = await res.arrayBuffer();
  const ctx = new OfflineAudioContext(2, 48000 * Math.max(1, Math.ceil(durationS)), 48000);
  const buffer = await ctx.decodeAudioData(raw).catch(() => null);
  if (!buffer) return null;

  const codec = (await supported('mp4a.40.2')) ? 'mp4a.40.2' : (await supported('opus')) ? 'opus' : null;
  if (!codec) return null;

  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: () => {},
  });
  encoder.configure({
    codec,
    sampleRate: buffer.sampleRate,
    numberOfChannels: Math.min(2, buffer.numberOfChannels),
    bitrate: 128_000,
  });

  const channels = Math.min(2, buffer.numberOfChannels);
  const chunkFrames = 1024;
  const interleaved = new Float32Array(chunkFrames * channels);

  for (let offset = 0; offset < buffer.length; offset += chunkFrames) {
    const count = Math.min(chunkFrames, buffer.length - offset);
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < count; i++) interleaved[i * channels + c] = data[offset + i];
    }
    encoder.encode(
      new AudioData({
        format: 'f32',
        sampleRate: buffer.sampleRate,
        numberOfFrames: count,
        numberOfChannels: channels,
        timestamp: Math.round((offset / buffer.sampleRate) * 1_000_000),
        data: interleaved.slice(0, count * channels),
      }),
    );
  }

  return {
    finish: async () => {
      await encoder.flush();
      encoder.close();
    },
  };

  async function supported(codec: string) {
    try {
      const r = await AudioEncoder.isConfigSupported({
        codec,
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128_000,
      });
      return Boolean(r.supported);
    } catch {
      return false;
    }
  }
}

// ── ffmpeg.wasm fallback ────────────────────────────────────────────────────

async function compressWithFfmpegWasm(file: File, report: Report): Promise<CompressResult> {
  report(2, 'loading ffmpeg.wasm (~31 MB, first time only)');

  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const { fetchFile, toBlobURL } = await import('@ffmpeg/util');

  const ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => report(10 + progress * 80, 'encoding (ffmpeg.wasm)'));

  // Served from unpkg because the wasm must come from a cross-origin-isolated
  // URL; next.config.ts sets COOP/COEP on /admin so this can load.
  const base = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  await ffmpeg.writeFile('in', await fetchFile(file));

  // poster
  await ffmpeg.exec(['-ss', '1', '-i', 'in', '-frames:v', '1', '-vf', 'scale=1200:-2', '-q:v', '4', 'poster.jpg']);

  // loop: 720p, CRF 26, no audio, ≤12s
  await ffmpeg.exec([
    '-i', 'in',
    '-t', String(VIDEO_RENDITIONS.loop.maxDurationS),
    '-an',
    '-c:v', 'libx264',
    '-crf', '26',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-vf', `scale=-2:'min(${VIDEO_RENDITIONS.loop.maxHeight},ih)'`,
    'loop.mp4',
  ]);

  // full: ladder
  let fullData: Uint8Array | null = null;
  let usedLabel = '';
  for (const step of VIDEO_LADDER) {
    await ffmpeg.exec([
      '-i', 'in',
      '-c:v', 'libx264',
      '-crf', String(step.crf),
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-vf', `scale=-2:'min(${step.maxHeight},ih)'`,
      '-c:a', 'aac',
      '-b:a', '128k',
      '-y', 'full.mp4',
    ]);
    const data = (await ffmpeg.readFile('full.mp4')) as Uint8Array;
    fullData = data;
    usedLabel = step.label;
    if (data.byteLength <= VIDEO_RENDITIONS.full.hardMax) break;
  }

  const posterData = (await ffmpeg.readFile('poster.jpg')) as Uint8Array;
  const loopData = (await ffmpeg.readFile('loop.mp4')) as Uint8Array;

  if (!fullData || fullData.byteLength > VIDEO_RENDITIONS.full.hardMax) {
    throw new Error(
      `${file.name} is still ${formatBytes(fullData?.byteLength ?? 0)} after three compression passes ` +
        `(down to ${usedLabel}). Trim it to under 30s and try again.`,
    );
  }
  if (loopData.byteLength > VIDEO_RENDITIONS.loop.hardMax) {
    throw new Error(
      `The looping version of ${file.name} is ${formatBytes(loopData.byteLength)}, over the ` +
        `${formatBytes(VIDEO_RENDITIONS.loop.hardMax)} limit. Try a shorter or steadier clip.`,
    );
  }

  const meta = await loadVideoMeta(file);
  report(100, 'done');

  const toBlob = (d: Uint8Array, type: string) =>
    new Blob([d.slice().buffer as ArrayBuffer], { type });

  return {
    kind: 'video',
    renditions: [
      { name: 'poster', blob: toBlob(posterData, 'image/jpeg'), bytes: posterData.byteLength, contentType: 'image/jpeg' },
      { name: 'grid', blob: toBlob(loopData, 'video/mp4'), bytes: loopData.byteLength, contentType: 'video/mp4' },
      { name: 'full', blob: toBlob(fullData, 'video/mp4'), bytes: fullData.byteLength, contentType: 'video/mp4' },
    ],
    width: meta.width,
    height: meta.height,
    durationS: meta.durationS,
    compressedBy: 'ffmpeg-wasm',
    sourceBytes: file.size,
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function fit(w: number, h: number, maxHeight: number) {
  const scale = Math.min(1, maxHeight / h);
  // H.264 needs even dimensions.
  return {
    w: Math.max(2, Math.round((w * scale) / 2) * 2),
    h: Math.max(2, Math.round((h * scale) / 2) * 2),
  };
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error('That video couldn’t be decoded by this browser.'));
  });
}

async function loadVideoMeta(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const v = await loadVideo(url);
    return { width: v.videoWidth, height: v.videoHeight, durationS: v.duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function grabPoster(video: HTMLVideoElement, atS: number): Promise<{ blob: Blob; lqip: string }> {
  await seek(video, atS);
  const scale = Math.min(1, 1200 / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas is unavailable, so a poster frame can’t be made.');
  ctx.drawImage(video, 0, 0, w, h);

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  if (blob.size > VIDEO_RENDITIONS.poster.hardMax) {
    const retry = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
    return { blob: retry, lqip: await lqipFrom(video) };
  }
  return { blob, lqip: await lqipFrom(video) };
}

async function lqipFrom(video: HTMLVideoElement): Promise<string> {
  const canvas = new OffscreenCanvas(20, Math.max(1, Math.round((20 * video.videoHeight) / video.videoWidth)));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return '';
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.4 });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return `data:image/webp;base64,${btoa(bin)}`;
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = t;
  });
}
