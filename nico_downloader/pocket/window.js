// Phase 3 can read this state and reuse NicoPocketTitle.normalize at save time.
const NicoPocketEditor = { context: null, title: '', quality: 'standard', artwork: null };
const titleInput = document.getElementById('draft-title');
const qualityInput = document.getElementById('audio-quality');
const downloadButton = document.getElementById('download');
let requestingAAC = false;
let aacState = null;
let sourceKey = '';
let refreshSequence = 0;

function render(context) {
    if (!context) {
        NicoPocketEditor.context = null;
        NicoPocketArtwork.setContext(null, NicoPocketEditor);
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
    document.getElementById('original-title').textContent = context.originalTitle || '取得できませんでした';
    document.getElementById('video-id').textContent = context.videoId;
    document.getElementById('video-uploader').textContent = context.uploader || '取得できませんでした';
    document.getElementById('video-status').textContent = context.incomplete
        ? '一部の動画情報を取得できませんでした。動画ページから再度開いてください。'
        : '現在の動画情報を読み込みました。';
    document.getElementById('audio-info').textContent = '標準音質は192 kbps以下の最高品質、高音質は最高品質を使用します。192 kbps以下がない場合も元音源のまま保存します。';
    NicoPocketArtwork.setContext(context, NicoPocketEditor);
}
titleInput.addEventListener('input', () => { NicoPocketEditor.title = titleInput.value; renderMetadata(); });
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
    titleInput.disabled = requestingAAC || Boolean(running);
    qualityInput.disabled = requestingAAC || Boolean(running);
    NicoPocketEditor.downloading = requestingAAC || Boolean(running);
    window.dispatchEvent(new Event('np:download-state'));
    document.getElementById('cancel-download').hidden = !running;
    downloadButton.textContent = aacState?.phase === 'error' ? '再試行' : 'Download';
    const progress = document.getElementById('download-progress');
    progress.hidden = !running;
    if (aacState?.phase === 'acquiring' && Number.isFinite(aacState.progress)) progress.value = aacState.progress;
    else progress.removeAttribute('value');
    const labels = { starting: 'AAC取得を開始しています…', acquiring: '音声を取得しています…' + (Number.isFinite(aacState?.progress) ? ` ${aacState.progress}%` : ''), processing: 'M4Aを生成しています…（Metadata・Artworkを設定）', saving: aacState?.paused || aacState?.saveStatus === 'waiting' ? '保存待ちです。Chromeの許可・保存先を確認してください。キャンセルして再試行することもできます。' : 'M4Aを保存しています…', complete: 'M4Aの保存が完了しました。' };
    document.getElementById('save-status').dataset.phase = aacState?.phase || '';
    document.getElementById('save-status').dataset.error = String(aacState?.phase === 'error');
    renderMetadata();
    document.getElementById('save-status').textContent = aacState?.phase === 'error'
        ? aacState.error || '処理に失敗しました。再度実行できます。'
        : labels[aacState?.phase] || '選択した音質を再エンコードせずM4Aとして保存します。';
}
async function artworkForDownload(context) {
    await NicoPocketArtwork.ready(context);
    const artwork = NicoPocketEditor.artwork;
    const blob = artwork?.blob;
    if (!blob || blob.type !== 'image/jpeg' || blob.size > 2 * 1024 * 1024
        || artwork.videoId !== context.videoId || artwork.sourceTabId !== context.sourceTabId
        || artwork.sourceUrl !== context.sourceUrl || artwork.thumbnailUrl !== context.thumbnailUrl) return null;
    try {
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        if (NicoPocketEditor.artwork !== artwork || artwork.blob !== blob) return null;
        return { videoId: context.videoId, sourceTabId: context.sourceTabId,
            sourceUrl: context.sourceUrl, thumbnailUrl: context.thumbnailUrl, bytes };
    } catch { console.warn('NicoPocket: Artworkを取得できないため画像なしで保存します。'); return null; }
}
downloadButton.addEventListener('click', async () => {
    if (document.getElementById('artwork-dialog').open || downloadButton.disabled || requestingAAC || !NicoPocketEditor.context) return;
    const context = NicoPocketEditor.context;
    requestingAAC = true;
    syncAACButton();
    try {
        const title = NicoPocketTitle.normalize(NicoPocketEditor.title, context.videoId);
        const quality = NicoPocketEditor.quality === 'high' ? 'high' : 'standard';
        const artwork = await artworkForDownload(context);
        const current = NicoPocketEditor.context;
        if (!current || current.videoId !== context.videoId || current.sourceTabId !== context.sourceTabId
            || current.sourceUrl !== context.sourceUrl) throw new Error('動画が切り替わりました。開き直してください。');
        const reply = await chrome.runtime.sendMessage({ kind: 'np:aac-start',
            sourceTabId: context.sourceTabId, sourceUrl: context.sourceUrl, videoId: context.videoId, title, artwork, quality });
        if (!reply?.ok) throw new Error(reply?.error || 'AAC取得を開始できませんでした。');
        await refresh();
    } catch (error) {
        aacState = { phase: 'error', error: error.message || '取得開始に失敗しました。' };
    } finally {
        requestingAAC = false;
        syncAACButton();
    }
});

function renderMetadata() {
    const target = document.getElementById('metadata-preview');
    const context = NicoPocketEditor.context;
    target.replaceChildren();
    if (!context) return;
    const tags = NicoPocketMetadata.build({ ...context, title: NicoPocketTitle.normalize(NicoPocketEditor.title, context.videoId) });
    const labels = { title: 'Title', artist: 'Artist', episode_id: 'Video ID', comment: 'Video URL', genre: 'Genre', album: 'Series / Album', album_artist: 'Album Artist', date: 'Date', creation_time: 'Creation Time' };
    const values = { ...tags, artwork: NicoPocketEditor.artwork?.blob ? '768 × 768 JPEG' : 'なし（画像の取得・生成失敗時）' };
    for (const [key, value] of Object.entries(values)) {
        const row = document.createElement('div'), term = document.createElement('dt'), description = document.createElement('dd');
        term.textContent = labels[key] || 'Artwork'; description.textContent = value;
        row.append(term, description); target.append(row);
    }
}
window.addEventListener('np:artwork-change', renderMetadata);
document.getElementById('cancel-download').addEventListener('click', () => {
    if (aacState?.id) void chrome.runtime.sendMessage({ kind: 'np:aac-cancel', jobId: aacState.id }).catch(() => {});
});

// Poll only the owned save record while the editor is open; no global download scan.
setInterval(() => {
    if (aacState?.phase === 'saving' && aacState.downloadId != null) {
        void chrome.runtime.sendMessage({ kind: 'np:aac-check-save', jobId: aacState.id }).catch(() => {});
    }
}, 5000);
