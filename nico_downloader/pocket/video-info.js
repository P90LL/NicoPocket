// Lightweight watch JSON only. Reuses upstream acquisition and JSON accessors.
const NicoPocketVideo = (() => {
    const currentId = () => /^\/watch\/([a-zA-Z0-9]+)\/?$/.exec(location.pathname)?.[1];
    function imageUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' ? url.href : '';
        } catch { return ''; }
    }
    async function readCurrent() {
        const videoId = currentId();
        if (!videoId || location.origin !== 'https://www.nicovideo.jp') throw new Error('対象動画を確認できません。');
        const sourceUrl = 'https://www.nicovideo.jp/watch/' + videoId;
        const video = new NicovideoClass();
        let failed = false;
        try { await video.SetAllFromVideoSm(videoId); } catch { failed = true; }
        if (videoId !== currentId()) throw new Error('動画が切り替わりました。現在の動画で再度開いてください。');
        const returnedId = video.JsonToId();
        if (returnedId && returnedId !== videoId) throw new Error('動画情報のIDが一致しません。');
        const data = video.GetWatchData();
        const thumbnail = video.GetVideo().thumbnail ?? {};
        const originalTitle = video.JsonToTitle() || document.querySelector('h1')?.textContent?.trim()
            || document.querySelector('meta[property="og:title"]')?.content || '';
        const uploader = video.JsonToUser() || data.owner?.nickname || data.channel?.name
            || data.metadata?.jsonLd?.author?.name || '';
        const thumbnailUrl = [thumbnail.ogp, thumbnail.largeUrl, thumbnail.player, thumbnail.url,
            thumbnail.middleUrl, document.querySelector('meta[property="og:image"]')?.content]
            .map(imageUrl).find(Boolean) || '';
        // Keep quality descriptors, never signed media URLs or session tokens.
        const audios = data.media?.domand?.audios;
        const audioQualities = Array.isArray(audios) ? audios.map(audio => ({
            id: typeof audio.id === 'string' ? audio.id : '',
            available: audio.isAvailable === true,
            bitrate: Number.isFinite(audio.bitrate) && audio.bitrate > 0 ? audio.bitrate : null
        })).filter(audio => audio.id) : [];
        return {
            videoId, sourceUrl, originalTitle,
            title: NicoPocketTitle.normalize(originalTitle, videoId),
            uploader, thumbnailUrl, audioQualities,
            informationSource: failed || !returnedId ? 'page-fallback' : 'upstream-json',
            incomplete: !originalTitle || !uploader || !thumbnailUrl
        };
    }
    return { readCurrent };
})();
