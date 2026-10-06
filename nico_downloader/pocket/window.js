// Phase 3 can read this state and reuse NicoPocketTitle.normalize at save time.
const NicoPocketEditor = { context: null, title: '', quality: 'standard' };
const titleInput = document.getElementById('draft-title');
const qualityInput = document.getElementById('audio-quality');
const image = document.getElementById('artwork-image');
const emptyImage = document.getElementById('artwork-empty');
const imageState = document.getElementById('artwork-state');
const downloadButton = document.getElementById('download');
let requestingAAC = false;
let aacState = null;
let sourceKey = '';
let refreshSequence = 0;

function render(context) {
    if (!context) {
        downloadButton.disabled = true;
        document.getElementById('video-status').textContent = '動画ページのボタンから開いてください。';
        return;
    }
    syncAACButton();
    const nextKey = context.sourceTabId + ':' + context.videoId;
    NicoPocketEditor.context = context;
    if (sourceKey !== nextKey) {
        sourceKey = nextKey;
        titleInput.value = NicoPocketTitle.normalize(context.title, context.videoId);
        qualityInput.value = 'standard';
        NicoPocketEditor.title = titleInput.value;
        NicoPocketEditor.quality = 'standard';
    }
    document.getElementById('video-id').textContent = context.videoId;
    document.getElementById('video-uploader').textContent = context.uploader || '取得できませんでした';
    document.getElementById('video-status').textContent = context.incomplete
        ? '一部の動画情報を取得できませんでした。動画ページから再度開いてください。'
        : '現在の動画情報を読み込みました。';
    const count = context.audioQualities.filter(audio => audio.available).length;
    document.getElementById('audio-info').textContent = '標準音質は192 kbps基準。高音質は取得可能な元音源を使用します。'
        + (count ? ` 利用可能な音声品質情報: ${count}件（選択処理は準備中）。` : ' 音声品質情報は未取得です。');
    const thumbnailUrl = context.thumbnailUrl || '';
    if (image.getAttribute('src') !== thumbnailUrl || (thumbnailUrl && imageState.textContent === '読み込み失敗')) {
        image.hidden = true;
        emptyImage.hidden = false;
        emptyImage.textContent = thumbnailUrl ? 'サムネイルを読み込んでいます…' : 'サムネイル未取得';
        imageState.textContent = thumbnailUrl ? '読み込み中' : '未設定';
        if (thumbnailUrl) image.src = thumbnailUrl;
        else image.removeAttribute('src');
    }
}
image.addEventListener('load', () => {
    image.hidden = false;
    emptyImage.hidden = true;
    imageState.textContent = '元画像';
});
image.addEventListener('error', () => {
    image.hidden = true;
    emptyImage.hidden = false;
    emptyImage.textContent = 'サムネイルを表示できませんでした';
    imageState.textContent = '読み込み失敗';
});
titleInput.addEventListener('input', () => { NicoPocketEditor.title = titleInput.value; });
qualityInput.addEventListener('change', () => { NicoPocketEditor.quality = qualityInput.value; });
document.getElementById('close-editor').addEventListener('click', () => window.close());
async function refresh() {
    const sequence = ++refreshSequence;
    try {
        const stored = await chrome.storage.session.get(['np:videoContext', 'np:aacJob']);
        if (sequence === refreshSequence) {
            aacState = stored['np:aacJob'] || null;
            render(stored['np:videoContext']);
            syncAACButton();
        }
    } catch {
        document.getElementById('video-status').textContent = '動画情報を読み込めませんでした。動画ページから再度開いてください。';
    }
}
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && (changes['np:videoContext'] || changes['np:aacJob'])) void refresh();
});
void refresh();

function syncAACButton() {
    const running = aacState && !['complete', 'error'].includes(aacState.phase);
    downloadButton.disabled = requestingAAC || Boolean(running) || !NicoPocketEditor.context;
    titleInput.disabled = Boolean(running);
    qualityInput.disabled = Boolean(running);
    const labels = { starting: 'AAC取得を開始しています…', acquiring: '音声を取得し、M4Aを生成しています…', saving: 'M4Aを保存しています…', complete: 'M4Aの保存が完了しました。' };
    document.getElementById('save-status').textContent = aacState?.phase === 'error'
        ? aacState.error || '処理に失敗しました。再度実行できます。'
        : labels[aacState?.phase] || 'M4Aとして保存します。音質選択・Artwork処理は未接続です。';
}
downloadButton.addEventListener('click', async () => {
    if (downloadButton.disabled || requestingAAC || !NicoPocketEditor.context) return;
    const context = NicoPocketEditor.context;
    requestingAAC = true;
    syncAACButton();
    try {
        const title = NicoPocketTitle.normalize(NicoPocketEditor.title, context.videoId);
        const reply = await chrome.runtime.sendMessage({ kind: 'np:aac-start',
            sourceTabId: context.sourceTabId, sourceUrl: context.sourceUrl, videoId: context.videoId, title });
        if (!reply?.ok) throw new Error(reply?.error || 'AAC取得を開始できませんでした。');
        await refresh();
    } catch (error) {
        aacState = { phase: 'error', error: error.message || '取得開始に失敗しました。' };
    } finally {
        requestingAAC = false;
        syncAACButton();
    }
});
