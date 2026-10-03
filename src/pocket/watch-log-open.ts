import { inspectPlayerSystemLog } from "./watch-system-log.js";

// Adapted from nico_downloader: SystemMessageAutoOpenToText (MIT).
// Copyright (c) 2021 masteralice3104. Full notice: nico_downloader/LICENSE.
// 元のinline onclick/evalは使わず、同じ設定・表示ボタンを直接操作する。
export const logOpenStatuses = ["not-needed", "missing-control", "ambiguous-control", "disabled-control",
  "source-changed", "opened", "no-messages"] as const;
export type LogOpenStatus = typeof logOpenStatuses[number];
type Result = { log: ReturnType<typeof inspectPlayerSystemLog>; status: LogOpenStatus };

export function openPlayerSystemLog(document: Document, videoId: string, isCurrent: () => boolean,
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 50))): Promise<Result> | undefined {
  const buttons = () => [...document.querySelectorAll<HTMLElement>('button,[role="button"]')];
  const messages = () => buttons().filter(node => node.textContent?.trim() === "システムメッセージを表示");
  const settings = buttons().filter(node => node.getAttribute("aria-label") === "設定");
  const initial = messages();
  // 対象がないページには操作を行わない。
  if (!initial.length && !settings.length) return;
  const disabled = (node: HTMLElement) => (node as HTMLButtonElement).disabled === true
    || node.getAttribute("aria-disabled") === "true";
  const result = (status: LogOpenStatus): Result => ({ status, log: inspectPlayerSystemLog(document, videoId) });
  return (async () => {
    if (!isCurrent()) return result("source-changed");
    if (initial.length > 1 || !initial.length && settings.length > 1) return result("ambiguous-control");
    if (!initial.length) {
      if (disabled(settings[0]!)) return result("disabled-control");
      settings[0]!.click();
    }
    let opened = false;
    // 設定メニューとログ描画に合計最大2秒。遷移した文書を追加しない。
    for (let check = 0; check < 40; check++) {
      if (!isCurrent()) return result("source-changed");
      if (!opened) {
        const matches = messages();
        if (matches.length > 1) return result("ambiguous-control");
        if (matches.length === 1) {
          if (disabled(matches[0]!)) return result("disabled-control");
          matches[0]!.click(); opened = true;
        }
      }
      const log = inspectPlayerSystemLog(document, videoId);
      if (opened && log.summary.messages > 0) return { log, status: "opened" };
      await pause();
    }
    return result(opened ? "no-messages" : "missing-control");
  })();
}
