// ページ側で捕捉したwatch lazy応答から、必要な公開メタデータだけを受け取る。
(() => {
    if (!globalThis.chrome?.runtime?.id) return;
    const channel = 'nico-downloader-watch-metadata-v1';
    const client = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    const cache = new Map();
    const route = () => location.pathname.match(/^\/watch\/(sm[0-9]+)\/?$/)?.[1] || '';
    window.addEventListener('message', event => {
        const data = event.data;
        if (event.source !== window || event.origin !== location.origin || data?.channel !== channel ||
            data.client !== client || data.type !== 'metadata' || data.href !== location.href || data.videoId !== route()) return;
        cache.set(data.videoId, { owner: String(data.owner || ''), series: String(data.series || ''), href: data.href });
        while (cache.size > 8) cache.delete(cache.keys().next().value);
    });
    globalThis.NicoWatchMetadata = {
        get(videoId) {
            const item = cache.get(videoId);
            return item?.href === location.href && videoId === route() ? item : null;
        }
    };
    window.postMessage({ channel, client, type: 'subscribe' }, location.origin);
})();
