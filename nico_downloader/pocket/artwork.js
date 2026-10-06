// UI-only crop state. No media download or FFmpeg integration in this phase.
const NicoPocketArtwork = (() => {
    const dialog = document.getElementById('artwork-dialog');
    const canvas = document.getElementById('artwork-canvas');
    const zoom = document.getElementById('artwork-zoom');
    const zoomLabel = document.getElementById('artwork-zoom-value');
    const status = document.getElementById('artwork-edit-status');
    const apply = document.getElementById('artwork-apply');
    const edit = document.getElementById('artwork-edit');
    const original = document.getElementById('artwork-original');
    const image = document.getElementById('artwork-image');
    const empty = document.getElementById('artwork-empty');
    const pill = document.getElementById('artwork-state');
    const note = document.getElementById('artwork-note');
    let editor, state, bitmap, controller, draft, dragging, generation = 0;
    let sourcePreview = '', editedPreview = '', loading = false, exporting = false;
    const SIZE = 768;
    function release() {
        controller?.abort(); bitmap?.close(); bitmap = null;
        URL.revokeObjectURL(sourcePreview); URL.revokeObjectURL(editedPreview);
        sourcePreview = editedPreview = '';
    }
    function summary(error = '') {
        const url = state?.edited ? editedPreview : sourcePreview;
        image.hidden = !url; empty.hidden = Boolean(url);
        if (url) image.src = url; else image.removeAttribute('src');
        image.alt = state?.edited ? '編集済みの正方形Artwork' : '現在の動画のサムネイル';
        pill.textContent = error ? '読み込み失敗' : loading ? '読み込み中' : state?.edited ? '編集済み' : bitmap ? '元画像' : '未設定';
        empty.textContent = error || (loading ? 'サムネイルを読み込んでいます…' : 'サムネイル未取得');
        note.textContent = state?.edited ? '正方形Artworkの編集結果です。M4Aへの埋め込みは次Phaseです。' : '元のサムネイルです。1:1の正方形に編集できます。';
        edit.disabled = !state?.thumbnailUrl || loading || exporting;
        original.disabled = !state?.edited || exporting;
    }
    async function load(target) {
        const version = ++generation;
        controller?.abort(); controller = new AbortController();
        const request = controller;
        loading = true; summary();
        const deadline = setTimeout(() => request.abort(), 20000);
        try {
            const url = new URL(target.thumbnailUrl);
            if (url.protocol !== 'https:' || url.username || url.password) throw new Error('画像URLを確認できませんでした。');
            const response = await fetch(url.href, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: request.signal });
            if (!response.ok) throw new Error('画像を取得できませんでした。');
            const blob = await response.blob();
            if (blob.size > 10 * 1024 * 1024) throw new Error('画像サイズが大きすぎます。');
            const next = await createImageBitmap(blob);
            if (version !== generation || state !== target) { next.close(); return; }
            if (!next.width || !next.height || next.width * next.height > 40000000) { next.close(); throw new Error('画像の大きさを確認できませんでした。'); }
            bitmap = next; sourcePreview = URL.createObjectURL(blob);
            loading = false; summary();
        } catch (error) {
            if (version === generation && state === target) {
                loading = false; summary('画像を読み込めませんでした。Artworkを編集から再試行できます。');
            }
        } finally { clearTimeout(deadline); }
    }
    function setContext(context, nextEditor) {
        editor = nextEditor;
        const key = context ? JSON.stringify([context.sourceTabId, context.videoId, context.sourceUrl, context.thumbnailUrl]) : '';
        if (state?.key === key) return;
        generation++; release();
        if (dialog.open) dialog.close();
        draft = dragging = null; exporting = loading = false;
        state = context ? { key, videoId: context.videoId, sourceTabId: context.sourceTabId,
            sourceUrl: context.sourceUrl, thumbnailUrl: context.thumbnailUrl || '',
            zoom: 1, x: 0, y: 0, edited: false, blob: null, mime: 'image/jpeg', width: SIZE, height: SIZE } : null;
        editor.artwork = state;
        summary();
        if (state?.thumbnailUrl) void load(state);
    }
    function clamp() {
        const side = Math.min(bitmap.width, bitmap.height) / draft.zoom;
        draft.x = Math.max(-(bitmap.width - side) / 2, Math.min((bitmap.width - side) / 2, draft.x));
        draft.y = Math.max(-(bitmap.height - side) / 2, Math.min((bitmap.height - side) / 2, draft.y));
        return side;
    }
    function draw() {
        if (!bitmap || !draft) return;
        const side = clamp();
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.drawImage(bitmap, bitmap.width / 2 + draft.x - side / 2,
            bitmap.height / 2 + draft.y - side / 2, side, side, 0, 0, SIZE, SIZE);
        zoom.value = draft.zoom; zoomLabel.textContent = Math.round(draft.zoom * 100) + '%';
    }
    async function open() {
        const target = state;
        if (!target || loading || exporting) return;
        if (!bitmap) await load(target);
        if (!bitmap || state !== target) return;
        draft = { zoom: state.zoom, x: state.x, y: state.y };
        status.textContent = '枠内が最終Artworkになります。ドラッグで位置を調整してください。';
        apply.disabled = false; zoom.disabled = false;
        document.getElementById('artwork-reset').disabled = false;
        draw(); dialog.showModal();
    }
    edit.addEventListener('click', () => { void open(); });
    document.getElementById('artwork-cancel').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { draft = dragging = null; });
    document.getElementById('artwork-reset').addEventListener('click', () => {
        if (!draft || exporting) return;
        draft = { zoom: 1, x: 0, y: 0 }; draw();
    });
    original.addEventListener('click', () => {
        if (!state || exporting) return;
        URL.revokeObjectURL(editedPreview); editedPreview = '';
        Object.assign(state, { zoom: 1, x: 0, y: 0, edited: false, blob: null }); summary();
    });
    zoom.addEventListener('input', () => {
        if (!draft || exporting) return;
        draft.zoom = Number(zoom.value); draw();
    });
    canvas.addEventListener('pointerdown', event => {
        if (!draft || exporting || event.button !== 0) return;
        canvas.setPointerCapture(event.pointerId);
        dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('pointermove', event => {
        if (!draft || exporting || dragging?.id !== event.pointerId) return;
        const side = clamp(); const width = canvas.getBoundingClientRect().width;
        draft.x -= (event.clientX - dragging.x) * side / width;
        draft.y -= (event.clientY - dragging.y) * side / width;
        dragging.x = event.clientX; dragging.y = event.clientY; draw();
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => { dragging = null; });
    canvas.addEventListener('keydown', event => {
        if (!draft || exporting || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const step = clamp() / 50;
        if (event.key === 'ArrowLeft') draft.x += step;
        if (event.key === 'ArrowRight') draft.x -= step;
        if (event.key === 'ArrowUp') draft.y += step;
        if (event.key === 'ArrowDown') draft.y -= step;
        draw();
    });
    apply.addEventListener('click', async () => {
        if (!draft || exporting || !bitmap) return;
        const target = state, version = generation, crop = { ...draft };
        exporting = true; apply.disabled = zoom.disabled = true;
        document.getElementById('artwork-reset').disabled = true;
        status.textContent = 'Artworkを生成しています…';
        try {
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
            if (!blob) throw new Error('画像を生成できませんでした。');
            if (state !== target || version !== generation || !dialog.open) return;
            URL.revokeObjectURL(editedPreview); editedPreview = URL.createObjectURL(blob);
            Object.assign(state, crop, { edited: true, blob });
            dialog.close();
        } catch { if (state === target) status.textContent = '画像を生成できませんでした。再度お試しください。'; }
        finally {
            if (state === target) {
                exporting = false; apply.disabled = zoom.disabled = false;
                document.getElementById('artwork-reset').disabled = false; summary();
            }
        }
    });
    window.addEventListener('pagehide', release);
    return { setContext };
})();
