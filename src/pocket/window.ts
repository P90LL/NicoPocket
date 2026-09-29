import type { Settings, VideoDraft } from './state.js';
import { outputNames } from './filename.js';
import { ThumbnailEditor } from './thumbnail-editor.js';

type Snapshot = { ok: boolean; drafts: VideoDraft[]; settings: Settings; error?: string };
const query = <T extends HTMLElement>(id: string) => document.querySelector<T>(id)!;
const status = query('#status');
const title = query<HTMLInputElement>('#draft-title');
const quality = query<HTMLSelectElement>("#draft-options [name='quality']");
const saveAac = query<HTMLInputElement>("#draft-options [name='saveAac']");
const saveJpeg = query<HTMLInputElement>("#draft-options [name='saveJpeg']");
const settingsForm = query<HTMLFormElement>('#settings');
const themeToggle = query<HTMLButtonElement>('#theme-toggle');
const editor = new ThumbnailEditor(renderDetails);
let current: VideoDraft[] = [];
let selected: string | undefined;
let preferences: Settings | undefined;
let themeOverride: Settings['defaultTheme'] | undefined;
let writing: Promise<unknown> = Promise.resolve();
let revision = 0;

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
async function refresh() {
  const turn = ++revision;
  const snapshot = await chrome.runtime.sendMessage({ kind: 'np:snapshot' }) as Snapshot;
  if (turn !== revision) return;
  if (!snapshot.ok) throw new Error('状態を読み込めませんでした。');
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
  text('#settings-status', '設定は自動保存されます。画像認識と保存エンジンの接続は開発中です。');
}
function write(task: () => Promise<unknown>) {
  writing = writing.then(task).catch(() => { text('#draft-edit-status', '変更を保存できませんでした。再試行してください。'); });
}
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
  if (area === 'session' && changes['np:drafts'] || area === 'local' && changes['np:settings']) {
    void refresh().catch(() => { status.textContent = '状態を更新できませんでした。'; });
  }
});
void refresh().catch(() => { status.textContent = '状態を読み込めませんでした。再読み込みしてください。'; });
