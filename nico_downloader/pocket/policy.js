// NicoPocket の出力仕様と保存待ちの上限。各実行画面で同じ値を使う。
globalThis.NicoPocketPolicy = Object.freeze({
    standardBitrateKbps: 192,
    artworkSize: 768,
    artworkJpegQuality: 0.9,
    artworkInputMaxBytes: 10 * 1024 * 1024,
    artworkMaxBytes: 2 * 1024 * 1024,
    saveIdleTimeoutMs: 10 * 60 * 1000,
    artworkAllowedHosts: Object.freeze(['nicovideo.cdn.nimg.jp', 'tn.smilevideo.jp']),
    normalizeThumbnailUrl(value) {
        if (typeof value !== 'string') return '';
        try {
            const url = new URL(value);
            if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
            return NicoPocketPolicy.artworkAllowedHosts.includes(url.hostname.toLowerCase()) ? url.href : '';
        } catch { return ''; }
    }
});
