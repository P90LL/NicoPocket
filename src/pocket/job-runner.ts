import { JobScheduler } from "./job-scheduler.js";
import { JobMediaError } from "./job-media-error.js";
import type { JobAudioSource, JobMediaOutput } from "./job-media.js";
import { validateJobThumbnail } from "./job-images.js";
type MediaStage = "encode" | "mux";
import { validateJobDownloads, validateJobSaveIssue, type JobSaveIssue, type JobDownloads, type Job, type JobErrorCode, type JobEvent } from "./jobs.js";
import { DownloadSaveError, DownloadSaveAborted, type SavedLocalFile } from "./download-saver.js";

export type JobStatePort = {
  get(id: string): Promise<Job | undefined>;
  // 読み取り・遷移・書き込みを直列化し、保存完了後に応答する。
  apply(event: JobEvent): Promise<Job>;
};
export type AcquiredAudio = ({ aac: Uint8Array; hls?: never } |
  { hls: Exclude<JobAudioSource, Uint8Array>; aac?: never }) & { dispose(): Promise<void> | void };
export type JobRunnerPorts = {
  state: JobStatePort;
  acquire(job: Readonly<Job>, signal: AbortSignal): Promise<AcquiredAudio>;
  process(job: Readonly<Job>, source: JobAudioSource, signal: AbortSignal,
    onStage: (stage: MediaStage) => void): Promise<JobMediaOutput>;
  // Chrome保存の全対象が完了し、失敗・中断も後片付けされた後だけ解決する。
  // 実保存はSavedLocalFile[]を返す。voidは既存POCの模擬応答で、保存IDを作らない。
  save(job: Readonly<Job>, output: JobMediaOutput, signal: AbortSignal): Promise<void | SavedLocalFile[]>;
};
export type JobRunResult = { id: string; status: "complete" | "warning" | "error" | "cancelled" };
type RunEvent = Exclude<JobEvent, { type: "remove" }>;
type UntimedEvent<T = RunEvent> = T extends RunEvent ? Omit<T, "at"> : never;

// 完了した工程の割合。処理時間・転送量・FFmpegコマンドの進捗率ではない。
// 不要なencodeはmux開始で通過済みとし、100％は保存と入力解放後だけ確定する。
const stagePercent = { audio: 0, prepare: 20, encode: 40, mux: 60, save: 80 } as const;

function savedDownloads(saved: readonly SavedLocalFile[], job: Job): JobDownloads | undefined {
  const extensions = ["m4a", ...(job.saveAac ? ["aac"] : []), ...(job.saveJpeg ? ["jpg"] : [])];
  if (!Array.isArray(saved) || saved.length > extensions.length) throw new JobMediaError("DOWNLOAD_FAILED");
  if (!saved.length) return undefined;
  let stem: string | undefined;
  const receipt: Record<string, number> = {};
  saved.forEach((file, index) => {
    const extension = extensions[index];
    if (!file || typeof file.requestedFilename !== "string" || !file.requestedFilename.endsWith(`.${extension}`)) {
      throw new JobMediaError("DOWNLOAD_FAILED");
    }
    const currentStem = file.requestedFilename.slice(0, -(extension.length + 1));
    if (!currentStem || (stem !== undefined && stem !== currentStem)) throw new JobMediaError("DOWNLOAD_FAILED");
    stem = currentStem;
    receipt[extension === "jpg" ? "jpeg" : extension] = file.id;
  });
  return validateJobDownloads(receipt);
}

// 長時間処理は独立ウィンドウ側で実行し、状態の確定はService Worker側のportへ委ねる。
export class JobRunner {
  private readonly scheduler: JobScheduler;
  private readonly ports: JobRunnerPorts;
  private readonly running = new Map<string, Promise<JobRunResult>>();
  private stopped = false;
  constructor(ports: JobRunnerPorts, limits: { concurrency: number; mediaSlots: number }) {
    this.ports = ports;
    this.scheduler = new JobScheduler(limits);
  }

  setLimits(limits: { concurrency: number; mediaSlots: number }): void { this.scheduler.setLimits(limits); }
  setConcurrency(concurrency: number): void { this.scheduler.setConcurrency(concurrency); }
  cancel(id: string): boolean { return this.scheduler.cancel(id); }
  isRunning(id: string): boolean { return this.running.has(id); }

  // 一覧操作用。すでに停止要求済みでも同じ終了を待ち、状態を先に取消しへ変えない。
  async cancelAndWait(id: string): Promise<boolean> {
    const pending = this.running.get(id);
    if (!pending) return false;
    this.scheduler.cancel(id);
    await pending;
    return true;
  }

  async wait(id: string): Promise<void> { await this.running.get(id); }

  // ウィンドウ終了時の状態・入力消去は、この停止確認後に行う。
  async stop(): Promise<void> {
    this.stopped = true;
    this.scheduler.cancelAll();
    await Promise.allSettled([...this.running.values()]);
  }

  start(id: string): Promise<JobRunResult> {
    if (this.stopped) return Promise.reject(new JobMediaError("WORKER_FAILED"));
    const existing = this.running.get(id);
    if (existing) return existing;
    let current: Job | undefined;
    let failureCode: JobErrorCode = "WORKER_FAILED";
    let downloads: JobDownloads | undefined;
    const event = async (raw: UntimedEvent) => {
      const at = Math.max(Date.now(), current?.updatedAt ?? 0);
      current = await this.ports.state.apply({ ...raw, at } as JobEvent);
    };
    const stage = async (value: keyof typeof stagePercent) => {
      // FFmpegのコマンド単位の指標を、ジョブ全体のパーセントに流用しない。
      await event({ type: "progress", id, stage: value, percent: stagePercent[value] });
    };
    const scheduled = this.scheduler.submit(id, async ({ signal, runMedia }) => {
      current = await this.ports.state.get(id);
      signal.throwIfAborted();
      if (!current || current.status !== "waiting") throw new Error("待機中のジョブが見つかりません");
      await event({ type: "start", id });
      let acquired: AcquiredAudio | undefined;
      let warning = false;
      let failed = false;
      try {
        failureCode = "JOB_IMAGE_UNAVAILABLE";
        const fixed = Object.freeze({ ...current, thumbnail: validateJobThumbnail(current.thumbnail) });
        failureCode = "AUDIO_FETCH_FAILED";
        await stage("audio");
        signal.throwIfAborted();
        acquired = await this.ports.acquire(fixed, signal);
        signal.throwIfAborted();
        failureCode = "WORKER_FAILED";
        const output = await runMedia(async () => {
          await stage("prepare");
          signal.throwIfAborted();
          const phaseAbort = new AbortController();
          const mediaSignal = AbortSignal.any([signal, phaseAbort.signal]);
          let accepting = true, phaseFailed = false, last: MediaStage | undefined;
          let phaseEvents: Promise<void> = Promise.resolve();
          const onStage = (value: MediaStage) => {
            if (!accepting || signal.aborted || phaseFailed) return;
            if ((value !== "encode" && value !== "mux") || (last === "mux" && value === "encode")) {
              throw new JobMediaError("WORKER_FAILED");
            }
            if (last === value) return;
            last = value;
            phaseEvents = phaseEvents.then(async () => {
              if (!signal.aborted && !phaseFailed) await stage(value);
            }).catch(() => {
              phaseFailed = true;
              phaseAbort.abort(new JobMediaError("WORKER_FAILED"));
            });
          };
          // HLSの復号・AAC抽出も同じmedia枠内で実行し、取得枠に重いWorkerを作らない。
          const source = acquired!.hls ?? acquired!.aac!;
          try { return await this.ports.process(fixed, source, mediaSignal, onStage); }
          finally {
            accepting = false;
            await phaseEvents;
            if (phaseFailed) throw new JobMediaError("WORKER_FAILED");
          }
        });
        signal.throwIfAborted();
        failureCode = "DOWNLOAD_FAILED";
        await stage("save");
        signal.throwIfAborted();
        const saved = await this.ports.save(fixed, output, signal);
        if (saved !== undefined) {
          const extensions = ["m4a", ...(fixed.saveAac ? ["aac"] : []),
            ...(fixed.saveJpeg && output.jpeg ? ["jpg"] : [])];
          if (!Array.isArray(saved) || saved.length !== extensions.length) throw new JobMediaError("DOWNLOAD_FAILED");
          downloads = savedDownloads(saved, fixed);
        }
        signal.throwIfAborted();
        warning = output.warning;
      } catch (error) {
        failed = true;
        if (error instanceof JobMediaError) failureCode = error.code;
        throw error;
      } finally {
        try { await acquired?.dispose(); }
        catch (error) {
          // 元の失敗を隠さず、成功経路の後片付け失敗も完了扱いにしない。
          if (!failed) { failureCode = "WORKER_FAILED"; throw error; }
        }
      }
      signal.throwIfAborted();
      await event({ type: "complete", id, warning, downloads });
      return { id, status: warning ? "warning" : "complete" } as JobRunResult;
    });
    const result = scheduled.catch(async (error: unknown): Promise<JobRunResult> => {
      // 待機枠で止めた場合は実行本体に入らないため、状態をここで読み戻す。
      current = await this.ports.state.get(id);
      if (current && ["complete", "warning", "error", "cancelled"].includes(current.status)) {
        return { id, status: current.status as JobRunResult["status"] };
      }
      if (!current || !["waiting", "processing"].includes(current.status)) throw error;
      let saveIssue: JobSaveIssue | undefined = downloads ? { completed: validateJobDownloads(downloads) } : undefined;
      if (error instanceof DownloadSaveError || error instanceof DownloadSaveAborted) {
        try {
          const completed = savedDownloads(error.completed, current);
          const pendingDownloadId = error instanceof DownloadSaveError && !error.cancellationConfirmed
            ? error.pendingDownloadId : undefined;
          if (completed || pendingDownloadId !== undefined) saveIssue = validateJobSaveIssue({ completed, pendingDownloadId });
        } catch {
          // 不正な部分結果の本文や名前を状態へ流さず、保存失敗として扱う。
          failureCode = "DOWNLOAD_FAILED";
          error = new JobMediaError("DOWNLOAD_FAILED");
        }
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        await event({ type: "cancel", id, ...(saveIssue ? { saveIssue } : {}) });
        return { id, status: "cancelled" };
      }
      if (current.status !== "processing") throw error;
      await event({ type: "error", id, code: failureCode, ...(saveIssue ? { saveIssue } : {}) });
      return { id, status: "error" };
    }).finally(() => { this.running.delete(id); });
    this.running.set(id, result);
    return result;
  }
}
