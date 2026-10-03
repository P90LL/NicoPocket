import type { Job } from "./jobs.js";
import type { JobMediaOutput } from "./job-media.js";
import { DownloadSaveError, NICOPOCKET_DOWNLOAD_FOLDER, saveLocalFiles,
  type LocalSaveFile, type SavedLocalFile, type SaveLifecycle } from "./download-saver.js";
import { outputNames } from "./filename.js";
import { reserveJobSaveNames } from "./save-name-allocator.js";

export type JobSaveNames = { m4a: string; aac?: string; jpeg?: string };

// 名前の予約は呼び出し側で行う。ここでは登録時の選択と成果物の対応だけを固定する。
export function prepareJobSaveFiles(job: Pick<Job, "saveAac" | "saveJpeg" | "thumbnail">,
  output: JobMediaOutput, names: JobSaveNames): LocalSaveFile[] {
  const invalid = () => new DownloadSaveError();
  const stem = typeof names.m4a === "string" && names.m4a.endsWith(".m4a") ? names.m4a.slice(0, -4) : "";
  if (!stem || /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(stem)
    || stem.startsWith(".") || /[. ]$/.test(stem)) throw invalid();
  const bytes = (value: Uint8Array | undefined): Uint8Array<ArrayBuffer> => {
    if (!(value instanceof Uint8Array) || !value.length) throw invalid();
    return value.slice();
  };
  const files: LocalSaveFile[] = [{ filename: names.m4a,
    blob: new Blob([bytes(output.m4a)], { type: "application/octet-stream" }) }];
  if (job.saveAac) {
    if (names.aac !== `${stem}.aac`) throw invalid();
    files.push({ filename: names.aac, blob: new Blob([bytes(output.aac)], { type: "audio/aac" }) });
  }
  if (job.saveJpeg) {
    if (names.jpeg !== `${stem}.jpg`) throw invalid();
    if (output.jpeg) files.push({ filename: names.jpeg, blob: new Blob([bytes(output.jpeg)], { type: "image/jpeg" }) });
    else if (job.thumbnail || !output.warning || !output.warnings.includes("COVER_UNAVAILABLE")) throw invalid();
    // 登録画像がない警告継続では、存在しないJPEGを作らない。
  }
  return files;
}

export async function saveJobMedia(job: Pick<Job, "saveAac" | "saveJpeg" | "thumbnail">,
  output: JobMediaOutput, names: JobSaveNames, signal: AbortSignal): Promise<SavedLocalFile[]> {
  signal.throwIfAborted();
  return saveLocalFiles(prepareJobSaveFiles(job, output, names), signal, NICOPOCKET_DOWNLOAD_FOLDER, true);
}

// 製品用の入口。画像・保存選択・バイト列を履歴参照前に固定する。
export async function saveJobMediaWithAllocatedNames(
  job: Pick<Job, "title" | "videoId" | "saveAac" | "saveJpeg" | "thumbnail">,
  output: JobMediaOutput, signal: AbortSignal, lifecycle?: SaveLifecycle): Promise<SavedLocalFile[]> {
  signal.throwIfAborted();
  const title = job.title, videoId = job.videoId;
  const files = prepareJobSaveFiles(job, output, outputNames(title, videoId, 0, job.saveAac, job.saveJpeg));
  const reservation = await reserveJobSaveNames(title, videoId, signal);
  let attemptedSave = false;
  try {
    signal.throwIfAborted();
    const names = reservation.names;
    const fixed = files.map((file) => ({ ...file,
      filename: file.filename.endsWith(".m4a") ? names.m4a : file.filename.endsWith(".aac") ? names.aac : names.jpeg }));
    attemptedSave = true;
    return await saveLocalFiles(fixed, signal, NICOPOCKET_DOWNLOAD_FOLDER, true, lifecycle);
  } finally { reservation.release(attemptedSave); }
}
