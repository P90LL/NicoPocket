type Task<T> = () => Promise<T>;
type PendingTask = { start: () => void; cancel: () => void };

// 中断の通知だけで枠を返さず、処理と後片付けの終了を待つ。
class TaskPool {
  private active = 0;
  private limit: number;
  private readonly waiting: PendingTask[] = [];

  constructor(limit: number) { this.limit = limit; }

  setLimit(limit: number): void {
    this.limit = limit;
    this.drain();
  }

  run<T>(task: Task<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      const pending: PendingTask = {
        start: () => {
          signal.removeEventListener("abort", pending.cancel);
          this.active++;
          void Promise.resolve().then(() => {
            signal.throwIfAborted();
            return task();
          }).then((value) => {
            signal.throwIfAborted();
            resolve(value);
          }).catch((error) => {
            // 中断要求があっても、停止・後片付けの失敗をAbortErrorで隠さない。
            reject(error);
          }).finally(() => {
            this.active--;
            this.drain();
          });
        },
        cancel: () => {
          const index = this.waiting.indexOf(pending);
          if (index >= 0) this.waiting.splice(index, 1);
          signal.removeEventListener("abort", pending.cancel);
          reject(signal.reason);
        }
      };
      signal.addEventListener("abort", pending.cancel, { once: true });
      this.waiting.push(pending);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.limit && this.waiting.length) this.waiting.shift()!.start();
  }
}

export type JobContext = {
  // 実行処理側でWorker停止等へ接続し、runMediaと後片付けをawaitする。
  signal: AbortSignal;
  runMedia<T>(task: Task<T>): Promise<T>;
};

export class JobScheduler {
  private readonly jobs: TaskPool;
  private readonly media: TaskPool;
  private readonly controllers = new Map<string, AbortController>();

  constructor(options: { concurrency: number; mediaSlots: number }) {
    this.validate(options);
    this.jobs = new TaskPool(options.concurrency);
    this.media = new TaskPool(options.mediaSlots);
  }

  setLimits(options: { concurrency: number; mediaSlots: number }): void {
    this.validate(options);
    this.jobs.setLimit(options.concurrency);
    this.media.setLimit(options.mediaSlots);
  }

  // 設定画面は論理ジョブ枠だけを変更する。高負荷枠を勝手に増やさず、
  // 縮小時も実行中の処理は終了を待ち、その間の新規開始を抑える。
  setConcurrency(concurrency: number): void {
    this.validate({ concurrency, mediaSlots: 1 });
    this.jobs.setLimit(concurrency);
  }

  submit<T>(id: string, task: (context: JobContext) => Promise<T>): Promise<T> {
    if (!id || this.controllers.has(id)) return Promise.reject(new Error("ジョブ識別子が重複または空です"));
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const signal = controller.signal;
    return this.jobs.run(() => task({ signal,
      runMedia: <R>(mediaTask: Task<R>) => this.media.run(mediaTask, signal)
    }), signal).finally(() => { this.controllers.delete(id); });
  }

  cancel(id: string): boolean {
    const controller = this.controllers.get(id);
    if (!controller || controller.signal.aborted) return false;
    controller.abort(new DOMException("ジョブをキャンセルしました", "AbortError"));
    return true;
  }

  cancelAll(): void {
    for (const id of this.controllers.keys()) this.cancel(id);
  }

  private validate(options: { concurrency: number; mediaSlots: number }): void {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 10 || options.concurrency > 50
      || !Number.isInteger(options.mediaSlots) || options.mediaSlots < 1 || options.mediaSlots > options.concurrency) {
      throw new Error("同時実行数または高負荷処理枠が正しくありません");
    }
  }
}
