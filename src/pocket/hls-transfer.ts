import { copyLocalHlsInput, eraseLocalHlsInput, type LocalHlsInput } from "./hls-local-input.js";
export type AcquiredAudio = { hls: LocalHlsInput; dispose(): Promise<void> | void };

const chunkBytes = 32768;
const failure = () => new Error("音声取得の受け渡しに失敗しました");
const cancelled = () => new DOMException("音声取得を中止しました", "AbortError");
const validBudget = (value: number) => Number.isSafeInteger(value) && value > 0;
type Message = Record<string, unknown>;
const object = (value: unknown): value is Message => typeof value === "object" && value !== null && !Array.isArray(value);

// 1ジョブ1Port。呼び出し側で送信元と現在の動画を確認した後に開始する。
// ChromeのJSON通信にバイト列を一括で載せず、確認応答を待ちながら固定サイズで渡す。
// 署名URLを渡さず、宣言済みのローカル資産名だけの入力に再構築する。
export async function sendHlsInput(port: chrome.runtime.Port,
  acquire: (signal: AbortSignal) => Promise<AcquiredAudio>, maxBytes: number, ownerSignal?: AbortSignal): Promise<void> {
  if (!validBudget(maxBytes)) throw failure();
  const controller = new AbortController();
  let acquired: AcquiredAudio | undefined, input: LocalHlsInput | undefined;
  let expectedAck: number | undefined, resolveAck: (() => void) | undefined;
  let rejectAck: ((error: unknown) => void) | undefined, disconnected = false, requestedCancel = false;
  const stop = (reason: unknown) => { controller.abort(reason); rejectAck?.(reason); };
  const receive = (raw: unknown) => {
    if (!object(raw)) { stop(failure()); return; }
    if (raw.kind === "cancel" && Object.keys(raw).length === 1) { requestedCancel = true; stop(cancelled()); }
    else if (raw.kind === "ack" && Object.keys(raw).length === 2 && raw.sequence === expectedAck && resolveAck) {
      const done = resolveAck; expectedAck = undefined; resolveAck = undefined; rejectAck = undefined; done();
    } else stop(failure());
  };
  const disconnect = () => { disconnected = true; stop(failure()); };
  const ownerAbort = () => { requestedCancel = true; stop(ownerSignal?.reason ?? cancelled()); };
  port.onMessage.addListener(receive); port.onDisconnect.addListener(disconnect);
  ownerSignal?.addEventListener("abort", ownerAbort, { once: true });
  if (ownerSignal?.aborted) ownerAbort();
  const send = (message: Message, sequence: number) => new Promise<void>((resolve, reject) => {
    if (controller.signal.aborted) { reject(controller.signal.reason); return; }
    expectedAck = sequence; resolveAck = resolve; rejectAck = reject;
    try { port.postMessage({ ...message, sequence }); } catch { stop(failure()); }
  });
  let status: "complete" | "cancelled" | "error" = "error";
  try {
    controller.signal.throwIfAborted();
    acquired = await acquire(controller.signal); controller.signal.throwIfAborted();
    if (!acquired.hls) throw failure();
    input = copyLocalHlsInput(acquired.hls);
    let total = 0;
    for (const file of input.files) { total += file.bytes.length; if (total > maxBytes) throw failure(); }
    await send({ kind: "manifest", playlist: input.playlist,
      files: input.files.map(file => ({ name: file.name, size: file.bytes.length })) }, 0);
    let sequence = 0;
    for (let file = 0; file < input.files.length; file++) {
      const bytes = input.files[file].bytes;
      for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
        controller.signal.throwIfAborted();
        const chunk = bytes.subarray(offset, offset + chunkBytes);
        await send({ kind: "chunk", file, offset, text: btoa(String.fromCharCode(...chunk)) }, ++sequence);
      }
    }
    controller.signal.throwIfAborted(); status = "complete";
  } catch { status = requestedCancel ? "cancelled" : "error"; }
  finally {
    // 終了応答は取得キャッシュ・送信コピーの消去が終わってから返す。
    eraseLocalHlsInput(input);
    try { await acquired?.dispose(); } catch { status = "error"; }
    port.onMessage.removeListener(receive); port.onDisconnect.removeListener(disconnect);
    ownerSignal?.removeEventListener("abort", ownerAbort);
  }
  if (!disconnected) { try { port.postMessage({ kind: "end", status, stopped: true }); } catch { /* 接続先は終了済み */ } }
}

// 同梱のContent ScriptへのPortを呼び出し側で開く。受信したURLや鍵をstorageへ保存しない。
export function receiveHlsInput(port: chrome.runtime.Port, signal: AbortSignal, maxBytes: number): Promise<AcquiredAudio> {
  if (!validBudget(maxBytes)) { port.disconnect(); return Promise.reject(failure()); }
  return new Promise((resolve, reject) => {
    let input: LocalHlsInput | undefined, sequence = 0, currentFile = 0, offset = 0;
    let settled = false, stopping = false, reason: unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result?: AcquiredAudio, error?: unknown) => {
      if (settled) return; settled = true; clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      port.onMessage.removeListener(receive); port.onDisconnect.removeListener(disconnect);
      eraseLocalHlsInput(input); port.disconnect();
      if (result) resolve(result); else reject(error ?? failure());
    };
    const stop = (error: unknown) => {
      if (stopping || settled) return; stopping = true; reason = error;
      // 通常の取得・受渡しに固定期限を付けず、停止応答だけを監視する。
      timer = setTimeout(() => finish(undefined, new Error("音声取得の停止を確認できませんでした")), 5000);
      try { port.postMessage({ kind: "cancel" }); } catch { finish(undefined, failure()); }
    };
    const abort = () => stop(signal.reason ?? cancelled());
    const disconnect = () => finish(undefined, failure());
    const receive = (raw: unknown) => {
      if (settled) return;
      if (!object(raw)) { stop(failure()); return; }
      if (raw.kind === "end") {
        if (raw.stopped !== true || !["complete", "cancelled", "error"].includes(raw.status as string)) { stop(failure()); return; }
        if (stopping) { finish(undefined, raw.status === "error" ? failure() : reason); return; }
        if (raw.status !== "complete" || !input || currentFile !== input.files.length) { finish(undefined, failure()); return; }
        try {
          const hls = copyLocalHlsInput(input);
          finish({ hls, async dispose() { eraseLocalHlsInput(hls); } });
        } catch { finish(undefined, failure()); }
        return;
      }
      if (stopping) return;
      try {
        if (raw.sequence !== sequence) throw failure();
        if (raw.kind === "manifest") {
          if (input || sequence !== 0 || typeof raw.playlist !== "string" || raw.playlist.length > 4 * 1024 * 1024
            || !Array.isArray(raw.files) || raw.files.length < 1 || raw.files.length > 300000) throw failure();
          let total = 0; const names = new Set<string>();
          const files = raw.files.map((file: unknown) => {
            if (!object(file) || typeof file.name !== "string" || !/^asset-\d{1,6}\.bin$/u.test(file.name)
              || names.has(file.name) || typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size < 1) throw failure();
            names.add(file.name); total += file.size; if (total > maxBytes) throw failure();
            return { name: file.name, bytes: new Uint8Array(file.size) };
          });
          input = { playlist: raw.playlist, files };
        } else if (raw.kind === "chunk") {
          if (!input || raw.file !== currentFile || raw.offset !== offset || typeof raw.text !== "string"
            || raw.text.length > Math.ceil(chunkBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(raw.text)) throw failure();
          const file = input.files[currentFile]; if (!file) throw failure();
          const text = atob(raw.text), count = Math.min(chunkBytes, file.bytes.length - offset);
          if (text.length !== count) throw failure();
          for (let index = 0; index < count; index++) file.bytes[offset + index] = text.charCodeAt(index);
          offset += count;
          if (offset === file.bytes.length) { currentFile++; offset = 0; }
        } else throw failure();
        port.postMessage({ kind: "ack", sequence: sequence++ });
      } catch { stop(failure()); }
    };
    port.onMessage.addListener(receive); port.onDisconnect.addListener(disconnect);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
