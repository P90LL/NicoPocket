import type { JobStatePort } from "./job-runner.js";
import { validateJobDownloads, validateJobSaveIssue, validateJobExecutionEvent, type Job } from "./jobs.js";

function replyJob(reply: unknown, id: string, required: boolean): Job | undefined {
  if (!reply || typeof reply !== "object" || !("ok" in reply) || reply.ok !== true) {
    throw new Error("実行状態を確認できませんでした。");
  }
  const value = (reply as { job?: Job }).job;
  if (value === undefined && !required) return undefined;
  if (!value || value.id !== id || !["waiting", "processing", "complete", "warning", "error", "cancelled"].includes(value.status)
    || !Number.isFinite(value.updatedAt) || !Number.isInteger(value.percent) || value.percent < 0 || value.percent > 100) {
    throw new Error("実行状態の応答が正しくありません。");
  }
  try {
    const downloads = validateJobDownloads(value.downloads);
    const saveIssue = validateJobSaveIssue(value.saveIssue);
    return { ...value, ...(downloads ? { downloads } : {}), ...(saveIssue ? { saveIssue } : {}) };
  }
  catch { throw new Error("実行状態の応答が正しくありません。"); }
}

async function send(message: unknown): Promise<unknown> {
  try { return await chrome.runtime.sendMessage(message); }
  catch { throw new Error("実行状態を確認できませんでした。"); }
}

// 本体画面から使う状態port。入力や処理結果は送らず、固定した状態イベントだけを送る。
export function createJobStatePort(): JobStatePort {
  return {
    async get(id) {
      if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("ジョブ識別子が正しくありません");
      return replyJob(await send({ kind: "np:read-job", id }), id, false);
    },
    async apply(raw) {
      const event = validateJobExecutionEvent(raw, Date.now());
      return replyJob(await send({ kind: "np:apply-job-event", event }), event.id, true)!;
    }
  };
}
