type Waiting = { signal: AbortSignal; resolve: (release: () => void) => void;
  reject: (reason: unknown) => void; abort: () => void };

// 音声バッファを保持する期間を制限する。処理完了通知だけで枠を返さず、入力解放まで保持する。
export class ResourceSlots {
  private active = 0;
  private readonly waiting: Waiting[] = [];
  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('保持枠が正しくありません。');
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const entry: Waiting = { signal, resolve, reject, abort: () => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) this.waiting.splice(index, 1);
        signal.removeEventListener('abort', entry.abort);
        reject(signal.reason);
      } };
      signal.addEventListener('abort', entry.abort, { once: true });
      this.waiting.push(entry);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.limit && this.waiting.length) {
      const entry = this.waiting.shift()!;
      entry.signal.removeEventListener('abort', entry.abort);
      if (entry.signal.aborted) { entry.reject(entry.signal.reason); continue; }
      this.active++;
      let released = false;
      entry.resolve(() => {
        if (released) return;
        released = true;
        this.active--;
        this.drain();
      });
    }
  }
}
