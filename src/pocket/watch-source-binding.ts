export interface WatchSourceBinding {
  tabId: number;
  documentId: string;
  epoch: string;
}

const token = (value: unknown): value is string => typeof value === "string"
  && /^[a-zA-Z0-9_-]{1,128}$/u.test(value);
const failure = () => new Error("取得元の視聴ページを確認できませんでした。");

export function validateWatchSourceBinding(raw: unknown): WatchSourceBinding {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw failure();
  const row = raw as Record<string, unknown>;
  if (Object.keys(row).length !== 3 || typeof row.tabId !== "number" || !Number.isSafeInteger(row.tabId)
    || row.tabId < 0 || !token(row.documentId) || !token(row.epoch)) throw failure();
  return { tabId: row.tabId, documentId: row.documentId, epoch: row.epoch };
}

// tabId/documentIdは要求本文から受け取らず、Chromeが付けた最上位文書の送信元から作る。
export function watchSourceFromSender(sender: chrome.runtime.MessageSender, videoId: string,
  epoch: unknown, extensionId: string): WatchSourceBinding {
  if (sender.id !== extensionId || sender.frameId !== 0 || !token(videoId) || !sender.url) throw failure();
  let url: URL;
  try { url = new URL(sender.url); } catch { throw failure(); }
  if (url.protocol !== "https:" || url.hostname !== "www.nicovideo.jp" || url.port
    || url.username || url.password || !new RegExp(`^/watch/${videoId}/?$`, "u").test(url.pathname)) throw failure();
  return validateWatchSourceBinding({ tabId: sender.tab?.id, documentId: sender.documentId, epoch });
}

// 同じ文書でも、観測した別動画への遷移で更新されたepochを照合する。
export async function confirmWatchSource(binding: WatchSourceBinding, videoId: string,
  send: (tabId: number, message: unknown, options: { documentId: string }) => Promise<unknown>): Promise<void> {
  const checked = validateWatchSourceBinding(binding);
  if (!token(videoId)) throw failure();
  let reply: unknown;
  try { reply = await send(checked.tabId, { kind: "probe-watch-source", videoId, epoch: checked.epoch },
    { documentId: checked.documentId }); } catch { throw failure(); }
  if (!reply || typeof reply !== "object" || !("ok" in reply) || reply.ok !== true
    || !("videoId" in reply) || reply.videoId !== videoId || !("epoch" in reply) || reply.epoch !== checked.epoch) throw failure();
}
