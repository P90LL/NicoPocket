import { compressionTarget, measureAdtsBitrate } from './audio-quality.js';
import type { LocalHlsInput } from './hls-local-input.js';
import type { MuxInput } from './media-mux.js';

export type MuxOutput = { m4a: Uint8Array; aac: Uint8Array; warnings: string[];
  compressed: boolean; sourceBitrate: number; outputBitrate: number; compressionAttempts: number };
type WorkerTask = { kind: 'mux'; input: MuxInput } | { kind: 'compress'; aac: Uint8Array; target: 128000 | 160000 }
  | { kind: 'extract-hls'; hls: LocalHlsInput };

function runTask(task: WorkerTask, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) return Promise.reject(new DOMException('キャンセルしました', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./media-worker.js', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error?: Error, bytes?: Uint8Array) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(bytes!);
    };
    const abort = () => finish(new DOMException('キャンセルしました', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { event.preventDefault(); finish(new Error('変換Workerが停止しました')); };
    worker.onmessageerror = () => finish(new Error('変換結果を受信できません'));
    worker.onmessage = ({ data }) => {
      if (data?.ok === true && data.bytes instanceof Uint8Array && data.bytes.length) finish(undefined, data.bytes);
      else finish(new Error('音声処理に失敗しました'));
    };
    // Keep caller-owned input available for AAC saving and fallback after a failed attempt.
    try { worker.postMessage(task); } catch { finish(new Error('変換入力を送信できません')); }
  });
}

/** Use the original AAC when under cap or after exhausted compression retries. */
export async function muxAacToM4a(input: MuxInput, options: { signal?: AbortSignal } = {}): Promise<MuxOutput> {
  const quality = input.quality ?? 'best', retries = input.compressionRetries ?? 3;
  if (!Number.isInteger(retries) || retries < 1 || retries > 5) throw new Error('再試行回数が正しくありません');
  const originalAac = input.hls ? await runTask({ kind: 'extract-hls', hls: input.hls }, options.signal) : input.aac;
  const sourceBitrate = measureAdtsBitrate(originalAac);
  const target = compressionTarget(quality, sourceBitrate);
  let aac = originalAac, outputBitrate = sourceBitrate, compressionAttempts = 0;
  const warnings: string[] = [];
  if (target !== undefined) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      options.signal?.throwIfAborted();
      compressionAttempts++;
      try {
        const candidate = await runTask({ kind: 'compress', aac: originalAac, target }, options.signal);
        const bitrate = measureAdtsBitrate(candidate);
        if (bitrate <= target) { aac = candidate; outputBitrate = bitrate; break; }
      } catch (error) {
        if (options.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') throw error;
      }
    }
    if (aac === originalAac) warnings.push('圧縮に失敗したため、元の最高音質で保存対象にしました。');
  }
  options.signal?.throwIfAborted();
  let m4a: Uint8Array;
  try {
    m4a = await runTask({ kind: 'mux', input: { ...input, aac } }, options.signal);
  } catch (error) {
    if (!input.jpeg || options.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') throw error;
    const { jpeg: _jpeg, ...audioOnly } = input;
    m4a = await runTask({ kind: 'mux', input: { ...audioOnly, aac } }, options.signal);
    warnings.push('ジャケットを付けられなかったため、音声とメタデータだけを保存対象にしました。');
  }
  return { m4a, aac, warnings, compressed: aac !== originalAac,
    sourceBitrate, outputBitrate, compressionAttempts };
}
