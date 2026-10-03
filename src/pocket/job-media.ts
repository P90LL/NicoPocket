import type { Job } from './jobs.js';
import { JobMediaError } from './job-media-error.js';
import { validateJobThumbnail, type ThumbnailSnapshot } from './job-images.js';
import { copyLocalHlsInput, eraseLocalHlsInput, type LocalHlsInput } from './hls-local-input.js';
import { muxAacToM4a } from './media-client.js';

export type JobAudioSource = Uint8Array | LocalHlsInput;
export type JobMediaOutput = {
  m4a: Uint8Array;
  aac?: Uint8Array;
  jpeg?: Uint8Array;
  warning: boolean;
  warnings: string[];
};
export type JobImagePort = { get(id: string): Promise<ThumbnailSnapshot | undefined> | ThumbnailSnapshot | undefined };

// 登録時に固定した画像のハッシュを照合し、候補画面の後続編集から分離する。
async function registeredCover(job: Readonly<Job>, images: JobImagePort, signal: AbortSignal): Promise<Uint8Array | undefined> {
  if (!job.thumbnail) return undefined;
  try {
    const metadata = validateJobThumbnail(job.thumbnail);
    const image = await images.get(job.id);
    signal.throwIfAborted();
    if (!metadata || !image || !(image.jpeg instanceof Blob) || image.jpeg.type !== 'image/jpeg'
      || image.jpeg.size !== metadata.jpegBytes
      || JSON.stringify(validateJobThumbnail(image.metadata)) !== JSON.stringify(metadata)) throw new Error();
    const jpeg = new Uint8Array(await image.jpeg.arrayBuffer());
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', jpeg.slice()))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    signal.throwIfAborted();
    if (digest !== metadata.jpegSha256) { jpeg.fill(0); throw new Error(); }
    return jpeg;
  } catch {
    signal.throwIfAborted();
    throw new JobMediaError('JOB_IMAGE_UNAVAILABLE');
  }
}

// 取得結果はこの関数内で複製し、保存へ渡す成果物以外を終了時に消去する。
export async function processJobMedia(job: Readonly<Job>, source: JobAudioSource,
  images: JobImagePort, signal: AbortSignal, onStage: (stage: 'encode' | 'mux') => void): Promise<JobMediaOutput> {
  signal.throwIfAborted();
  let audio: Uint8Array | undefined, hls: LocalHlsInput | undefined;
  let jpeg: Uint8Array | undefined, processedAac: Uint8Array | undefined;
  let stage: 'encode' | 'mux' | undefined;
  try {
    try {
      if (source instanceof Uint8Array) audio = source.slice();
      else hls = copyLocalHlsInput(source);
    } catch { throw new JobMediaError('WORKER_FAILED'); }
    jpeg = await registeredCover(job, images, signal);
    signal.throwIfAborted();
    const result = await muxAacToM4a({ aac: audio ?? new Uint8Array(), hls, jpeg,
      title: job.title || job.videoId, videoId: job.videoId, sourceUrl: job.sourceUrl,
      quality: job.quality, compressionRetries: job.compressionRetries }, {
      signal, onStage: value => { stage = value; onStage(value); }
    });
    processedAac = result.aac;
    signal.throwIfAborted();
    const warnings = [...result.warnings];
    if (!result.coverEmbedded) warnings.push('COVER_UNAVAILABLE');
    return { m4a: result.m4a, aac: job.saveAac ? result.aac.slice() : undefined,
      jpeg: job.saveJpeg && result.coverEmbedded ? jpeg?.slice() : undefined,
      warning: warnings.length > 0, warnings };
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted();
    if (error instanceof JobMediaError) throw error;
    throw new JobMediaError(stage === 'mux' ? 'M4A_MUX_FAILED'
      : stage === 'encode' ? 'AUDIO_CONVERSION_FAILED' : 'WORKER_FAILED');
  } finally {
    if (processedAac && processedAac !== audio) processedAac.fill(0);
    audio?.fill(0); jpeg?.fill(0); eraseLocalHlsInput(hls);
  }
}
