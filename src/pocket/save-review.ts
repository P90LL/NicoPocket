const unavailable = () => new Error('保存の終了を確認できませんでした。Chromeのダウンロード一覧をご確認ください。');

// Chromeが記録した自拡張機能のBlob URLだけを、保存IDの根拠とする。
export function isOwnBlobDownload(item: chrome.downloads.DownloadItem): boolean {
  const prefix = `blob:${chrome.runtime.getURL('')}`;
  const id = typeof item.url === 'string' && item.url.startsWith(prefix) ? item.url.slice(prefix.length) : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)
    && (!item.finalUrl || item.finalUrl === item.url);
}

export async function inspectOwnSave(downloadId: number, allowMissingExtensionId = false): Promise<chrome.downloads.DownloadItem> {
  try {
    if (!Number.isSafeInteger(downloadId) || downloadId < 0) throw unavailable();
    const item = (await chrome.downloads.search({ id: downloadId }))[0];
    if (!item || item.id !== downloadId || !isOwnBlobDownload(item)
      || (item.byExtensionId !== chrome.runtime.id && !(allowMissingExtensionId && !item.byExtensionId))) {
      throw unavailable();
    }
    return item;
  } catch { throw unavailable(); }
}

export async function confirmSaveEnded(downloadId: number, allowMissingExtensionId = false): Promise<void> {
  const item = await inspectOwnSave(downloadId, allowMissingExtensionId);
  if (item.state !== 'complete' && item.state !== 'interrupted') throw unavailable();
}
