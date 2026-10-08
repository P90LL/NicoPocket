// Settings-only CRUD and explicit JSON backup. The M4A save pipeline is untouched.
(() => {
    const host = document.getElementById('preset-groups');
    const status = document.getElementById('preset-status');
    const fileInput = document.getElementById('preset-import-file');
    let busy = false, sequence = 0;
    const urls = new Set();
    function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
    function setBusy(value) {
        busy = value;
        for (const control of document.querySelectorAll('#metadata-presets button, #metadata-presets input')) control.disabled = value;
    }
    async function update(change) {
        if (busy) return;
        setBusy(true);
        try {
            // Reload before each mutation rather than overwriting with an old rendered snapshot.
            const current = await NicoPocketPresets.load();
            change(current);
            await NicoPocketPresets.save(current);
            message('プリセットを保存しました。');
        } catch { message('保存できませんでした。入力・重複・登録状態を確認してください。', true); }
        finally { setBusy(false); await refresh(); }
    }
    function valueFrom(input) {
        const value = input.value.trim();
        if (!value) throw new Error('empty');
        return value;
    }
    const values = (presets, key) => key === 'genres' ? presets.genres.custom : presets[key];
    function render(presets) {
        host.replaceChildren();
        for (const [key, label] of Object.entries(NicoPocketPresets.groups)) {
            const section = document.createElement('section'); section.className = 'preset-group'; section.dataset.group = key;
            const heading = document.createElement('h3'); heading.textContent = label;
            section.append(heading);
            if (key === 'genres') {
                const title = document.createElement('h4'); title.textContent = '標準ジャンル';
                const builtinList = document.createElement('div'); builtinList.className = 'genre-builtins';
                for (const builtin of NicoPocketPresets.builtins) {
                    const label = document.createElement('label'), checkbox = document.createElement('input');
                    checkbox.type = 'checkbox'; checkbox.dataset.builtin = builtin.id;
                    checkbox.checked = presets.genres.enabledBuiltins.includes(builtin.id);
                    checkbox.addEventListener('change', () => {
                        const enabled = checkbox.checked;
                        void update(current => {
                            const ids = new Set(current.genres.enabledBuiltins);
                            if (enabled) ids.add(builtin.id); else ids.delete(builtin.id);
                            current.genres.enabledBuiltins = NicoPocketPresets.builtins.filter(item => ids.has(item.id)).map(item => item.id);
                        });
                    });
                    label.append(checkbox, document.createTextNode(builtin.label)); builtinList.append(label);
                }
                const customTitle = document.createElement('h4'); customTitle.textContent = '追加ジャンル';
                section.append(title, builtinList, customTitle);
            }
            const list = document.createElement('ul'); list.className = 'preset-list';
            for (const value of values(presets, key)) {
                const row = document.createElement('li'), text = document.createElement('span'); text.textContent = value;
                const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '編集'; edit.setAttribute('aria-label', label + '「' + value + '」を編集');
                const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '削除'; remove.className = 'preset-delete'; remove.setAttribute('aria-label', label + '「' + value + '」を削除');
                edit.addEventListener('click', () => {
                    const form = document.createElement('form'), input = document.createElement('input');
                    input.type = 'text'; input.value = value; input.maxLength = 4000; input.required = true; input.setAttribute('aria-label', label + 'プリセットの編集値');
                    const apply = document.createElement('button'); apply.type = 'submit'; apply.textContent = '保存';
                    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'キャンセル';
                    cancel.addEventListener('click', () => { void refresh(); });
                    form.append(input, apply, cancel); row.replaceChildren(form); input.focus();
                    form.addEventListener('submit', event => {
                        event.preventDefault();
                        void update(current => {
                            const next = valueFrom(input), index = values(current, key).indexOf(value);
                            if (index < 0 || (next !== value && values(current, key).includes(next))) throw new Error('duplicate or changed');
                            values(current, key)[index] = next;
                        });
                    });
                });
                remove.addEventListener('click', () => {
                    if (!confirm(label + 'のこのプリセットを削除しますか？')) return;
                    void update(current => { const list = values(current, key), index = list.indexOf(value); if (index >= 0) list.splice(index, 1); });
                });
                row.append(text, edit, remove); list.append(row);
            }
            if (!values(presets, key).length) { const empty = document.createElement('li'); empty.textContent = '未登録'; empty.className = 'note'; list.append(empty); }
            const form = document.createElement('form'); form.className = 'preset-add';
            const input = document.createElement('input'); input.type = 'text'; input.maxLength = 4000; input.required = true; input.placeholder = '新しいプリセット'; input.setAttribute('aria-label', label + 'プリセットを追加');
            const add = document.createElement('button'); add.type = 'submit'; add.textContent = '＋ 追加';
            form.addEventListener('submit', event => {
                event.preventDefault();
                void update(current => { const value = valueFrom(input); if (values(current, key).includes(value)) throw new Error('duplicate'); values(current, key).push(value); });
            });
            form.append(input, add); section.append(list, form); host.append(section);
        }
        setBusy(busy);
    }
    async function refresh() {
        const version = ++sequence;
        try { const presets = await NicoPocketPresets.load(); if (version === sequence) render(presets); }
        catch { message('プリセットを読み込めませんでした。バックアップ内容を確認してください。', true); }
    }
    document.getElementById('preset-export').addEventListener('click', async () => {
        if (busy) return;
        setBusy(true);
        try {
            const data = await NicoPocketPresets.load();
            const blob = new Blob([NicoPocketPresets.stringify(data)], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob); urls.add(url);
            const link = document.createElement('a'); link.href = url; link.download = 'nicopocket-metadata-presets.json'; link.click();
            setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 1000);
            message('JSONの書き出しを開始しました。');
        } catch { message('JSONを書き出せませんでした。', true); }
        finally { setBusy(false); }
    });
    document.getElementById('preset-import').addEventListener('click', () => { if (!busy) fileInput.click(); });
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0]; fileInput.value = '';
        if (!file || busy) return;
        setBusy(true);
        try {
            if (file.size > 1024 * 1024) throw new Error('JSONは1 MB以内にしてください。');
            const data = NicoPocketPresets.parse(await file.text());
            if (!confirm('現在のプリセットをすべて置き換えます。続行しますか？')) { message('読み込みをキャンセルしました。'); return; }
            await NicoPocketPresets.save(data);
            message('プリセットを読み込み、すべて置き換えました。');
        } catch (error) { message(error.message || 'JSONを読み込めませんでした。既存プリセットは変更していません。', true); }
        finally { setBusy(false); await refresh(); }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[NicoPocketPresets.key]) void refresh();
    });
    window.addEventListener('pagehide', () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); });
    void refresh();
})();
