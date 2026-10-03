import { appendDraft, defaultSettings, draftFromWatchUrl, restoreSettings, validateSettingsPatch, type VideoDraft } from './state.js';
import { watchSourceFromSender } from './watch-source-binding.js';
import { PendingSaveStore } from './pending-save-store.js';
import { confirmSaveEnded, inspectOwnSave } from './save-review.js';
import { appendJob, applyJobEvent, hasPendingSaveForVideo, validateJobExecutionEvent,
  type Job, type JobEvent } from './jobs.js';
import { validateJobThumbnail } from './job-images.js';
import { JobImageDatabase } from './job-image-database.js';

const keys = { settings: 'np:settings', drafts: 'np:drafts', jobs: 'np:jobs', window: 'np:window' };
const windowUrl = chrome.runtime.getURL('pocket/window.html');
const pendingSaves = new PendingSaveStore(chrome.storage.local, chrome.storage.session);
const imageDatabase = new JobImageDatabase();
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
async function jobs(): Promise<Job[]> {
  const stored = (await chrome.storage.session.get(keys.jobs))[keys.jobs];
  if (!Array.isArray(stored)) return [];
  return (stored as Job[]).map(job => ({ ...job,
    compressionRetries: Number.isInteger(job.compressionRetries) && job.compressionRetries >= 1
      && job.compressionRetries <= 5 ? job.compressionRetries : defaultSettings.compressionRetries }));
}
async function clearWindowSession() {
  await pendingSaves.retain(await jobs());
  await imageDatabase.clear();
  await chrome.storage.session.remove([keys.window, keys.drafts, keys.jobs]);
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
    await clearWindowSession();
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
        const added = await chrome.tabs.sendMessage(tab.id, { kind: 'np:add-current' });
        if (added?.ok === true) return;
      } catch { /* The page may need reloading after installation. */ }
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
      await clearWindowSession();
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
    if (value.kind === 'np:snapshot') return serial(async () => ({ drafts: await drafts(), jobs: await jobs(), settings: await settings() }));
    if (value.kind === 'np:jobs') return serial(async () => ({ jobs: await jobs() }));
    if (value.kind === 'np:register-job') return serial(async () => {
      if (typeof value.videoId !== 'string' || !/^[a-zA-Z0-9]{1,128}$/.test(value.videoId)) {
        throw new Error('登録対象が正しくありません。');
      }
      const draft = (await drafts()).find(row => row.videoId === value.videoId);
      if (!draft) throw new Error('動画候補がありません。');
      const current = await jobs();
      if (hasPendingSaveForVideo(current, draft.videoId)
        || (await pendingSaves.read()).some(row => row.videoId === draft.videoId)) {
        throw new Error('同じ動画の保存の終了を確認してください。');
      }
      const existing = current.find(row => row.videoId === draft.videoId
        && (row.status === 'waiting' || row.status === 'processing'));
      if (existing) return { jobId: existing.id, added: false };
      const id = crypto.randomUUID();
      let written = false;
      try {
        const captured = await chrome.runtime.sendMessage({ kind: 'np:capture-job-image', id,
          videoId: draft.videoId }) as { ok?: boolean; thumbnail?: unknown } | undefined;
        if (!captured?.ok) throw new Error('登録画像を確認できませんでした。');
        const thumbnail = validateJobThumbnail(captured.thumbnail);
        await chrome.storage.session.set({ [keys.jobs]: appendJob(current, draft, id, Date.now(), await settings(), thumbnail) });
        written = true;
        if (thumbnail) {
          const committed = await chrome.runtime.sendMessage({ kind: 'np:commit-job-image', id }) as
            { ok?: boolean; present?: boolean } | undefined;
          if (!committed?.ok || !committed.present) throw new Error('登録画像を保持できませんでした。');
        }
        return { jobId: id, added: true };
      } catch (error) {
        if (written) await chrome.storage.session.set({ [keys.jobs]: current });
        await chrome.runtime.sendMessage({ kind: 'np:release-job-image', id }).catch(() => {});
        throw error;
      }
    });
    if (value.kind === 'np:read-job') return serial(async () => {
      if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.id)) throw new Error('ジョブ識別子が正しくありません。');
      return { job: (await jobs()).find(row => row.id === value.id) };
    });
    if (value.kind === 'np:apply-job-event') return serial(async () => {
      const event = validateJobExecutionEvent(value.event, Date.now());
      const current = await jobs();
      const job = current.find(row => row.id === event.id);
      if (!job) throw new Error('ジョブがありません。');
      if (event.type === 'start' && (await pendingSaves.read()).some(row => row.videoId === job.videoId)) {
        throw new Error('同じ動画の保存の終了を確認してください。');
      }
      event.at = Math.max(Date.now(), job.updatedAt);
      const next = applyJobEvent(current, event);
      await chrome.storage.session.set({ [keys.jobs]: next });
      return { job: next.find(row => row.id === event.id) };
    });
    if (value.kind === 'np:job-action') return serial(async () => {
      if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.id)
        || !['remove', 'retry', 'cancel'].includes(value.action as string)) throw new Error('実行項目の操作が正しくありません。');
      const current = await jobs();
      const job = current.find(row => row.id === value.id);
      if (!job) throw new Error('ジョブがありません。');
      if (value.action === 'cancel' && job.status !== 'waiting') throw new Error('処理中のジョブは実行処理の停止を待ってください。');
      if (value.action === 'retry' && (await pendingSaves.read()).some(row => row.videoId === job.videoId)) {
        throw new Error('同じ動画の保存の終了を確認してください。');
      }
      if (value.action === 'retry' && job.thumbnail) {
        const image = await imageDatabase.get(job.id);
        if (!image || JSON.stringify(image.metadata) !== JSON.stringify(validateJobThumbnail(job.thumbnail))) {
          throw new Error('登録画像を復元できませんでした。');
        }
      }
      const event: JobEvent = value.action === 'remove' ? { type: 'remove', id: job.id }
        : { type: value.action as 'retry' | 'cancel', id: job.id, at: Math.max(Date.now(), job.updatedAt) };
      const next = applyJobEvent(current, event);
      await chrome.storage.session.set({ [keys.jobs]: next });
      if (value.action === 'remove') await imageDatabase.remove(job.id);
      return { updated: true };
    });
    if (value.kind === 'np:pending-saves') return { pendingSaves: await pendingSaves.read() };
    if (value.kind === 'np:retain-save' || value.kind === 'np:release-save') return serial(async () => {
      if (typeof value.videoId !== 'string' || !/^[a-zA-Z0-9]{1,128}$/.test(value.videoId)
        || typeof value.downloadId !== 'number' || !Number.isSafeInteger(value.downloadId) || value.downloadId < 0) {
        throw new Error('保存の識別子が正しくありません。');
      }
      const records = await pendingSaves.read();
      if (value.kind === 'np:retain-save') {
        if (!(await drafts()).some(row => row.videoId === value.videoId)) {
          throw new Error('保存対象がありません。');
        }
        await inspectOwnSave(value.downloadId);
        await pendingSaves.add({ videoId: value.videoId, downloadId: value.downloadId });
      } else {
        if (records.some(row => row.downloadId === value.downloadId && row.videoId !== value.videoId)) {
          throw new Error('保存対象が一致しません。');
        }
        await confirmSaveEnded(value.downloadId, records.some(row => row.downloadId === value.downloadId));
        await pendingSaves.remove(value.downloadId);
      }
      return {};
    });
    if (value.kind === 'np:review-pending-save') return serial(async () => {
      if (typeof value.downloadId !== 'number' || !Number.isSafeInteger(value.downloadId) || value.downloadId < 0) {
        throw new Error('保存の識別子が正しくありません。');
      }
      const record = (await pendingSaves.read()).find(row => row.downloadId === value.downloadId);
      if (!record) throw new Error('保存の復旧情報が見つかりません。');
      await confirmSaveEnded(record.downloadId, true);
      await pendingSaves.remove(record.downloadId);
      return { verified: true };
    });
    if (value.kind === 'np:read-draft-source') return serial(async () => {
      if (typeof value.videoId !== 'string' || !/^[a-zA-Z0-9]{1,128}$/.test(value.videoId)) {
        throw new Error('取得対象が正しくありません。');
      }
      const draft = (await drafts()).find(row => row.videoId === value.videoId);
      if (!draft?.sourceTab) throw new Error('取得元の視聴ページがありません。');
      return { videoId: draft.videoId, sourceTab: draft.sourceTab };
    });
    if (value.kind === 'np:read-job-source') return serial(async () => {
      if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.id)) throw new Error('ジョブ識別子が正しくありません。');
      const job = (await jobs()).find(row => row.id === value.id);
      const draft = (await drafts()).find(row => row.videoId === job?.videoId);
      if (!job || !draft?.sourceTab) throw new Error('取得元の視聴ページがありません。');
      return { videoId: job.videoId, sourceTab: draft.sourceTab };
    });
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
