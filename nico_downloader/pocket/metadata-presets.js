// Presets are input helpers only; no video context or media data belongs in this key.
const NicoPocketPresets = {
    key: 'metadataPresets',
    groups: { artists: 'Artist', albumArtists: 'Album Artist', genres: 'Genre', albums: 'Series / Album' },
    empty() { return { artists: [], albumArtists: [], genres: [], albums: [] }; },
    normalize(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('プリセットの形式を確認してください。');
        const result = this.empty();
        for (const key of Object.keys(result)) {
            if (!Array.isArray(data[key]) || data[key].length > 1000) throw new Error('各項目は1000件以下の配列にしてください。');
            for (const item of data[key]) {
                if (typeof item !== 'string') throw new Error('プリセットには文字列だけを指定してください。');
                const value = item.trim();
                if (!value) continue;
                if (value.length > 4000 || /[\r\n]/.test(value)) throw new Error('プリセットは1項目4000文字以内の1行で指定してください。');
                if (!result[key].includes(value)) result[key].push(value);
            }
        }
        return result;
    },
    parse(text) {
        let data;
        try { data = JSON.parse(text); } catch { throw new Error('JSONとして読み込めませんでした。'); }
        if (data?.version !== 1) throw new Error('対応するJSONのversionは1です。');
        return this.normalize(data.metadataPresets);
    },
    async load() {
        const stored = await chrome.storage.local.get(this.key);
        return stored[this.key] === undefined ? this.empty() : this.normalize(stored[this.key]);
    },
    async save(data) {
        const presets = this.normalize(data);
        await chrome.storage.local.set({ [this.key]: presets });
        return presets;
    },
    stringify(data) { return JSON.stringify({ version: 1, metadataPresets: this.normalize(data) }, null, 2) + '\n'; }
};
