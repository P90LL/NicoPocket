import { defaultSettings, type Settings, type VideoDraft } from "./state.js";
import { validateJobThumbnail, type JobThumbnail } from "./job-images.js";

export type JobStatus = "waiting" | "processing" | "complete" | "warning" | "error" | "cancelled";
export type JobStage = "audio" | "thumbnail" | "analysis" | "prepare" | "encode" | "mux" | "save";
export const jobErrorCodes = ["AUDIO_FETCH_FAILED", "THUMBNAIL_FETCH_FAILED",
  "IMAGE_ANALYSIS_FAILED", "AUDIO_CONVERSION_FAILED", "M4A_MUX_FAILED",
  "DOWNLOAD_FAILED", "WORKER_FAILED", "JOB_IMAGE_UNAVAILABLE"] as const;
export type JobErrorCode = typeof jobErrorCodes[number];
export type JobDownloads = { m4a: number; aac?: number; jpeg?: number };
export type JobSaveIssue = { completed?: JobDownloads; pendingDownloadId?: number };
export function validateJobDownloads(raw: unknown): JobDownloads | undefined {
  if (raw === undefined) return undefined;
  const invalid = () => new Error("保存結果が正しくありません");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid();
  const value = raw as Record<string, unknown>;
  const validId = (id: unknown) => typeof id === "number" && Number.isSafeInteger(id) && id >= 0;
  if (!validId(value.m4a) || Object.keys(value).some((key) => !["m4a", "aac", "jpeg"].includes(key))
    || (value.aac !== undefined && !validId(value.aac)) || (value.jpeg !== undefined && !validId(value.jpeg))) throw invalid();
  const ids = [value.m4a, value.aac, value.jpeg].filter((id) => id !== undefined);
  if (new Set(ids).size !== ids.length) throw invalid();
  return { m4a: value.m4a as number,
    ...(value.aac !== undefined ? { aac: value.aac as number } : {}),
    ...(value.jpeg !== undefined ? { jpeg: value.jpeg as number } : {}) };
}
export function validateJobSaveIssue(raw: unknown): JobSaveIssue | undefined {
  if (raw === undefined) return undefined;
  const invalid = () => new Error("保存状況が正しくありません");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["completed", "pendingDownloadId"].includes(key))) throw invalid();
  const completed = validateJobDownloads(value.completed);
  const pending = value.pendingDownloadId;
  if (pending !== undefined && (typeof pending !== "number" || !Number.isSafeInteger(pending) || pending < 0
    || (completed && Object.values(completed).includes(pending)))) throw invalid();
  if (!completed && pending === undefined) throw invalid();
  return { ...(completed ? { completed } : {}), ...(pending !== undefined ? { pendingDownloadId: pending as number } : {}) };
}
export function jobSaveIssueMessage(raw: unknown): string | undefined {
  const issue = validateJobSaveIssue(raw);
  if (!issue) return undefined;
  return [issue.completed ? "保存済みのファイルがあります。保存済みファイルは削除していません。" : "",
    issue.pendingDownloadId !== undefined ? "保存の停止を確認できませんでした。Chromeのダウンロード一覧をご確認ください。" : ""]
    .filter(Boolean).join(" ");
}
function permitsSaveIssue(code: JobErrorCode, issue: JobSaveIssue): boolean {
  return code === "DOWNLOAD_FAILED" || (code === "WORKER_FAILED" && issue.pendingDownloadId === undefined);
}

export type JobErrorDetail = { code: JobErrorCode; stage?: JobStage; attempt: number; at: number };
export const jobErrorSummary: Record<JobErrorCode, string> = {
  AUDIO_FETCH_FAILED: "音声の取得に失敗しました。",
  THUMBNAIL_FETCH_FAILED: "サムネイルの取得に失敗しました。",
  IMAGE_ANALYSIS_FAILED: "画像の解析に失敗しました。",
  AUDIO_CONVERSION_FAILED: "音声の変換に失敗しました。",
  M4A_MUX_FAILED: "M4A の生成に失敗しました。",
  DOWNLOAD_FAILED: "ファイルの保存に失敗しました。",
  WORKER_FAILED: "処理を完了できませんでした。",
  JOB_IMAGE_UNAVAILABLE: "登録時の画像を復元できませんでした。"
};

export interface Job {
  id: string;
  videoId: string;
  title: string;
  sourceUrl: string;
  quality: VideoDraft["quality"];
  saveAac: boolean;
  saveJpeg: boolean;
  compressionRetries: number;
  thumbnail?: JobThumbnail;
  status: JobStatus;
  stage?: JobStage;
  percent: number;
  summary?: string;
  errorDetail?: JobErrorDetail;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  downloads?: JobDownloads;
  saveIssue?: JobSaveIssue;
}

export type JobEvent =
  | { type: "start"; id: string; at: number }
  | { type: "progress"; id: string; stage: JobStage; percent: number; at: number }
  | { type: "complete"; id: string; at: number; warning?: boolean; downloads?: JobDownloads }
  | { type: "error"; id: string; at: number; code: JobErrorCode; saveIssue?: JobSaveIssue }
  | { type: "cancel"; id: string; at: number; saveIssue?: JobSaveIssue }
  | { type: "retry"; id: string; at: number }
  | { type: "remove"; id: string };

export type JobExecutionEvent = Exclude<JobEvent, { type: "retry" | "remove" }>;
export function validateJobExecutionEvent(raw: unknown, at: number): JobExecutionEvent {
  const invalid = () => new Error("実行状態の更新要求が正しくありません");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)
    || !Number.isFinite(at) || at < 0) throw invalid();
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.id)
    || ("at" in value && (typeof value.at !== "number" || !Number.isFinite(value.at) || value.at < 0))) throw invalid();
  const id = value.id;
  const allowed = value.type === "progress" ? ["stage", "percent"]
    : value.type === "complete" ? ["warning", "downloads"] : value.type === "error" ? ["code", "saveIssue"]
    : value.type === "cancel" ? ["saveIssue"] : [];
  if (Object.keys(value).some((key) => !["type", "id", "at", ...allowed].includes(key))) throw invalid();
  if (value.type === "start") return { type: value.type, id, at };
  if (value.type === "cancel") {
    const saveIssue = validateJobSaveIssue(value.saveIssue);
    if (saveIssue?.pendingDownloadId !== undefined) throw invalid();
    return { type: "cancel", id, at, ...(saveIssue ? { saveIssue } : {}) };
  }
  if (value.type === "progress" && typeof value.stage === "string" && value.stage in jobStageLabel
    && Object.hasOwn(jobStageLabel, value.stage) && Number.isInteger(value.percent)
    && Number(value.percent) >= 0 && Number(value.percent) <= 100) {
    return { type: "progress", id, at, stage: value.stage as JobStage, percent: value.percent as number };
  }
  if (value.type === "complete" && (value.warning === undefined || typeof value.warning === "boolean")) {
    return { type: "complete", id, at, warning: value.warning as boolean | undefined,
      downloads: validateJobDownloads(value.downloads) };
  }
  if (value.type === "error" && jobErrorCodes.includes(value.code as JobErrorCode)) {
    const saveIssue = validateJobSaveIssue(value.saveIssue);
    if (saveIssue && !permitsSaveIssue(value.code as JobErrorCode, saveIssue)) throw invalid();
    return { type: "error", id, at, code: value.code as JobErrorCode, ...(saveIssue ? { saveIssue } : {}) };
  }
  throw invalid();
}

export const jobStatusLabel: Record<JobStatus, string> = {
  waiting: "待機中", processing: "処理中", complete: "完了", warning: "警告",
  error: "エラー", cancelled: "キャンセル"
};

export const jobStageLabel: Record<JobStage, string> = {
  audio: "音声取得", thumbnail: "サムネイル取得", analysis: "画像解析",
  prepare: "音声処理の準備",
  encode: "音声変換", mux: "M4A 生成", save: "保存"
};

export function formatJobErrorLog(detail: JobErrorDetail): string {
  return [`時刻: ${new Date(detail.at).toISOString()}`,
    `工程: ${detail.stage ? jobStageLabel[detail.stage] : "未指定"}`,
    `エラーコード: ${detail.code}`,
    `試行回数: ${detail.attempt}`].join("\n");
}

export function hasPendingSaveForVideo(jobs: Job[], videoId: string): boolean {
  return jobs.some((job) => job.videoId === videoId
    && validateJobSaveIssue(job.saveIssue)?.pendingDownloadId !== undefined);
}

export function appendJob(jobs: Job[], draft: VideoDraft, id: string, at: number,
  settings: Pick<Settings, "compressionRetries"> = defaultSettings, thumbnail?: JobThumbnail): Job[] {
  if (!id || jobs.some((job) => job.id === id) || !Number.isFinite(at) || at < 0) {
    throw new Error("ジョブ識別子または時刻が正しくありません");
  }
  if (hasPendingSaveForVideo(jobs, draft.videoId)) {
    throw new Error("同じ動画の保存の終了を確認してから登録してください。");
  }
  if (jobs.some((job) => job.videoId === draft.videoId
    && (job.status === "waiting" || job.status === "processing"))) {
    throw new Error("同じ動画がすでに待機中または処理中です");
  }
  if (!Number.isInteger(settings.compressionRetries) || settings.compressionRetries < 1
    || settings.compressionRetries > 5) throw new Error("圧縮再試行回数が正しくありません");
  return [...jobs, {
    id, videoId: draft.videoId, title: draft.title, sourceUrl: draft.sourceUrl,
    quality: draft.quality, saveAac: draft.saveAac, saveJpeg: draft.saveJpeg,
    compressionRetries: settings.compressionRetries,
    thumbnail: validateJobThumbnail(thumbnail),
    status: "waiting", percent: 0, createdAt: at, updatedAt: at, attempts: 0
  }];
}

export function applyJobEvent(jobs: Job[], event: JobEvent): Job[] {
  const index = jobs.findIndex((job) => job.id === event.id);
  if (index < 0) throw new Error("ジョブが見つかりません");
  const current = jobs[index];
  if (event.type === "remove") {
    if (validateJobSaveIssue(current.saveIssue)?.pendingDownloadId !== undefined) {
      throw new Error("保存の終了を確認してから削除してください。");
    }
    if (current.status === "processing") throw new Error("処理中のジョブは先にキャンセルしてください");
    return jobs.filter((job) => job.id !== event.id);
  }
  if (!Number.isFinite(event.at) || event.at < current.updatedAt) throw new Error("ジョブ時刻が正しくありません");

  let next: Job;
  if ((event.type === "start" || event.type === "retry")
    && hasPendingSaveForVideo(jobs, current.videoId)) {
    throw new Error("保存の終了を確認してから再試行してください。");
  }
  const saveIssue = event.type === "error" || event.type === "cancel" ? validateJobSaveIssue(event.saveIssue) : undefined;
  if (saveIssue && ((event.type === "error" && !permitsSaveIssue(event.code, saveIssue))
    || (event.type === "cancel" && saveIssue.pendingDownloadId !== undefined)
    || current.status !== "processing" || current.stage !== "save"
    || (!current.saveAac && saveIssue.completed?.aac !== undefined)
    || (!current.saveJpeg && saveIssue.completed?.jpeg !== undefined)
    || (current.saveAac && saveIssue.completed?.jpeg !== undefined && saveIssue.completed.aac === undefined))) {
    throw new Error("保存状況と実行状態が一致しません");
  }
  if (event.type === "start") {
    if (current.status !== "waiting") throw new Error("待機中のジョブだけ開始できます");
    next = { ...current, status: "processing", downloads: undefined, saveIssue: undefined, attempts: current.attempts + 1, updatedAt: event.at };
  } else if (event.type === "progress") {
    if (current.status !== "processing" || !Number.isInteger(event.percent)
      || event.percent < current.percent || event.percent > 100) {
      throw new Error("進捗の更新が正しくありません");
    }
    next = { ...current, stage: event.stage, percent: event.percent, updatedAt: event.at };
  } else if (event.type === "complete") {
    if (current.status !== "processing") throw new Error("処理中のジョブだけ完了できます");
    const downloads = validateJobDownloads(event.downloads);
    if (downloads && ((current.saveAac ? downloads.aac === undefined : downloads.aac !== undefined)
      || (!current.saveJpeg && downloads.jpeg !== undefined)
      || (current.saveJpeg && current.thumbnail && downloads.jpeg === undefined))) {
      throw new Error("保存結果と登録時の選択が一致しません");
    }
    next = { ...current, status: event.warning ? "warning" : "complete",
      percent: 100, stage: undefined, downloads, saveIssue: undefined, updatedAt: event.at };
  } else if (event.type === "error") {
    if (current.status !== "processing" || !jobErrorCodes.includes(event.code)) {
      throw new Error("エラー状態またはコードが正しくありません");
    }
    next = { ...current, status: "error", stage: undefined,
      saveIssue, summary: jobErrorSummary[event.code], errorDetail: { code: event.code, stage: current.stage,
        attempt: current.attempts, at: event.at }, updatedAt: event.at };
  } else if (event.type === "cancel") {
    if (current.status !== "waiting" && current.status !== "processing") {
      throw new Error("待機中・処理中のジョブだけキャンセルできます");
    }
    next = { ...current, status: "cancelled", stage: undefined, saveIssue, updatedAt: event.at };
  } else {
    if (current.status !== "error" && current.status !== "cancelled") {
      throw new Error("エラー・キャンセル済みのジョブだけ再試行できます");
    }
    if (jobs.some((job) => job.id !== current.id && job.videoId === current.videoId
      && (job.status === "waiting" || job.status === "processing"))) {
      throw new Error("同じ動画がすでに待機中または処理中です");
    }
    next = { ...current, status: "waiting", stage: undefined, percent: 0,
      summary: undefined, errorDetail: undefined, downloads: undefined, saveIssue: undefined, updatedAt: event.at };
  }
  return jobs.map((job, position) => position === index ? next : job);
}

// Chromeの履歴を確認したService Workerだけが呼ぶ。実行イベントからは解決できない。
export function resolveJobSaveIssue(jobs: Job[], result: {
  id: string; pendingDownloadId: number; state: "complete" | "interrupted"; at: number;
}): Job[] {
  const current = jobs.find((job) => job.id === result.id);
  const issue = validateJobSaveIssue(current?.saveIssue);
  if (!current || current.status !== "error" || !issue || issue.pendingDownloadId === undefined || issue.pendingDownloadId !== result.pendingDownloadId
    || !Number.isFinite(result.at) || result.at < current.updatedAt
    || (result.state !== "complete" && result.state !== "interrupted")) {
    throw new Error("保存状況の確認結果が正しくありません");
  }
  const kinds: (keyof JobDownloads)[] = ["m4a"];
  if (current.saveAac) kinds.push("aac");
  if (current.saveJpeg) kinds.push("jpeg");
  const completed = issue.completed;
  const count = completed ? Object.keys(completed).length : 0;
  if (count >= kinds.length || (completed && kinds.slice(0, count).some((kind) => completed[kind] === undefined))) {
    throw new Error("保存状況と登録時の選択が一致しません");
  }
  const saved = result.state === "complete" ? validateJobDownloads({ ...completed, [kinds[count]]: result.pendingDownloadId }) : completed;
  return jobs.map((job) => job.id === current.id ? { ...job,
    saveIssue: saved ? { completed: saved } : undefined, updatedAt: result.at } : job);
}
