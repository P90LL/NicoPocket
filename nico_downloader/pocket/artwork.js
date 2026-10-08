// Square crop editing and JPEG export; media embedding remains outside this UI module.
const NicoPocketArtwork = (() => {
    const presence = chrome.runtime.connect({ name: 'np:editor-presence' });
    const dialog = document.getElementById('artwork-dialog');
    const canvas = document.getElementById('artwork-canvas');
    const zoom = document.getElementById('artwork-zoom');
    const zoomLabel = document.getElementById('artwork-zoom-value');
    const status = document.getElementById('artwork-edit-status');
    const apply = document.getElementById('artwork-apply');
    const edit = document.getElementById('artwork-edit');
    const image = document.getElementById('artwork-image');
    const empty = document.getElementById('artwork-empty');
    const pill = document.getElementById('artwork-state');
    const note = document.getElementById('artwork-note');
    const background = document.getElementById('artwork-background');
    const stage = document.querySelector('.artwork-stage');
    const shell = document.querySelector('.app-shell');
    const preview = document.getElementById('artwork-preview');
    let priorFocus, priorOverflow, priorAria, modalContext;
    // Inert blocks user input; this also blocks accidental programmatic background events.
    for (const name of ['click', 'pointerdown', 'mousedown', 'keydown', 'wheel', 'input', 'change']) {
        shell.addEventListener(name, event => {
            if (!dialog.open) return;
            event.preventDefault(); event.stopImmediatePropagation();
        }, { capture: true, passive: false });
    }
    for (const name of ['click', 'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup', 'input', 'change', 'keyup']) {
        dialog.addEventListener(name, event => event.stopPropagation());
    }
    dialog.addEventListener('wheel', event => {
        event.stopPropagation();
        if (!stage.contains(event.target)) event.preventDefault();
    }, { passive: false });
    dialog.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); dialog.close(); return; }
        if (event.key !== 'Tab') return;
        const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.addEventListener('focusin', event => {
        if (dialog.open && !dialog.contains(event.target)) canvas.focus();
    });
    let editor, state, bitmap, controller, draft, dragging, generation = 0, pendingLoad;
    let sourcePreview = '', editedPreview = '', loading = false, exporting = false;
    const SIZE = 768;
    function release() {
        controller?.abort(); bitmap?.close(); bitmap = null;
        URL.revokeObjectURL(sourcePreview); URL.revokeObjectURL(editedPreview);
        sourcePreview = editedPreview = '';
    }
    function summary(error = '') {
        const url = editedPreview || sourcePreview;
        image.hidden = !url; empty.hidden = Boolean(url);
        if (url) image.src = url; else image.removeAttribute('src');
        image.alt = state?.blob ? '正方形Artwork' : '現在の動画のサムネイル';
        pill.textContent = error ? '読み込み失敗' : loading ? '読み込み中' : state?.edited ? '編集済み' : state?.blob ? '中央クロップ' : '未設定';
        empty.textContent = error || (loading ? 'サムネイルを読み込んでいます…' : 'サムネイル未取得');
        note.textContent = state?.edited ? '正方形Artworkの編集結果です。保存時にM4Aへ埋め込みます。' : '1:1の正方形に編集できます。未編集時は中央クロップを使用します。';
        edit.disabled = !state?.thumbnailUrl || loading || exporting || Boolean(editor?.downloading);
        window.dispatchEvent(new Event('np:artwork-change'));
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
            // Produce the same final JPEG for untouched thumbnails, without opening the editor.
            const output = document.createElement('canvas'); output.width = output.height = SIZE;
            const side = Math.min(next.width, next.height);
            const outputContext = output.getContext('2d');
            outputContext.imageSmoothingEnabled = true; outputContext.imageSmoothingQuality = 'high';
            outputContext.fillStyle = '#fff'; outputContext.fillRect(0, 0, SIZE, SIZE);
            outputContext.drawImage(next, (next.width - side) / 2, (next.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
            const initial = await new Promise(resolve => output.toBlob(resolve, 'image/jpeg', 0.9));
            if (version !== generation || state !== target) return;
            if (!initial) throw new Error('中央クロップを生成できませんでした。');
            target.blob = initial; editedPreview = URL.createObjectURL(initial);
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
        if (state?.thumbnailUrl) pendingLoad = load(state); else pendingLoad = null;
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
        const width = background.clientWidth || 900, height = background.clientHeight || 520;
        background.width = Math.round(width); background.height = Math.round(height);
        const bounds = canvas.getBoundingClientRect();
        const scale = (bounds.width || Math.min(width * .64, 480)) / side;
        const backdrop = background.getContext('2d');
        backdrop.clearRect(0, 0, background.width, background.height);
        backdrop.drawImage(bitmap, width / 2 - (bitmap.width / 2 + draft.x) * scale,
            height / 2 - (bitmap.height / 2 + draft.y) * scale, bitmap.width * scale, bitmap.height * scale);
        preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height);
        document.getElementById('artwork-position').textContent = 'X ' + Math.round(draft.x) + ' · Y ' + Math.round(draft.y);
        zoom.value = draft.zoom; zoomLabel.textContent = Math.round(draft.zoom * 100) + '%';
    }
    async function open() {
        const target = state;
        if (!target || loading || exporting) return;
        if (!bitmap) { pendingLoad = load(target); await pendingLoad; }
        if (!bitmap || state !== target) return;
        draft = { zoom: state.zoom, x: state.x, y: state.y };
        status.textContent = '枠内が最終Artworkになります。ドラッグで位置を調整してください。';
        apply.disabled = false; zoom.disabled = false;
        document.getElementById('artwork-reset').disabled = false;
        modalContext = { sourceTabId: state.sourceTabId, videoId: state.videoId, sourceUrl: state.sourceUrl };
        void chrome.runtime.sendMessage({ kind: 'np:editor-modal', open: true, ...modalContext }).catch(() => {});
        priorFocus = document.activeElement;
        priorOverflow = document.documentElement.style.overflow;
        priorAria = shell.getAttribute('aria-hidden');
        dialog.showModal();
        shell.inert = true; shell.setAttribute('aria-hidden', 'true');
        document.documentElement.style.overflow = 'hidden';
        canvas.focus({ preventScroll: true }); draw();
    }
    edit.addEventListener('click', () => { void open(); });
    document.getElementById('artwork-cancel').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        void chrome.runtime.sendMessage({ kind: 'np:editor-modal', open: false, ...modalContext }).catch(() => {});
        modalContext = null;
        draft = dragging = null; canvas.dataset.dragging = 'false';
        shell.inert = false;
        if (priorAria == null) shell.removeAttribute('aria-hidden'); else shell.setAttribute('aria-hidden', priorAria);
        document.documentElement.style.overflow = priorOverflow || '';
        if (priorFocus?.isConnected && !priorFocus.disabled) priorFocus.focus({ preventScroll: true });
    });
    document.getElementById('artwork-reset').addEventListener('click', () => {
        if (!draft || exporting) return;
        draft = { zoom: 1, x: 0, y: 0 }; draw();
    });
    function setZoom(value) {
        if (!draft || exporting) return;
        // x/y are the source-image crop center: zoom keeps that point until edge clamping.
        draft.zoom = Math.max(Number(zoom.min), Math.min(Number(zoom.max), value));
        draw();
    }
    zoom.addEventListener('input', () => setZoom(Number(zoom.value)));
    stage.addEventListener('wheel', event => {
        if (!draft || exporting) return;
        event.preventDefault(); event.stopPropagation();
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
        setZoom(draft.zoom * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002));
    }, { passive: false });
    stage.addEventListener('pointerdown', event => {
        if (!draft || exporting || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture(event.pointerId);
        canvas.dataset.dragging = 'true';
        dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
    });
    stage.addEventListener('pointermove', event => {
        if (!draft || exporting || dragging?.id !== event.pointerId) return;
        const side = clamp(); const width = canvas.getBoundingClientRect().width;
        draft.x -= (event.clientX - dragging.x) * side / width;
        draft.y -= (event.clientY - dragging.y) * side / width;
        dragging.x = event.clientX; dragging.y = event.clientY; draw();
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(name, () => { dragging = null; canvas.dataset.dragging = 'false'; });
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
    window.addEventListener('np:download-state', () => summary());
    window.addEventListener('pagehide', () => { release(); presence.disconnect(); });
    new ResizeObserver(() => { if (dialog.open) draw(); }).observe(dialog);
    return { setContext, async ready(context) {
        const target = state;
        if (!target || target.videoId !== context.videoId || target.sourceTabId !== context.sourceTabId
            || target.thumbnailUrl !== context.thumbnailUrl) return;
        await pendingLoad;
    } };
})();
