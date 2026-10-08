// Presets are input helpers only; no video context or media data belongs in this key.
const NicoPocketPresets = {
    key: 'metadataPresets',
    groups: { artists: 'Artist', albumArtists: 'Album Artist', genres: 'Genre', albums: 'Series / Album' },
    builtins: Object.freeze([
        { id: 'music-sound', label: '音楽・サウンド' },
        { id: 'vocaloid', label: 'VOCALOID' },
        { id: 'synthesizer-v', label: 'Synthesizer V' },
        { id: 'utau', label: 'UTAU' },
        { id: 'singing', label: '歌ってみた' },
        { id: 'performance', label: '演奏してみた' },
        { id: 'game', label: 'ゲーム' },
        { id: 'anime', label: 'アニメ' }
    ].map(item => Object.freeze(item))),
    empty() { return { artists: [], albumArtists: [], genres: { enabledBuiltins: this.builtins.map(item => item.id), custom: [] }, albums: [] }; },
    list(data) {
        if (!Array.isArray(data) || data.length > 1000) throw new Error('各項目は1000件以下の配列にしてください。');
        const result = [];
        for (const item of data) {
            if (typeof item !== 'string') throw new Error('プリセットには文字列だけを指定してください。');
            const value = item.trim();
            if (!value) continue;
            if (value.length > 4000 || /[\r\n]/.test(value)) throw new Error('プリセットは1項目4000文字以内の1行で指定してください。');
            if (!result.includes(value)) result.push(value);
        }
        return result;
    },
    migrate(data) {
        if (!data || !Array.isArray(data.genres)) throw new Error('旧Genreの形式を確認してください。');
        const genres = { enabledBuiltins: [], custom: [] };
        for (const label of this.list(data.genres)) {
            const builtin = this.builtins.find(item => item.label === label);
            if (builtin) genres.enabledBuiltins.push(builtin.id); else genres.custom.push(label);
        }
        return this.normalize({ ...data, genres });
    },
    normalize(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('プリセットの形式を確認してください。');
        const result = this.empty();
        for (const key of ['artists', 'albumArtists', 'albums']) result[key] = this.list(data[key]);
        const genres = data.genres;
        if (!genres || typeof genres !== 'object' || Array.isArray(genres)) throw new Error('Genreには標準設定と追加ジャンルを指定してください。');
        const enabledBuiltins = this.list(genres.enabledBuiltins);
        if (enabledBuiltins.some(id => !this.builtins.some(item => item.id === id))) throw new Error('未対応の標準ジャンルIDが含まれています。');
        const custom = this.list(genres.custom);
        if (custom.some(label => this.builtins.some(item => item.label === label))) throw new Error('追加ジャンルは標準ジャンルと異なる名前にしてください。');
        result.genres = { enabledBuiltins, custom };
        return result;
    },
    parse(text) {
        let data;
        try { data = JSON.parse(text); } catch { throw new Error('JSONとして読み込めませんでした。'); }
        if (data?.version === 1) return this.migrate(data.metadataPresets);
        if (data?.version !== 2) throw new Error('対応するJSONのversionは1または2です。');
        return this.normalize(data.metadataPresets);
    },
    async load() {
        const stored = await chrome.storage.local.get(this.key), data = stored[this.key];
        if (data === undefined) return this.empty();
        if (Array.isArray(data?.genres)) {
            const migrated = this.migrate(data);
            await chrome.storage.local.set({ [this.key]: migrated });
            return migrated;
        }
        return this.normalize(data);
    },
    async save(data) {
        const presets = this.normalize(data);
        await chrome.storage.local.set({ [this.key]: presets });
        return presets;
    },
    stringify(data) { return JSON.stringify({ version: 2, metadataPresets: this.normalize(data) }, null, 2) + '\n'; }
};
