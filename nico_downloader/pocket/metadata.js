// One mapping shared by the preview and FFmpeg output.
const NicoPocketMetadata = {
    // Only line breaks separate names; spaces and commas inside names stay intact.
    normalizeMultiValue(value) {
        return String(value ?? '').split(/\r\n|\r|\n/)
            .map(line => line.replace(/[\u0000-\u001f\u007f]/g, ' ').trim())
            .filter(Boolean).join(', ');
    },
    normalizeEdits(edits) {
        const result = {};
        for (const key of ['artist', 'genre', 'album', 'album_artist']) {
            if (!Object.hasOwn(edits || {}, key) || typeof edits[key] !== 'string') continue;
            const text = edits[key].slice(0, 4000);
            result[key] = key === 'artist' || key === 'album_artist'
                ? this.normalizeMultiValue(text).slice(0, 4000).trim() : text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
        }
        return result;
    },
    normalizeTags(values) {
        return Array.isArray(values) ? values.slice(0, 50).filter(value => typeof value === 'string')
            .map(value => value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500)).filter(Boolean) : [];
    },
    build(info) {
        const tags = { title: info.title, artist: info.uploader, episode_id: info.videoId,
            comment: info.sourceUrl, keywords: this.normalizeTags(info.videoTags).join(', '), genre: info.genre, album: info.series,
            album_artist: info.series ? info.uploader : undefined };
        if (typeof info.registeredAt === 'string' && info.registeredAt.trim()
            && Number.isFinite(Date.parse(info.registeredAt))) {
            tags.date = tags.creation_time = info.registeredAt;
        }
        // Explicit empty overrides remove tags instead of falling back to automatic values.
        Object.assign(tags, this.normalizeEdits(info.metadataEdits));
        return Object.fromEntries(Object.entries(tags).flatMap(([key, value]) => {
            if (typeof value !== 'string') return [];
            const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
            return clean ? [[key, clean]] : [];
        }));
    }
};
