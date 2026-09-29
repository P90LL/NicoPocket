import type { MuxInput } from './media-mux.js';
export type MuxOutput = { m4a: Uint8Array; warnings: string[] };

function convert(input: MuxInput, signal?: AbortSignal): Promise<Uint8Array> {
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
      if (data?.ok === true && data.m4a instanceof Uint8Array && data.m4a.length) finish(undefined, data.m4a);
      else finish(new Error('M4A生成に失敗しました'));
    };
    // Keep caller-owned audio available for optional AAC saving and an image fallback.
    try { worker.postMessage(input); } catch { finish(new Error('変換入力を送信できません')); }
  });
}

/** AAC stream copy only. Bitrate conversion and download registration are separate stages. */
export async function muxAacToM4a(input: MuxInput, options: { signal?: AbortSignal } = {}): Promise<MuxOutput> {
  try {
    return { m4a: await convert(input, options.signal), warnings: [] };
  } catch (error) {
    if (!input.jpeg || options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    const { jpeg: _jpeg, ...audioOnly } = input;
    const m4a = await convert(audioOnly, options.signal);
    return { m4a, warnings: ['ジャケットを付けられなかったため、音声とメタデータだけを保存対象にしました。'] };
  }
}
