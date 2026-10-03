import { JobMediaError } from './job-media-error.js';
import { normalizeFileStem } from "./filename.js";

export type LocalSaveFile = { filename: string; blob: Blob };
export const NICOPOCKET_DOWNLOAD_FOLDER = "NicoPocket";
// ジョブ照合用の末端ファイル名。保存先パスはジョブ状態へ持ち込まない。
export type SavedLocalFile = { id: number; requestedFilename: string };
export type SaveLifecycle = {
  started(downloadId: number): Promise<void>;
  finished(downloadId: number): Promise<void>;
};

export class DownloadSaveError extends JobMediaError {
  readonly completed: readonly SavedLocalFile[];
  readonly cancellationConfirmed: boolean;
  readonly pendingDownloadId?: number;
  constructor(completed: readonly SavedLocalFile[] = [], cancellationConfirmed = true, pendingDownloadId?: number) {
    super("DOWNLOAD_FAILED");
    this.name = "DownloadSaveError";
    this.completed = completed.map((file) => ({ ...file }));
    this.cancellationConfirmed = cancellationConfirmed;
    this.pendingDownloadId = pendingDownloadId;
  }
}

export class DownloadSaveAborted extends DOMException {
  readonly completed: readonly SavedLocalFile[];
  constructor(completed: readonly SavedLocalFile[]) {
    super("ファイルの保存を中断しました。", "AbortError");
    this.completed = completed.map((file) => ({ ...file }));
  }
}

async function saveOne(file: LocalSaveFile, signal: AbortSignal,
  directory?: typeof NICOPOCKET_DOWNLOAD_FOLDER, lifecycle?: SaveLifecycle): Promise<SavedLocalFile> {
  signal.throwIfAborted();
  const api = chrome.downloads;
  if (!api) throw new DownloadSaveError();
  const url = URL.createObjectURL(file.blob);
  let id: number | undefined, settled = false, completed = false;
  let cancelTask: Promise<void> | undefined;
  let cancellationConfirmed = true;
  let journalRequested = false;
  let resolveTerminal!: () => void, rejectTerminal!: (reason: unknown) => void;
  const terminal = new Promise<void>((resolve, reject) => {
    resolveTerminal = resolve; rejectTerminal = reject;
  });
  // 開始IDの応答より先に終了イベントが発生しても、未処理rejectにしない。
  void terminal.catch(() => {});
  const finish = (error?: unknown) => {
    if (settled) return;
    settled = true;
    completed = !error;
    if (error) rejectTerminal(error); else resolveTerminal();
  };
  const cancel = () => {
    if (id === undefined || cancelTask || completed) return;
    cancelTask = api.cancel(id).then(() => {
      // cancelの解決時点でChromeは終了・中断・消去のいずれかを確認している。
      finish(signal.aborted ? signal.reason : new DownloadSaveError());
    }).catch(() => {
      if (completed) return; // 停止応答より先にChromeが保存完了を通知した場合。
      cancellationConfirmed = false;
      finish(new DownloadSaveError([], false, id));
    });
  };
  const changed = (delta: chrome.downloads.DownloadDelta) => {
    if (id === undefined || delta.id !== id) return;
    if (delta.state?.current === "complete") finish();
    else if (delta.state?.current === "interrupted") finish(new DownloadSaveError());
  };
  api.onChanged.addListener(changed);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    // saveAsは省略してChromeの設定に従う。共通連番の割当は後続の責務。
    const relativePath = directory ? `${directory}/${file.filename}` : file.filename;
    id = await api.download({ url, filename: relativePath, conflictAction: "uniquify" });
    if (!Number.isInteger(id) || id < 0) throw new DownloadSaveError();
    if (signal.aborted) cancel();
    if (lifecycle) {
      journalRequested = true;
      await lifecycle.started(id);
    }
    if (signal.aborted) cancel();
    else {
      // IDの応答前に完了した小さなBlobを読み戻す。終了イベントとの競合はfinishで処理する。
      const item = (await api.search({ id }))[0];
      if (!settled) {
        if (!item || item.id !== id) throw new DownloadSaveError();
        if (item.state === "complete") finish();
        else if (item.state === "interrupted") finish(new DownloadSaveError());
      }
    }
    await terminal;
    if (cancelTask) await cancelTask;
    if (!cancellationConfirmed) throw new DownloadSaveError([], false, id);
    signal.throwIfAborted();
    return { id, requestedFilename: file.filename };
  } catch (error) {
    // 状態確認失敗時も、開始済みの保存を放置しない。保存済みファイルは削除しない。
    if (id !== undefined && !settled) cancel();
    if (cancelTask) await cancelTask;
    if (!cancellationConfirmed) throw new DownloadSaveError([], false, id);
    if (signal.aborted) {
      if (completed && id !== undefined) throw new DownloadSaveAborted([{ id, requestedFilename: file.filename }]);
      signal.throwIfAborted();
    }
    if (error instanceof DownloadSaveError) throw error;
    throw new DownloadSaveError(completed && id !== undefined ? [{ id, requestedFilename: file.filename }] : []);
  } finally {
    try {
      // 保持応答が失われた場合も、終了を確認できたIDだけ解除を試みる。
      // 解除失敗は未確認IDとして返し、後続ファイルを開始しない。
      if (journalRequested && id !== undefined && settled && cancellationConfirmed) await lifecycle!.finished(id);
    } catch { throw new DownloadSaveError([], false, id); }
    finally {
      api.onChanged.removeListener(changed);
      signal.removeEventListener("abort", cancel);
      URL.revokeObjectURL(url);
    }
  }
}

// 受け取った名前で順に保存する。全件のChrome終了確認後だけ成功を返す。
// 共通連番の事前予約は呼び出し側。製品ジョブだけ最初のM4Aの名前・場所を基準にする。
export async function saveLocalFiles(files: readonly LocalSaveFile[], signal: AbortSignal,
  directory?: typeof NICOPOCKET_DOWNLOAD_FOLDER, followFirstM4aSelection = false,
  lifecycle?: SaveLifecycle): Promise<SavedLocalFile[]> {
  signal.throwIfAborted();
  // 任意パスは受け取らない。汎用の検証用途か、採用済みの専用フォルダーだけ。
  if (directory !== undefined && directory !== NICOPOCKET_DOWNLOAD_FOLDER) throw new DownloadSaveError();
  const fixed = files.map(({ filename, blob }) => ({ filename, blob }));
  if (!fixed.length || fixed.some(({ filename, blob }) => typeof filename !== "string" || !filename.trim()
    || /[\\/\u0000-\u001f\u007f]/.test(filename) || filename === "." || filename === ".."
    || !(blob instanceof Blob) || blob.size === 0) || new Set(fixed.map((file) => file.filename)).size !== fixed.length) {
    throw new DownloadSaveError();
  }
  const originalStem = fixed[0].filename.endsWith(".m4a") ? fixed[0].filename.slice(0, -4) : "";
  if (followFirstM4aSelection && (directory !== NICOPOCKET_DOWNLOAD_FOLDER || !originalStem
    || fixed.some((file, index) => index === 0 ? file.filename !== `${originalStem}.m4a`
      : file.filename !== `${originalStem}.aac` && file.filename !== `${originalStem}.jpg`))) throw new DownloadSaveError();
  const completed: SavedLocalFile[] = [];
  let confirmedParent: string | undefined;
  try {
    for (const [index, file] of fixed.entries()) {
      const saved = await saveOne(file, signal, directory, lifecycle);
      completed.push(saved);
      if (directory) {
        // 保存先パスはここでだけ照合。Chromeの標準画面での選択を成功後に上書きしない。
        // 終了済みIDは先に保持する。確認失敗でも成果物を自動削除しない。
        const item = (await chrome.downloads.search({ id: saved.id }))[0];
        const path = typeof item?.filename === "string" ? item.filename.replaceAll("\\", "/") : "";
        const leaf = path.slice(path.lastIndexOf("/") + 1), parent = path.slice(0, path.lastIndexOf("/") + 1);
        if (!item || item.id !== saved.id || item.state !== "complete" || item.exists === false
          || item.byExtensionId !== chrome.runtime.id || !/^(?:\/|[a-zA-Z]:\/)/.test(path)
          || (!followFirstM4aSelection && !parent.endsWith(`/${directory}/`))
          || (confirmedParent !== undefined && confirmedParent !== parent)) throw new DownloadSaveError();
        if (index === 0 && followFirstM4aSelection && leaf !== file.filename) {
          const stem = leaf.endsWith(".m4a") ? leaf.slice(0, -4) : "";
          // Chromeの自動uniquifyによる「元名 (n)」は仕様の連番ではない。成功に置き換えない。
          const autoSuffix = stem.startsWith(originalStem) && /^ \(\d+\)$/.test(stem.slice(originalStem.length));
          const sequence = /^(.*)\(([1-9]\d*)\)$/.exec(stem);
          const validStem = normalizeFileStem(stem, "sm1") === stem || Boolean(sequence
            && normalizeFileStem(sequence[1], "sm1") === sequence[1] && Number.isSafeInteger(Number(sequence[2])));
          if (!stem || !validStem || autoSuffix) throw new DownloadSaveError();
          file.filename = leaf;
          saved.requestedFilename = leaf;
          for (const remaining of fixed.slice(1)) {
            remaining.filename = stem + (remaining.filename.endsWith(".aac") ? ".aac" : ".jpg");
          }
        }
        if (leaf !== file.filename) throw new DownloadSaveError();
        confirmedParent = parent;
      }
      signal.throwIfAborted();
    }
    return completed;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new DownloadSaveAborted([...completed, ...(error instanceof DownloadSaveAborted ? error.completed : [])]);
    }
    const partial = error instanceof DownloadSaveError
      ? error.completed.filter(file => !completed.some(saved => saved.id === file.id)) : [];
    throw new DownloadSaveError([...completed, ...partial], !(error instanceof DownloadSaveError) || error.cancellationConfirmed,
      error instanceof DownloadSaveError ? error.pendingDownloadId : undefined);
  }
}
