import type { JobRunner } from "./job-runner.js";

type Action = "cancel" | "retry" | "remove";
type Reply = { ok: true } | { ok: false; error: string };
const failure = () => new Error("実行項目の操作に失敗しました。");

// 一覧の操作を、処理エンジンとService Workerの保存済み状態へ接続する。
// 実行エンジンが接続されたときは取消しと再試行を処理終了まで同期する。
export class JobActionController {
  private runner?: JobRunner;
  private concurrency?: number;
  private stopped = false;
  private readonly send: (message: unknown) => Promise<unknown>;
  private readonly onError: () => void;
  private readonly onSettled: () => void;
  constructor(send: (message: unknown) => Promise<unknown>, onError: () => void, onSettled = () => {}) {
    this.send = send; this.onError = onError; this.onSettled = onSettled;
  }

  connect(runner: JobRunner): void {
    if (this.stopped || this.runner && this.runner !== runner) throw failure();
    try { if (this.concurrency !== undefined) runner.setConcurrency(this.concurrency); }
    catch { throw failure(); }
    this.runner = runner;
  }

  setConcurrency(concurrency: number): void {
    if (this.stopped || !Number.isInteger(concurrency) || concurrency < 10 || concurrency > 50) throw failure();
    if (this.concurrency === concurrency) return;
    try { this.runner?.setConcurrency(concurrency); } catch { throw failure(); }
    this.concurrency = concurrency;
  }

  start(id: string): void {
    if (!this.runner || this.stopped || !/^[a-zA-Z0-9_-]{1,128}$/u.test(id)) throw failure();
    // JobRunnerが状態を確定する。状態保存自体の失敗だけを画面へ固定文言で知らせる。
    void this.runner.start(id).catch(() => this.onError()).finally(() => this.onSettled());
  }

  isRunning(id: string): boolean { return this.runner?.isRunning(id) ?? false; }

  async perform(id: string, action: Action): Promise<Reply> {
    try { return await this.apply(id, action); } catch { throw failure(); }
  }

  private async apply(id: string, action: Action): Promise<Reply> {
    if (this.stopped || !/^[a-zA-Z0-9_-]{1,128}$/u.test(id) || !["cancel", "retry", "remove"].includes(action)) throw failure();
    if (action === "cancel" && await this.runner?.cancelAndWait(id)) return { ok: true };
    if (action === "remove") await this.runner?.cancelAndWait(id);
    if (action === "retry") await this.runner?.wait(id);
    if (this.stopped) throw failure();
    let reply: unknown;
    try { reply = await this.send({ kind: "np:job-action", id, action }); } catch { throw failure(); }
    if (!reply || typeof reply !== "object" || !("ok" in reply) || reply.ok !== true) throw failure();
    if (action === "retry" && this.runner && !this.stopped) this.start(id);
    return { ok: true };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.runner?.stop();
  }
}
