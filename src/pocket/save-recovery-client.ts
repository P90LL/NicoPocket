import type { SaveLifecycle } from "./download-saver.js";

// 保存IDはChromeから返った直後に保持し、履歴で終了を確認した後に解除する。
// タイトル・パス・URL・媒体を復旧用メッセージへ含めない。
export function createSaveRecoveryLifecycle(videoId: string): SaveLifecycle {
  if (!/^[a-zA-Z0-9]{1,128}$/u.test(videoId)) throw new Error("保存の動画識別子が正しくありません。");
  const send = async (kind: "np:retain-save" | "np:release-save", downloadId: number) => {
    try {
      if (!Number.isSafeInteger(downloadId) || downloadId < 0) throw new Error();
      const reply: unknown = await chrome.runtime.sendMessage({ kind, videoId, downloadId });
      if (!reply || typeof reply !== "object" || !("ok" in reply) || reply.ok !== true) throw new Error();
    } catch { throw new Error("保存の復旧情報を更新できませんでした。"); }
  };
  return { started: downloadId => send("np:retain-save", downloadId),
    finished: downloadId => send("np:release-save", downloadId) };
}
