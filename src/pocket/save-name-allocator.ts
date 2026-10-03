import { outputNames } from "./filename.js";
import { DownloadSaveError, NICOPOCKET_DOWNLOAD_FOLDER } from "./download-saver.js";

export type SaveNameReservation = {
  readonly names: Readonly<{ m4a: string; aac: string; jpeg: string }>;
  // 書き込みを試みた名前は、このウィンドウ内では再使用しない。
  release(keepNames?: boolean): void;
};

const active = new Set<string>();
const attempted = new Set<string>();
const filenameKey = (name: string) => name.normalize("NFC").toLowerCase().replace(/\.jpeg$/, ".jpg");
const folderPattern = String.raw`[/\\][Nn][Ii][Cc][Oo][Pp][Oo][Cc][Kk][Ee][Tt][/\\][^/\\]+$`;

function historyFilename(path: string): string | undefined {
  const parts = path.replaceAll("\\", "/").split("/");
  if (parts.at(-2)?.toLowerCase() !== NICOPOCKET_DOWNLOAD_FOLDER.toLowerCase()) return;
  const leaf = parts.at(-1);
  return leaf && /\.(?:m4a|aac|jpe?g)$/i.test(leaf) ? filenameKey(leaf) : undefined;
}

async function readHistory(signal: AbortSignal): Promise<chrome.downloads.DownloadItem[]> {
  const query = chrome.downloads.search({ filenameRegex: folderPattern, limit: 0 });
  // 読み取りには停止すべき書き込みがない。遅いAPI応答を待たずに中断できる。
  return new Promise((resolve, reject) => {
    const remove = () => signal.removeEventListener("abort", aborted);
    const aborted = () => { remove(); reject(signal.reason); };
    signal.addEventListener("abort", aborted, { once: true });
    query.then((items) => { remove(); resolve(items); }, (error: unknown) => { remove(); reject(error); });
    if (signal.aborted) aborted();
  });
}

// Chrome履歴と同一ウィンドウの予約を照合する。OSの新規ファイル作成を予約するAPIではない。
// 履歴外のファイル・外部同時作成・手動指定は保存部品の実名照合で別途検出する。
export async function reserveJobSaveNames(title: string, videoId: string,
  signal: AbortSignal): Promise<SaveNameReservation> {
  signal.throwIfAborted();
  try {
    // 不正な動画IDなどは履歴参照前に拒否する。
    outputNames(title, videoId, 0, true, true);
    const items = await readHistory(signal);
    signal.throwIfAborted();
    const occupied = new Set<string>();
    for (const item of items) {
      // existsは非同期更新されるので、消去済み表示の履歴も保守的に扱う。
      const name = typeof item.filename === "string" ? historyFilename(item.filename) : undefined;
      if (name) occupied.add(name);
    }
    for (let sequence = 0; sequence <= occupied.size + active.size + attempted.size; sequence++) {
      const candidate = outputNames(title, videoId, sequence, true, true);
      const names = Object.freeze({ m4a: candidate.m4a, aac: candidate.aac!, jpeg: candidate.jpeg! });
      const keys = Object.values(names).map(filenameKey);
      if (keys.some((name) => occupied.has(name) || active.has(name) || attempted.has(name))) continue;
      // awaitを挟まず照合と予約を行い、同時要求の同名割当を防ぐ。
      keys.forEach((name) => active.add(name));
      let released = false;
      return { names, release(keepNames = false) {
        if (released) return;
        released = true;
        keys.forEach((name) => { active.delete(name); if (keepNames) attempted.add(name); });
      } };
    }
    throw new DownloadSaveError();
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted();
    // 履歴のURL・絶対パスやAPIの例外本文をジョブエラーへ持ち込まない。
    throw new DownloadSaveError();
  }
}
