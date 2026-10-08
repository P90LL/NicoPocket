// Final M4A saving belongs to the extension window, never to the video page DOM.
(() => {
    let transfer = null, output = null;
    const issued = new Set();
    function release() {
        if (output) URL.revokeObjectURL(output.url);
        transfer = output = null;
    }
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (message?.kind !== 'np:m4a-transfer' || message.owner !== 'nicopocket' || sender.id !== chrome.runtime.id
            || !sender.tab || sender.frameId !== 0) return;
        void (async () => {
            const state = (await chrome.storage.session.get('np:aacJob'))['np:aacJob'];
            if (state?.owner !== 'nicopocket' || state.id !== message.jobId
                || state.sourceTabId !== sender.tab.id || ['complete', 'error'].includes(state.phase)) return { ok: false };
            if (message.stage === 'begin') {
                if (transfer || output || state.saveReadyAt || issued.has(state.id) || message.mime !== 'audio/mp4' || message.filename !== state.title + '.m4a'
                    || !Number.isSafeInteger(message.size) || message.size <= 0) return { ok: false };
                transfer = { id: state.id, filename: message.filename, size: message.size, received: 0, chunks: [] };
                return { ok: true };
            }
            const target = transfer;
            if (!target || target.id !== state.id) return { ok: false };
            if (message.stage === 'chunk') {
                const bytes = message.bytes;
                if (message.index !== target.chunks.length || !Array.isArray(bytes) || !bytes.length || bytes.length > 65536
                    || target.received + bytes.length > target.size
                    || !bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) return { ok: false };
                target.chunks.push(Uint8Array.from(bytes)); target.received += bytes.length;
                return { ok: true };
            }
            if (message.stage !== 'end' || target.received !== target.size || issued.has(state.id)) return { ok: false };
            // Reject raw audio renamed as M4A before creating any downloadable Blob URL.
            const head = target.chunks[0];
            if (!head || head.length < 12 || String.fromCharCode(...head.subarray(4, 8)) !== 'ftyp') {
                release(); return { ok: false };
            }
            issued.add(state.id);
            if (issued.size > 20) issued.delete(issued.values().next().value);
            transfer = null;
            const blob = new Blob(target.chunks, { type: 'audio/mp4' });
            target.chunks = [];
            const url = URL.createObjectURL(blob);
            output = { id: target.id, url };
            const ready = await chrome.runtime.sendMessage({ kind: 'np:aac-save-ready', jobId: target.id,
                owner: 'nicopocket', url, filename: target.filename, mime: blob.type });
            if (!ready?.ok || output?.id !== target.id) { release(); return { ok: false }; }
            // Detached extension-origin link: non-bubbling click cannot reach the player or main UI.
            const link = document.createElement('a');
            link.href = url; link.download = target.filename;
            link.addEventListener('click', event => event.stopImmediatePropagation());
            link.click();
            return { ok: true };
        })().then(respond, () => { release(); respond({ ok: false }); });
        return true;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        const state = changes['np:aacJob']?.newValue;
        if (area === 'session' && state && (state.id !== (output?.id || transfer?.id)
            || ['complete', 'error'].includes(state.phase))) release();
    });
    window.addEventListener('pagehide', release);
})();
