import type { Settings, VideoDraft } from './state.js';
import { outputNames } from './filename.js';
import { ThumbnailEditor } from './thumbnail-editor.js';
import type { PendingSave } from './pending-saves.js';
import { JobImageDatabase } from './job-image-database.js';
import { formatJobErrorLog, hasPendingSaveForVideo, jobSaveIssueMessage,
  jobStageLabel, jobStatusLabel, type Job } from './jobs.js';
import { JobActionController } from './job-action-controller.js';
import type { JobRunner } from './job-runner.js';
import { createProductJobRunner } from './product-job-runner.js';
import { inspectOwnSave } from './save-review.js';

type Snapshot = { ok: boolean; drafts: VideoDraft[]; jobs: Job[]; settings: Settings; error?: string };
type PendingSnapshot = { ok: boolean; pendingSaves: PendingSave[] };
const query = <T extends HTMLElement>(id: string) => document.querySelector<T>(id)!;
const status = query('#status');
const title = query<HTMLInputElement>('#draft-title');
const quality = query<HTMLSelectElement>("#draft-options [name='quality']");
const saveAac = query<HTMLInputElement>("#draft-options [name='saveAac']");
const saveJpeg = query<HTMLInputElement>("#draft-options [name='saveJpeg']");
const settingsForm = query<HTMLFormElement>('#settings');
const themeToggle = query<HTMLButtonElement>('#theme-toggle');
const editor = new ThumbnailEditor(renderDetails);
const imageDatabase = new JobImageDatabase();
const jobActions = new JobActionController(message => chrome.runtime.sendMessage(message),
  () => text('#queue-status', '実行状態を保存できませんでした。実行一覧を確認してください。'),
  () => { void refresh().catch(() => {}); });
const maxInputBytes = 128 * 1024 * 1024;
jobActions.connect(createProductJobRunner({ concurrency: 10, mediaSlots: 2, maxInputBytes }, imageDatabase));
export function connectJobRunner(runner: JobRunner): void { jobActions.connect(runner); }
export function startRegisteredJob(id: string): void { jobActions.start(id); }
let imageMutation: Promise<unknown> = Promise.resolve();
let imageDisposed = false;
let current: VideoDraft[] = [];
let selected: string | undefined;
let preferences: Settings | undefined;
let themeOverride: Settings['defaultTheme'] | undefined;
let writing: Promise<unknown> = Promise.resolve();
let lastWriteFailed = false;
let revision = 0;
let currentJobs: Job[] = [];
let currentPendingSaves: PendingSave[] = [];

function imageWork<T>(task: () => Promise<T>): Promise<T> {
  const result = imageMutation.then(task);
  imageMutation = result.catch(() => {});
  return result;
}
window.addEventListener('pagehide', () => {
  imageDisposed = true;
  void jobActions.stop().catch(() => {});
});
chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  const workerUrl = chrome.runtime.getURL('pocket/assets/background.js');
  if (sender.id !== chrome.runtime.id || sender.tab || sender.url && sender.url !== workerUrl
    || typeof message !== 'object' || message === null || !('kind' in message)
    || !('id' in message) || typeof message.id !== 'string'
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(message.id)) return;
  const id = message.id;
  let task: Promise<Record<string, unknown>>;
  if (message.kind === 'np:capture-job-image' && 'videoId' in message
    && typeof message.videoId === 'string' && /^[a-zA-Z0-9]{1,128}$/.test(message.videoId)) {
    task = imageWork(async () => {
      if (imageDisposed) throw new Error();
      const snapshot = await editor.snapshot(message.videoId as string);
      if (snapshot) await imageDatabase.put(id, snapshot);
      return { thumbnail: snapshot?.metadata };
    });
  } else if (message.kind === 'np:commit-job-image') {
    task = imageWork(async () => {
      if (imageDisposed) throw new Error();
      return { present: Boolean(await imageDatabase.get(id)) };
    });
  } else if (message.kind === 'np:release-job-image') {
    task = imageWork(async () => { await imageDatabase.remove(id); return {}; });
  } else return;
  void task.then(result => reply({ ok: true, ...result }), () => reply({ ok: false }));
  return true;
});

function text(id: string, value: string) { query(id).textContent = value; }
function theme() {
  const value = themeOverride ?? preferences?.defaultTheme ?? 'light';
  document.documentElement.dataset.theme = value;
  themeToggle.textContent = value === 'dark' ? 'ホワイトに切り替え' : 'ダークに切り替え';
}
function renderDetails() {
  const draft = current.find(row => row.videoId === selected);
  query('#draft-editor').hidden = !draft;
  if (!draft) return;
  const names = outputNames(draft.title, draft.videoId, 0, draft.saveAac, draft.saveJpeg);
  text('#selected-video-id', draft.videoId);
  const source = query<HTMLAnchorElement>('#selected-source'); source.href = draft.sourceUrl;
  text('#filename-preview', Object.values(names).join(' / '));
  text('#metadata-title', draft.title || draft.videoId); text('#metadata-video-id', draft.videoId);
  text('#metadata-source-url', draft.sourceUrl);
  const cover = editor.hasPreview(draft.videoId) ? 'JPEGプレビュー生成済み' : '未取得';
  text('#metadata-cover', cover); text('#confirm-cover', cover);
  text('#confirm-title', draft.title || draft.videoId); text('#confirm-filename', names.m4a);
  text('#confirm-quality', draft.quality === 'best' ? '最高音質' : draft.quality === 'limit160' ? '160 kbps 上限' : '128 kbps 上限');
  text('#confirm-extras', [draft.saveAac ? 'AAC' : '', draft.saveJpeg ? 'JPEG' : ''].filter(Boolean).join(' / ') || 'なし');
}
function select(id: string) {
  selected = id;
  const draft = current.find(row => row.videoId === id);
  if (!draft) return;
  title.value = draft.title; quality.value = draft.quality; saveAac.checked = draft.saveAac; saveJpeg.checked = draft.saveJpeg;
  editor.select(id); renderDetails();
  for (const button of document.querySelectorAll<HTMLButtonElement>('#drafts button')) button.setAttribute('aria-current', String(button.dataset.id === id));
}
function renderPendingSaves(records: PendingSave[]) {
  currentPendingSaves = records;
  const visible = records.filter(record => !currentJobs.some(job => job.videoId === record.videoId
    && jobActions.isRunning(job.id)));
  const section = query('#save-recovery');
  section.hidden = visible.length === 0;
  const list = query('#pending-saves');
  list.replaceChildren();
  for (const record of visible) {
    const item = document.createElement('li');
    item.className = 'job-item';
    const label = document.createElement('span');
    label.textContent = `${record.videoId} · 保存ID ${record.downloadId}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '保存の終了を確認';
    button.addEventListener('click', async () => {
      button.disabled = true;
      text('#save-recovery-status', 'Chromeのダウンロード履歴を確認しています。');
      try {
        const response = await chrome.runtime.sendMessage({ kind: 'np:review-pending-save', downloadId: record.downloadId });
        if (!response?.ok || response.verified !== true) throw new Error();
        await refresh();
        text('#save-recovery-status', '保存の終了を確認しました。');
      } catch {
        button.disabled = false;
        text('#save-recovery-status', '終了を確認できませんでした。Chromeのダウンロード一覧をご確認ください。');
      }
    });
    item.append(label, ' ', button);
    list.append(item);
  }
}
function renderJobs(jobs: Job[]) {
  currentJobs = jobs;
  const list = query('#jobs');
  list.replaceChildren();
  text('#queue-status', jobs.length ? `${jobs.length}件の実行項目` : '実行項目はありません。');
  const current = jobs.find(job => job.status === 'processing') ?? jobs.find(job => job.status === 'waiting') ?? jobs.at(-1);
  const compact = query<HTMLButtonElement>('#compact-progress');
  compact.hidden = !current;
  if (current) {
    compact.dataset.status = current.status;
    text('#compact-state', [jobStatusLabel[current.status], current.stage ? jobStageLabel[current.stage] : ''].filter(Boolean).join(' · '));
    query<HTMLProgressElement>('#compact-meter').value = current.percent;
    text('#compact-detail', `${jobs.indexOf(current) + 1}/${jobs.length} · ${current.percent}%`);
  }
  for (const job of jobs) {
    const item = document.createElement('li'); item.className = 'job-item'; item.dataset.status = job.status;
    const heading = document.createElement('h2'); heading.textContent = job.title || job.videoId;
    const state = document.createElement('p'); state.className = 'job-state';
    state.textContent = [job.videoId, jobStatusLabel[job.status], job.stage ? jobStageLabel[job.stage] : '',
      `${job.percent}%`].filter(Boolean).join(' · ');
    const meter = document.createElement('progress'); meter.max = 100; meter.value = job.percent;
    meter.setAttribute('aria-label', `${job.title || job.videoId} の進捗`);
    const actions = document.createElement('div'); actions.className = 'job-actions';
    const allowed: ('remove' | 'cancel' | 'retry')[] = job.status === 'waiting' ? ['remove']
      : job.status === 'processing' ? ['cancel'] : job.status === 'error' || job.status === 'cancelled'
        ? ['retry', 'remove'] : ['remove'];
    for (const action of allowed) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = action;
      button.textContent = action === 'cancel' ? 'キャンセル' : action === 'retry' ? '再試行' : '削除';
      button.disabled = (action === 'retry' || action === 'remove')
        && (hasPendingSaveForVideo(jobs, job.videoId)
          || currentPendingSaves.some(row => row.videoId === job.videoId));
      button.addEventListener('click', () => {
        button.disabled = true;
        void jobActions.perform(job.id, action).then(() => refresh())
          .catch(() => { text('#queue-status', '実行項目を操作できませんでした。'); button.disabled = false; });
      });
      actions.append(button);
    }
    item.append(heading, state, meter);
    if (job.saveIssue) {
      const issue = document.createElement('p'); issue.textContent = jobSaveIssueMessage(job.saveIssue) ?? '';
      item.append(issue);
    }
    if (job.summary) {
      const summary = document.createElement('p'); summary.className = 'job-summary'; summary.textContent = job.summary;
      item.append(summary);
    }
    if (job.status === 'error' && job.errorDetail) {
      const details = document.createElement('details'); details.className = 'job-error-details';
      const label = document.createElement('summary'); label.textContent = '詳細ログ';
      const log = formatJobErrorLog(job.errorDetail);
      const content = document.createElement('pre'); content.textContent = log;
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'ログをコピー';
      const result = document.createElement('span'); result.setAttribute('role', 'status');
      copy.addEventListener('click', () => {
        void navigator.clipboard.writeText(log).then(() => { result.textContent = 'コピーしました。'; },
          () => { result.textContent = 'コピーできませんでした。'; });
      });
      details.append(label, content, copy, result); item.append(details);
    }
    if ((job.status === 'complete' || job.status === 'warning') && job.downloads?.m4a !== undefined) {
      const downloadId = job.downloads.m4a;
      const open = document.createElement('button'); open.type = 'button';
      open.textContent = '保存されたM4Aを開く'; open.disabled = true;
      const openStatus = document.createElement('span'); openStatus.setAttribute('role', 'status');
      let verified = false, granted = false;
      void Promise.all([inspectOwnSave(downloadId, true), chrome.permissions.contains({ permissions: ['downloads.open'] })])
        .then(([file, permission]) => {
          if (file.state !== 'complete' || !/\.m4a$/iu.test(file.filename)
            || !currentJobs.some(row => row.id === job.id && row.downloads?.m4a === downloadId
              && (row.status === 'complete' || row.status === 'warning'))) throw new Error();
          verified = true; granted = permission; open.disabled = false;
        }).catch(() => { openStatus.textContent = '保存ファイルを確認できませんでした。Chromeのダウンロード一覧をご確認ください。'; });
      open.addEventListener('click', () => {
        if (!verified || !currentJobs.some(row => row.id === job.id && row.downloads?.m4a === downloadId)) return;
        if (!granted) {
          open.disabled = true;
          void chrome.permissions.request({ permissions: ['downloads.open'] }).then(allowed => {
            if (allowed) { granted = true; openStatus.textContent = '許可しました。もう一度押すとファイルを開きます。'; }
            else openStatus.textContent = '許可されませんでした。保存結果は実行一覧に残っています。';
          }).catch(() => { openStatus.textContent = '許可を確認できませんでした。再試行してください。'; })
            .finally(() => { open.disabled = false; });
          return;
        }
        void chrome.downloads.open(downloadId).then(() => { openStatus.textContent = 'ファイルを開きました。'; })
          .catch(() => { openStatus.textContent = 'ファイルを開けませんでした。Chromeのダウンロード一覧をご確認ください。'; });
      });
      actions.append(open, openStatus);
    }
    item.append(actions); list.append(item);
  }
}
async function refresh() {
  const turn = ++revision;
  const [snapshot, pending] = await Promise.all([
    chrome.runtime.sendMessage({ kind: 'np:snapshot' }) as Promise<Snapshot>,
    chrome.runtime.sendMessage({ kind: 'np:pending-saves' }) as Promise<PendingSnapshot>
  ]);
  if (turn !== revision) return;
  if (!snapshot.ok || !pending.ok || !Array.isArray(pending.pendingSaves)) throw new Error('状態を読み込めませんでした。');
  if (!Array.isArray(snapshot.jobs)) throw new Error('実行状態を読み込めませんでした。');
  currentPendingSaves = pending.pendingSaves;
  renderJobs(snapshot.jobs);
  renderPendingSaves(pending.pendingSaves);
  current = snapshot.drafts; preferences = snapshot.settings;
  const list = query('#drafts'); list.replaceChildren();
  for (const draft of current) {
    const item = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.dataset.id = draft.videoId; button.textContent = `${draft.title || draft.videoId} (${draft.videoId})`;
    button.addEventListener('click', () => select(draft.videoId)); item.append(button); list.append(item);
  }
  status.textContent = current.length ? `${current.length}件の候補` : '視聴ページの入口から動画を追加してください。';
  editor.retain(new Set(current.map(row => row.videoId)));
  if (current.length) select(current.some(row => row.videoId === selected) ? selected! : current[0].videoId);
  else { selected = undefined; query('#draft-editor').hidden = true; editor.select(); }
  for (const [key, value] of Object.entries(preferences)) {
    const input = settingsForm.elements.namedItem(key) as HTMLInputElement | HTMLSelectElement | null;
    if (!input) continue;
    if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = value as boolean;
    else input.value = String(value);
  }
  // MediaPipe assets are not part of this fork's runtime yet; keep manual editing available.
  editor.setRecognitionEnabled(false); theme();
  jobActions.setConcurrency(preferences.concurrency);
  text('#settings-status', '設定は自動保存されます。画像認識は開発中です。');
}
function write(task: () => Promise<unknown>) {
  writing = writing.then(async () => { lastWriteFailed = false; await task(); })
    .catch(() => { lastWriteFailed = true; text('#draft-edit-status', '変更を保存できませんでした。再試行してください。'); });
}
query<HTMLButtonElement>('#start-save').addEventListener('click', () => {
  const videoId = selected;
  if (!videoId) { text('#start-status', '対象動画を選択してください。'); return; }
  const button = query<HTMLButtonElement>('#start-save');
  button.disabled = true;
  text('#start-status', '実行項目を登録しています。');
  void (async () => {
    await writing;
    if (lastWriteFailed) throw new Error('編集内容を保存できませんでした。');
    const reply: unknown = await chrome.runtime.sendMessage({ kind: 'np:register-job', videoId });
    if (!reply || typeof reply !== 'object' || !('ok' in reply) || reply.ok !== true
      || !('jobId' in reply) || typeof reply.jobId !== 'string'
      || !/^[a-zA-Z0-9_-]{1,128}$/.test(reply.jobId)) throw new Error('登録失敗');
    jobActions.start(reply.jobId);
    text('#start-status', '実行一覧に追加しました。');
    query<HTMLButtonElement>('[data-view="queue"]').click();
    await refresh();
  })().catch(() => { text('#start-status', '保存を開始できませんでした。実行一覧と候補を確認してください。'); })
    .finally(() => { button.disabled = false; });
});
for (const input of [title, quality, saveAac, saveJpeg]) {
  input.addEventListener('change', () => {
    if (!selected) return;
    const changes = { kind: 'np:update-draft', videoId: selected, title: title.value,
      quality: quality.value, saveAac: saveAac.checked, saveJpeg: saveJpeg.checked };
    write(async () => {
      const response = await chrome.runtime.sendMessage(changes);
      if (!response?.ok) throw new Error('編集失敗');
      text('#draft-edit-status', '今回の保存内容を更新しました。'); await refresh();
    });
  });
}
settingsForm.addEventListener('change', event => {
  const input = event.target as HTMLInputElement | HTMLSelectElement;
  if (!input.name || !input.checkValidity()) return;
  const value = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked
    : input instanceof HTMLInputElement && input.type === 'number' || input.name === 'warningSeconds' ? Number(input.value) : input.value;
  write(async () => {
    const response = await chrome.runtime.sendMessage({ kind: 'np:update-settings', changes: { [input.name]: value } });
    if (!response?.ok) { text('#settings-status', '設定を保存できませんでした。'); return; }
    await refresh();
  });
});
themeToggle.addEventListener('click', () => { themeOverride = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; theme(); });
query<HTMLButtonElement>('#compact-progress').addEventListener('click', () => {
  query<HTMLButtonElement>('[data-view="queue"]').click();
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  button.addEventListener('click', () => {
    const view = button.dataset.view;
    for (const panel of document.querySelectorAll<HTMLElement>('.view')) panel.hidden = panel.id !== `view-${view}`;
    for (const link of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      if (link.dataset.view === view) link.setAttribute('aria-current', link.closest('.stepper') ? 'step' : 'page');
      else link.removeAttribute('aria-current');
    }
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && (changes['np:drafts'] || changes['np:jobs'])
    || area === 'local' && (changes['np:settings'] || changes['np:pendingSaves'])) {
    void refresh().catch(() => { status.textContent = '状態を更新できませんでした。'; });
  }
});
void refresh().catch(() => { status.textContent = '状態を読み込めませんでした。再読み込みしてください。'; });
