// Draft values stay separate until Apply; the existing Metadata builder owns normalization.
(() => {
    const dialog = document.getElementById('metadata-dialog');
    const shell = document.querySelector('.app-shell');
    const edit = document.getElementById('metadata-edit');
    const reference = document.getElementById('metadata-reference');
    const fields = { artist: document.getElementById('metadata-artist'),
        genre: document.getElementById('metadata-genre'), album: document.getElementById('metadata-album'),
        album_artist: document.getElementById('metadata-album-artist') };
    let modalContext, priorFocus, priorOverflow, priorAria;
    let presetSequence = 0;
    const presetStatus = document.getElementById('metadata-preset-status');
    const presetFields = { artists: fields.artist, albumArtists: fields.album_artist, genres: fields.genre, albums: fields.album };
    async function refreshPresets() {
        const version = ++presetSequence;
        try {
            const presets = await NicoPocketPresets.load();
            if (version !== presetSequence) return;
            for (const [key, input] of Object.entries(presetFields)) {
                const list = document.getElementById('metadata-presets-' + key); list.replaceChildren();
                for (const value of presets[key]) {
                    const button = document.createElement('button'); button.type = 'button'; button.textContent = value;
                    button.addEventListener('click', () => {
                        if (!dialog.open || !sourceMatches()) return;
                        if (key === 'artists' || key === 'albumArtists') {
                            const lines = input.value.split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean);
                            if (lines.includes(value)) { presetStatus.textContent = 'この値は入力済みです。'; return; }
                            const next = [...lines, value].join('\n');
                            if (next.length > input.maxLength) { presetStatus.textContent = '入力は4000文字以内にしてください。'; return; }
                            input.value = next;
                        } else input.value = value;
                        presetStatus.textContent = NicoPocketPresets.groups[key] + 'の下書きへ反映しました。「適用」で確定します。';
                    });
                    list.append(button);
                }
                if (!presets[key].length) { const empty = document.createElement('span'); empty.className = 'preset-empty'; empty.textContent = '未登録'; list.append(empty); }
            }
        } catch { if (version === presetSequence) presetStatus.textContent = 'プリセットを読み込めませんでした。手入力は利用できます。'; }
    }
    document.getElementById('metadata-presets-settings').addEventListener('click', () => {
        void chrome.runtime.openOptionsPage().catch(() => { presetStatus.textContent = '拡張機能のオプションからプリセットを管理してください。'; });
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[NicoPocketPresets.key] && dialog.open) void refreshPresets();
    });
    const sourceMatches = () => modalContext && NicoPocketEditor.context
        && ['sourceTabId', 'videoId', 'sourceUrl'].every(key => modalContext[key] === NicoPocketEditor.context[key]);
    function availability() { edit.disabled = !NicoPocketEditor.context || Boolean(NicoPocketEditor.downloading); }
    function fill(automatic = false) {
        const initial = NicoPocketEditor.metadataOriginal || {};
        for (const [key, input] of Object.entries(fields)) {
            // Do not split existing commas: they may belong to a person's name.
            input.value = !automatic && Object.hasOwn(NicoPocketEditor.metadataEdits, key)
                ? NicoPocketEditor.metadataEdits[key] : initial[key] || '';
        }
    }
    function open() {
        if (edit.disabled || document.querySelector('dialog[open]') || !NicoPocketEditor.context) return;
        fill();
        presetStatus.textContent = '';
        void refreshPresets();
        const context = NicoPocketEditor.context;
        modalContext = { sourceTabId: context.sourceTabId, videoId: context.videoId, sourceUrl: context.sourceUrl };
        reference.replaceChildren();
        const tags = NicoPocketMetadata.build({ ...context, title: NicoPocketTitle.normalize(NicoPocketEditor.title, context.videoId) });
        for (const [key, label] of Object.entries({ title: 'Title', episode_id: 'Video ID', comment: 'Video URL', date: 'Date', creation_time: 'Creation Time' })) {
            if (!tags[key]) continue;
            const row = document.createElement('div'), term = document.createElement('dt'), value = document.createElement('dd');
            term.textContent = label; value.textContent = tags[key]; row.append(term, value); reference.append(row);
        }
        priorFocus = document.activeElement;
        priorOverflow = document.documentElement.style.overflow;
        priorAria = shell.getAttribute('aria-hidden');
        dialog.showModal();
        downloadButton.disabled = true;
        shell.inert = true; shell.setAttribute('aria-hidden', 'true');
        document.documentElement.style.overflow = 'hidden';
        void chrome.runtime.sendMessage({ kind: 'np:editor-modal', open: true, ...modalContext }).catch(() => {});
        fields.artist.focus({ preventScroll: true });
    }
    edit.addEventListener('click', open);
    document.getElementById('metadata-reset').addEventListener('click', () => fill(true));
    document.getElementById('metadata-cancel').addEventListener('click', () => dialog.close());
    document.getElementById('metadata-form').addEventListener('submit', event => {
        event.preventDefault(); event.stopPropagation();
        if (!sourceMatches() || NicoPocketEditor.downloading) { dialog.close(); return; }
        // Retain newline input for re-editing; preview and output normalize with build().
        NicoPocketEditor.metadataEdits = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]));
        renderMetadata(); dialog.close();
    });
    for (const name of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'keydown', 'keyup', 'input', 'change', 'wheel']) {
        shell.addEventListener(name, event => {
            if (!dialog.open) return;
            event.preventDefault(); event.stopImmediatePropagation();
        }, { capture: true, passive: false });
        dialog.addEventListener(name, event => event.stopPropagation());
    }
    dialog.addEventListener('wheel', event => {
        // Allow editor scrolling, but no scroll chaining outside this dialog.
        const top = dialog.scrollTop <= 0, bottom = dialog.scrollTop + dialog.clientHeight >= dialog.scrollHeight - 1;
        if ((event.deltaY < 0 && top) || (event.deltaY > 0 && bottom)) event.preventDefault();
    }, { passive: false });
    dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); dialog.close(); return; }
        if (event.key !== 'Tab') return;
        const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.addEventListener('focusin', event => {
        if (dialog.open && !dialog.contains(event.target)) fields.artist.focus({ preventScroll: true });
    });
    dialog.addEventListener('close', () => {
        void chrome.runtime.sendMessage({ kind: 'np:editor-modal', open: false, ...modalContext }).catch(() => {});
        modalContext = null;
        shell.inert = false;
        if (priorAria == null) shell.removeAttribute('aria-hidden'); else shell.setAttribute('aria-hidden', priorAria);
        document.documentElement.style.overflow = priorOverflow || '';
        if (priorFocus?.isConnected && !priorFocus.disabled) priorFocus.focus({ preventScroll: true });
        syncAACButton();
        availability();
    });
    window.addEventListener('np:metadata-context', () => {
        if (dialog.open) dialog.close();
        availability();
    });
    window.addEventListener('np:download-state', availability);
    availability();
})();
