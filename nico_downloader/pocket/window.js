// Phase 3 can read this state and reuse NicoPocketTitle.normalize at save time.
const NicoPocketEditor = { context: null, title: '', quality: 'standard' };
const titleInput = document.getElementById('draft-title');
const qualityInput = document.getElementById('audio-quality');
const image = document.getElementById('artwork-image');
const emptyImage = document.getElementById('artwork-empty');
const imageState = document.getElementById('artwork-state');
let sourceKey = '';
let refreshSequence = 0;

function render(context) {
    if (!context) {
        document.getElementById('video-status').textContent = '動画ページのボタンから開いてください。';
        return;
    }
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
        const stored = await chrome.storage.session.get('np:videoContext');
        if (sequence === refreshSequence) render(stored['np:videoContext']);
    } catch {
        document.getElementById('video-status').textContent = '動画情報を読み込めませんでした。動画ページから再度開いてください。';
    }
}
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes['np:videoContext']) void refresh();
});
void refresh();
