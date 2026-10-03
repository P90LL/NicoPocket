import { validateJobSaveIssue, type Job } from "./jobs.js";

export type PendingSave = { videoId: string; downloadId: number };

// 復旧用の記録には識別子だけを残し、履歴・媒体・パスを持ち込まない。
export function restorePendingSaves(raw: unknown): PendingSave[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("保存の復旧情報を確認できませんでした。");
  const result: PendingSave[] = [];
  for (const value of raw) {
    if (typeof value !== "object" || value === null || Array.isArray(value)
      || Object.keys(value).some(key => !["videoId", "downloadId"].includes(key))
      || typeof value.videoId !== "string" || !/^[a-zA-Z0-9]{1,128}$/.test(value.videoId)
      || !Number.isSafeInteger(value.downloadId) || value.downloadId < 0) {
      throw new Error("保存の復旧情報を確認できませんでした。");
    }
    if (!result.some(item => item.videoId === value.videoId && item.downloadId === value.downloadId)) {
      result.push({ videoId: value.videoId, downloadId: value.downloadId });
    }
  }
  return result;
}

export function retainPendingSaves(raw: unknown, jobs: Job[]): PendingSave[] {
  const pending = restorePendingSaves(raw);
  for (const job of jobs) {
    const downloadId = validateJobSaveIssue(job.saveIssue)?.pendingDownloadId;
    if (downloadId !== undefined) pending.push({ videoId: job.videoId, downloadId });
  }
  return restorePendingSaves(pending);
}
