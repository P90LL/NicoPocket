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
    const presetFields = { artists: fields.artist, albumArtists: fields.album_artist, albums: fields.album };
    const genreSelect = document.getElementById('metadata-genre-select');
    let genrePresets, availablePresets = {};
    const picker = document.getElementById('metadata-preset-dialog');
    const pickerSearch = document.getElementById('metadata-preset-search');
    const pickerList = document.getElementById('metadata-preset-list');
    const pickerStatus = document.getElementById('metadata-preset-selection');
    let selection, pickerFocus;
    function renderPicker() {
        if (!selection) return;
        const query = pickerSearch.value.trim().toLocaleLowerCase();
        pickerList.replaceChildren();
        const values = availablePresets[selection.key] || [];
        for (const value of values) {
            if (!value.toLocaleLowerCase().includes(query)) continue;
            const row = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
            input.type = selection.key === 'albums' ? 'radio' : 'checkbox';
            input.name = 'preset-choice'; input.checked = selection.checked.has(value);
            text.textContent = value;
            input.addEventListener('change', () => {
                if (input.type === 'radio') selection.checked.clear();
                if (input.checked) selection.checked.add(value); else selection.checked.delete(value);
                updatePickerCount();
            });
            row.className = 'preset-choice'; row.append(input, text); pickerList.append(row);
        }
        if (!pickerList.children.length) {
            const empty = document.createElement('p'); empty.className = 'subtle';
            empty.textContent = values.length ? '一致するプリセットがありません。' : 'プリセットは未登録です。編集画面の「プリセットを管理」から登録できます。';
            pickerList.append(empty);
        }
        updatePickerCount();
    }
    function updatePickerCount() {
        const values = availablePresets[selection.key] || [];
        const count = values.filter(value => selection.checked.has(value)).length;
        pickerStatus.textContent = `${count}件選択 / ${values.length}件登録`;
    }
    function openPicker(key, button) {
        if (!dialog.open || picker.open || !sourceMatches()) return;
        const input = presetFields[key];
        selection = { key, original: input.value, checked: new Set(key === 'albums'
            ? [input.value.trim()] : input.value.split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean)) };
        document.getElementById('metadata-preset-title').textContent = NicoPocketPresets.groups[key] + 'のプリセットを選択';
        document.getElementById('metadata-preset-help').textContent = key === 'albums'
            ? '1件選択すると入力を置き換えます。未選択の場合は現在の入力を維持します。'
            : 'チェックで追加・除外します。手入力した値は維持します。';
        pickerFocus = button; pickerSearch.value = ''; renderPicker();
        picker.showModal(); dialog.inert = true; dialog.setAttribute('aria-hidden', 'true');
        pickerSearch.focus({ preventScroll: true });
    }
    for (const key of Object.keys(presetFields)) {
        const button = document.getElementById('metadata-presets-' + key);
        button.addEventListener('click', () => openPicker(key, button));
    }
    pickerSearch.addEventListener('input', renderPicker);
    document.getElementById('metadata-preset-cancel').addEventListener('click', () => picker.close());
    document.getElementById('metadata-preset-form').addEventListener('submit', event => {
        event.preventDefault(); event.stopPropagation();
        if (!selection || !sourceMatches() || NicoPocketEditor.downloading) { picker.close(); return; }
        const input = presetFields[selection.key], values = availablePresets[selection.key] || [];
        let next = selection.original;
        if (selection.key === 'albums') {
            const value = values.find(value => selection.checked.has(value));
            if (value !== undefined) next = value;
        } else {
            const lines = selection.original.split(/\r\n|\r|\n/);
            // Only registered preset lines may be removed; retain free input verbatim.
            const kept = selection.original.trim() ? lines.filter(line => !values.includes(line.trim()) || selection.checked.has(line.trim())) : [];
            const present = new Set(kept.map(line => line.trim()));
            const added = values.filter(value => selection.checked.has(value) && !present.has(value));
            next = [...kept, ...added].join('\n');
        }
        if (next.length > input.maxLength) { pickerStatus.textContent = '入力は4000文字以内にしてください。選択数を減らしてください。'; return; }
        input.value = next;
        presetStatus.textContent = NicoPocketPresets.groups[selection.key] + 'の下書きへ反映しました。「適用」で確定します。';
        picker.close();
    });
    picker.addEventListener('close', () => {
        selection = null; dialog.inert = false; dialog.removeAttribute('aria-hidden');
        if (dialog.open && pickerFocus?.isConnected) pickerFocus.focus({ preventScroll: true });
    });
    picker.addEventListener('cancel', event => { event.preventDefault(); picker.close(); });
    for (const name of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'keydown', 'keyup', 'input', 'change', 'wheel']) {
        picker.addEventListener(name, event => event.stopPropagation());
    }
    picker.addEventListener('wheel', event => {
        const inList = pickerList.contains(event.target);
        const top = pickerList.scrollTop <= 0, bottom = pickerList.scrollTop + pickerList.clientHeight >= pickerList.scrollHeight - 1;
        if (!inList || (event.deltaY < 0 && top) || (event.deltaY > 0 && bottom)) event.preventDefault();
    }, { passive: false });
    picker.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const controls = [...picker.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    function renderGenre() {
        genreSelect.replaceChildren();
        for (const [label, items] of [
            ['標準ジャンル', NicoPocketPresets.builtins.filter(item => genrePresets?.enabledBuiltins.includes(item.id)).map(item => ({ value: 'builtin:' + item.id, label: item.label }))],
            ['追加ジャンル', (genrePresets?.custom || []).map((label, index) => ({ value: 'custom-preset:' + index, label }))]
        ]) {
            if (!items.length) continue;
            const group = document.createElement('optgroup'); group.label = label;
            for (const item of items) { const option = document.createElement('option'); option.value = item.value; option.textContent = item.label; group.append(option); }
            genreSelect.append(group);
        }
        const custom = document.createElement('option'); custom.value = 'custom'; custom.textContent = 'カスタム入力'; genreSelect.append(custom);
        const selected = [...genreSelect.options].find(option => option.value !== 'custom' && option.textContent === fields.genre.value);
        genreSelect.value = selected?.value || 'custom';
        fields.genre.hidden = genreSelect.value !== 'custom';
    }
    genreSelect.addEventListener('change', () => {
        if (!dialog.open || !sourceMatches()) return;
        const custom = genreSelect.value === 'custom';
        fields.genre.hidden = !custom;
        if (custom) fields.genre.focus(); else fields.genre.value = genreSelect.selectedOptions[0].textContent;
    });
    async function refreshPresets() {
        const version = ++presetSequence;
        try {
            const presets = await NicoPocketPresets.load();
            if (version !== presetSequence) return;
            genrePresets = presets.genres; renderGenre();
            availablePresets = presets;
            for (const key of Object.keys(presetFields)) {
                const button = document.getElementById('metadata-presets-' + key);
                button.textContent = `プリセットを選択（${presets[key].length}件）`;
            }
            if (picker.open) renderPicker();
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
        renderGenre();
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
        if (picker.open) return;
        if (event.key === 'Escape') { event.preventDefault(); dialog.close(); return; }
        if (event.key !== 'Tab') return;
        const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')].filter(control => !control.hidden);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.addEventListener('focusin', event => {
        if (picker.open) {
            if (!picker.contains(event.target)) pickerSearch.focus({ preventScroll: true });
        } else if (dialog.open && !dialog.contains(event.target)) fields.artist.focus({ preventScroll: true });
    });
    dialog.addEventListener('close', () => {
        if (picker.open) picker.close();
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
