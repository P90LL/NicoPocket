import { receiveHlsInput, type AcquiredAudio } from './hls-transfer.js';
import { validateWatchSourceBinding } from './watch-source-binding.js';

const failure = () => new Error('音声の取得元を確認できませんでした。');

/** Opens the verified top-level document; no playlist or signed URL enters the request. */
export async function acquireWatchAudio(videoId: string, signal: AbortSignal,
  maxInputBytes: number): Promise<AcquiredAudio> {
  return acquireBoundAudio(videoId, { kind: 'np:read-draft-source', videoId }, signal, maxInputBytes);
}

/** Reads the source attached to the registered job, not a later draft selection. */
export async function acquireWatchJobAudio(job: { id: string; videoId: string }, signal: AbortSignal,
  maxInputBytes: number): Promise<AcquiredAudio> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(job.id)) throw failure();
  return acquireBoundAudio(job.videoId, { kind: 'np:read-job-source', id: job.id }, signal, maxInputBytes);
}

async function acquireBoundAudio(videoId: string, request: Record<string, string>, signal: AbortSignal,
  maxInputBytes: number): Promise<AcquiredAudio> {
  signal.throwIfAborted();
  if (!/^[a-zA-Z0-9]{1,128}$/.test(videoId) || !Number.isSafeInteger(maxInputBytes)
    || maxInputBytes < 1) throw failure();
  let reply: unknown;
  try { reply = await chrome.runtime.sendMessage(request); }
  catch { signal.throwIfAborted(); throw failure(); }
  signal.throwIfAborted();
  if (!reply || typeof reply !== 'object' || !('ok' in reply) || reply.ok !== true
    || !('videoId' in reply) || reply.videoId !== videoId || !('sourceTab' in reply)) throw failure();
  const source = validateWatchSourceBinding(reply.sourceTab);
  let port: chrome.runtime.Port;
  try {
    port = chrome.tabs.connect(source.tabId, { documentId: source.documentId, frameId: 0,
      name: `nicopocket-hls:${videoId}:${source.epoch}:${maxInputBytes}` });
  } catch { signal.throwIfAborted(); throw failure(); }
  return receiveHlsInput(port, signal, maxInputBytes);
}
