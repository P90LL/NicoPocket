import { appendDraft, draftFromWatchUrl, restoreSettings, validateSettingsPatch, type VideoDraft } from './state.js';
import { watchSourceFromSender } from './watch-source-binding.js';

const keys = { settings: 'np:settings', drafts: 'np:drafts', window: 'np:window' };
const windowUrl = chrome.runtime.getURL('pocket/window.html');
let mutation: Promise<unknown> = Promise.resolve();
let opening: Promise<number> | undefined;

function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = mutation.then(task);
  mutation = next.catch(() => {});
  return next;
}
async function settings() {
  const stored = await chrome.storage.local.get(keys.settings);
  const restored = restoreSettings(stored[keys.settings]);
  if (restored.repaired) await chrome.storage.local.set({ [keys.settings]: restored.settings });
  return restored.settings;
}
async function drafts(): Promise<VideoDraft[]> {
  const stored = (await chrome.storage.session.get(keys.drafts))[keys.drafts];
  return Array.isArray(stored) ? stored : [];
}
function openWindow(): Promise<number> {
  if (opening) return opening;
  opening = serial(async () => {
    const id = (await chrome.storage.session.get(keys.window))[keys.window];
    if (typeof id === 'number' && Number.isInteger(id)) {
      try {
        const existing = await chrome.windows.get(id, { populate: true });
        if (existing.tabs?.some(tab => tab.url === windowUrl)) {
          await chrome.windows.update(id, { focused: true, state: 'normal' });
          return id as number;
        }
      } catch { /* Closed while the worker was stopped. */ }
    }
    await chrome.storage.session.remove([keys.window, keys.drafts]);
    const created = await chrome.windows.create({ url: windowUrl, type: 'popup', width: 980, height: 720 });
    if (created?.id === undefined) throw new Error('独立ウィンドウを開けませんでした。');
    await chrome.storage.session.set({ [keys.window]: created.id });
    return created.id;
  }).finally(() => { opening = undefined; });
  return opening;
}
async function addVideo(url: string, title: string, sender?: chrome.runtime.MessageSender, epoch?: string) {
  await openWindow();
  return serial(async () => {
    const candidate = draftFromWatchUrl(url, title, await settings());
    if (!candidate) throw new Error('対象の視聴ページではありません。');
    if (sender) candidate.sourceTab = watchSourceFromSender(sender, candidate.videoId, epoch, chrome.runtime.id);
    const before = await drafts();
    const next = appendDraft(before, candidate);
    await chrome.storage.session.set({ [keys.drafts]: next });
    return { added: next.length !== before.length, videoId: candidate.videoId };
  });
}

chrome.action.onClicked.addListener(tab => {
  void (async () => {
    await openWindow();
    if (!tab.url || !draftFromWatchUrl(tab.url, tab.title ?? '')) return;
    let title = tab.title ?? '';
    if (tab.id !== undefined) {
      try {
        const reply = await chrome.tabs.sendMessage(tab.id, { kind: 'np:context' });
        if (reply?.url === tab.url && typeof reply.title === 'string') title = reply.title;
      } catch { /* The page may need reloading after installation. */ }
    }
    await addVideo(tab.url, title);
  })().catch(() => {});
});
chrome.windows.onRemoved.addListener(id => {
  void serial(async () => {
    if ((await chrome.storage.session.get(keys.window))[keys.window] === id) {
      await chrome.storage.session.remove([keys.window, keys.drafts]);
    }
  });
});
chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  if (!message || typeof message !== 'object' || !('kind' in message)
    || typeof message.kind !== 'string' || !message.kind.startsWith('np:')) return;
  const value = message as Record<string, unknown>;
  const ownWindow = sender.id === chrome.runtime.id && sender.url === windowUrl;
  const handle = async () => {
    if (value.kind === 'np:add-video') {
      if (typeof value.url !== 'string' || typeof value.title !== 'string' || typeof value.epoch !== 'string') {
        throw new Error('動画情報が正しくありません。');
      }
      const candidate = draftFromWatchUrl(value.url, value.title);
      if (!candidate) throw new Error('対象の視聴ページではありません。');
      // Authenticate the browser-provided sender before creating a window or storing data.
      watchSourceFromSender(sender, candidate.videoId, value.epoch, chrome.runtime.id);
      return addVideo(value.url, value.title, sender, value.epoch);
    }
    if (!ownWindow) throw new Error('操作元を確認できませんでした。');
    if (value.kind === 'np:snapshot') return serial(async () => ({ drafts: await drafts(), settings: await settings() }));
    if (value.kind === 'np:update-settings') {
      const patch = validateSettingsPatch(value.changes);
      return serial(async () => {
        const next = { ...await settings(), ...patch };
        await chrome.storage.local.set({ [keys.settings]: next });
        return { settings: next };
      });
    }
    if (value.kind === 'np:update-draft') return serial(async () => {
      const current = await drafts();
      const draft = current.find(row => row.videoId === value.videoId);
      if (!draft || typeof value.title !== 'string' || value.title.length > 500) throw new Error('編集対象を確認できませんでした。');
      const patch = validateSettingsPatch({ defaultQuality: value.quality, saveAac: value.saveAac, saveJpeg: value.saveJpeg });
      Object.assign(draft, { title: value.title, quality: patch.defaultQuality, saveAac: patch.saveAac, saveJpeg: patch.saveJpeg });
      await chrome.storage.session.set({ [keys.drafts]: current });
      return {};
    });
    throw new Error('未対応の操作です。');
  };
  void handle().then(result => reply({ ok: true, ...result }), () => reply({ ok: false, error: '操作を完了できませんでした。ページと入力内容を確認してください。' }));
  return true;
});
