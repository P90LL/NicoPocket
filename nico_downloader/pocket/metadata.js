// One mapping shared by the preview and FFmpeg output.
const NicoPocketMetadata = {
    build(info) {
        const tags = { title: info.title, artist: info.uploader, episode_id: info.videoId,
            comment: info.sourceUrl, genre: info.genre, album: info.series,
            album_artist: info.series ? info.uploader : undefined };
        if (typeof info.registeredAt === 'string' && info.registeredAt.trim()
            && Number.isFinite(Date.parse(info.registeredAt))) {
            tags.date = tags.creation_time = info.registeredAt;
        }
        return Object.fromEntries(Object.entries(tags).flatMap(([key, value]) => {
            if (typeof value !== 'string') return [];
            const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
            return clean ? [[key, clean]] : [];
        }));
    }
};
