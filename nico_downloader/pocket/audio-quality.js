// Select existing renditions; cap known higher-bitrate standard audio only.
// Never infer audio bitrate from variant BANDWIDTH.
globalThis.NicoPocketAudioQuality = {
    outputArgs(requested, bitrate) {
        return requested === 'standard' && Number.isFinite(bitrate) && bitrate > 192
            ? ['-c:a', 'aac', '-b:a', '192k', '-profile:a', 'aac_low'] : ['-c:a', 'copy'];
    },
    select(renditions, qualities, requested) {
        const candidates = renditions.filter(item => item.TYPE === 'AUDIO' && typeof item.URI === 'string');
        if (!candidates.length) return null;
        const ranked = candidates.map(item => {
            let path;
            try { path = decodeURIComponent(new URL(item.URI).pathname); } catch { return null; }
            const names = [item.NAME, item.ID, path].filter(value => typeof value === 'string');
            const matches = qualities.filter(q => q.id && names.some(name => name === q.id
                || name.split(/[^a-zA-Z0-9-]+/).includes(q.id)));
            if (matches.length > 1) return null;
            if (matches.some(q => q.available === false)) return false;
            const id = matches[0]?.id || names.find(name => /^audio-aac-\d+(?:\.\d+)?kbps$/.test(name))
                || path.match(/(?:^|\/)(audio-aac-\d+(?:\.\d+)?kbps)(?:[./]|$)/)?.[1];
            const bitrate = Number(id?.match(/(?:^|-)([0-9]+(?:\.[0-9]+)?)kbps$/)?.[1]);
            return id && Number.isFinite(bitrate) && bitrate > 0 ? { item, id, bitrate } : null;
        }).filter(item => item !== false);
        if (!ranked.length) return null;
        // An unrankable candidate could be best: retain the upstream default safely.
        if (ranked.some(item => !item)) return null;
        const below = ranked.filter(item => item.bitrate <= 192);
        const pool = requested === 'high' || !below.length ? ranked : below;
        return pool.reduce((best, item) => item.bitrate > best.bitrate ? item : best);
    }
};
