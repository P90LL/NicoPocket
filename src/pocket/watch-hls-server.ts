import { sendHlsInput } from "./hls-transfer.js";
import type { AcquiredAudio } from './hls-transfer.js';

export type CurrentWatchSource = Readonly<{ videoId: string | undefined; epoch: string }>;
type Transfer = { source: CurrentWatchSource; port: chrome.runtime.Port; controller: AbortController; task: Promise<void> };
type ServerOptions = {
  extensionId: string; windowUrl: string;
  currentSource(): CurrentWatchSource;
  acquire(source: CurrentWatchSource, signal: AbortSignal, maxBytes: number): Promise<AcquiredAudio>;
};

// Content Script側の取得口。現在動画のURLを読む実装は別途確認して注入する。
// 署名URL・CookieをPort名、状態、エラー応答へ含めない。
export class WatchHlsServer {
  private active?: Transfer;
  private disposed = false;
  private readonly options: ServerOptions;
  constructor(options: ServerOptions) { this.options = options; }

  accept(port: chrome.runtime.Port): Promise<void> {
    const source = this.options.currentSource(), sender = port.sender;
    const name = /^nicopocket-hls:([a-zA-Z0-9]{1,128}):([a-zA-Z0-9_-]{1,128}):([1-9][0-9]{0,15})$/u.exec(port.name);
    const maxBytes = name ? Number(name[3]) : NaN;
    if (this.disposed || this.active || !sender || sender.id !== this.options.extensionId
      || sender.url !== this.options.windowUrl || sender.frameId !== undefined && sender.frameId !== 0
      || sender.tab && sender.frameId !== 0
      || sender.tab?.url && sender.tab.url !== this.options.windowUrl
      || !name || name[1] !== source.videoId || name[2] !== source.epoch
      || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      port.disconnect(); return Promise.resolve();
    }
    const transfer: Transfer = { source: { ...source }, port, controller: new AbortController(), task: Promise.resolve() };
    this.active = transfer;
    transfer.task = sendHlsInput(port, async signal => {
      signal.throwIfAborted();
      const acquired = await this.options.acquire(transfer.source, signal, maxBytes);
      const current = this.options.currentSource();
      if (current.videoId !== source.videoId || current.epoch !== source.epoch || this.disposed) {
        await acquired.dispose(); throw new Error("音声の取得元が変更されました。");
      }
      return acquired;
    }, maxBytes, transfer.controller.signal).finally(() => { if (this.active === transfer) this.active = undefined; });
    return transfer.task;
  }

  // 遷移・文書終了では取得を中止。解放が終わるまで別のPortを受け入れない。
  sourceChanged(current: CurrentWatchSource): Promise<void> {
    const active = this.active;
    if (!active || active.source.videoId === current.videoId && active.source.epoch === current.epoch) return Promise.resolve();
    active.controller.abort(new DOMException("取得元が変更されました。", "AbortError"));
    active.port.disconnect(); return active.task;
  }

  dispose(): Promise<void> {
    this.disposed = true;
    this.active?.controller.abort(new DOMException("取得元の文書が閉じられました。", "AbortError"));
    this.active?.port.disconnect(); return this.active?.task ?? Promise.resolve();
  }
}
