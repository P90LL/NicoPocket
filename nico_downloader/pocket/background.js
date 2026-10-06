// Carries lightweight video information and explicit download requests.
importScripts('title.js');
let opening = Promise.resolve();
async function openEditor(context, sourceTabId) {
    if (context) {
        await chrome.storage.session.set({
            'np:videoContext': { ...context, sourceTabId, title: NicoPocketTitle.normalize(context.title, context.videoId) }
        });
    }
    const stored = await chrome.storage.session.get('np:editorWindowId');
    const id = stored['np:editorWindowId'];
    if (Number.isInteger(id)) {
        try {
            await chrome.windows.update(id, { focused: true });
            return;
        } catch { /* Closed windows are recreated below. */ }
    }
    const editor = await chrome.windows.create({
        url: chrome.runtime.getURL('pocket/window.html'),
        type: 'popup', width: 1080, height: 820, focused: true
    });
    await chrome.storage.session.set({ 'np:editorWindowId': editor.id });
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.kind !== 'np:open-editor' || sender.id !== chrome.runtime.id) return;
    const currentUrl = sender.tab?.url || sender.url || '';
    if (!sender.tab || sender.frameId !== 0
        || !/^https:\/\/www\.nicovideo\.jp\//.test(sender.url || '')
        || !/^https:\/\/www\.nicovideo\.jp\/watch\/[a-zA-Z0-9]+\/?(?:[?#].*)?$/.test(currentUrl)) {
        reply({ ok: false });
        return;
    }
    const data = message.context;
    const sourceUrl = currentUrl.split(/[?#]/)[0].replace(/\/$/, '');
    if (!data || typeof data.videoId !== 'string'
        || data.sourceUrl !== sourceUrl
        || sourceUrl !== 'https://www.nicovideo.jp/watch/' + data.videoId
        || !['title', 'originalTitle', 'uploader', 'thumbnailUrl'].every(key => typeof data[key] === 'string')
        || !Array.isArray(data.audioQualities)) {
        reply({ ok: false });
        return;
    }
    // Whitelist fields rather than retaining watch JSON or arbitrary message data.
    const context = {
        videoId: data.videoId, sourceUrl, title: data.title.slice(0, 500),
        originalTitle: data.originalTitle.slice(0, 1000), uploader: data.uploader.slice(0, 500),
        genre: typeof data.genre === 'string' ? data.genre.trim().slice(0, 500) : '',
        series: typeof data.series === 'string' ? data.series.trim().slice(0, 500) : '',
        registeredAt: typeof data.registeredAt === 'string' ? data.registeredAt.trim().slice(0, 100) : '',
        thumbnailUrl: /^https:\/\//.test(data.thumbnailUrl) ? data.thumbnailUrl : '',
        audioQualities: data.audioQualities.slice(0, 30).map(audio => ({
            id: typeof audio?.id === 'string' ? audio.id.slice(0, 100) : '',
            available: audio?.available === true,
            bitrate: Number.isFinite(audio?.bitrate) && audio.bitrate > 0 ? audio.bitrate : null
        })),
        informationSource: data.informationSource === 'upstream-json' ? 'upstream-json' : 'page-fallback',
        incomplete: data.incomplete === true
    };
    opening = opening.catch(() => {}).then(() => openEditor(context, sender.tab.id));
    opening.then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
});

// Single AAC job; existing content-side code performs media acquisition and saving.
let startingAAC = false;
const terminalAAC = state => !state || ['complete', 'error'].includes(state.phase);
let aacUpdates = Promise.resolve();
function updateAAC(id, changes) {
    const task = aacUpdates.catch(() => {}).then(() => applyAACUpdate(id, changes));
    aacUpdates = task;
    return task;
}
async function applyAACUpdate(id, changes) {
    const stored = await chrome.storage.session.get('np:aacJob');
    const state = stored['np:aacJob'];
    if (!state || state.id !== id || terminalAAC(state)) return;
    const next = { ...state, ...changes };
    // Session storage is not exposed to content scripts. Release their lock explicitly.
    if (terminalAAC(next) || changes.downloadId != null) {
        try { await chrome.tabs.sendMessage(state.sourceTabId, { kind: 'np:aac-status',
            jobId: state.id, phase: next.phase, error: next.error, downloadId: next.downloadId }, { frameId: 0 }); } catch { /* Closed source tab. */ }
    }
    await chrome.storage.session.set({ 'np:aacJob': next });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.kind === 'np:aac-start') {
        if (sender.url !== chrome.runtime.getURL('pocket/window.html')) return;
        if (startingAAC) { respond({ ok: false, error: '処理中です。' }); return; }
        startingAAC = true;
        void (async () => {
            const stored = await chrome.storage.session.get(['np:aacJob', 'np:videoContext']);
            if (!terminalAAC(stored['np:aacJob'])) throw new Error('AACの処理中です。');
            const context = stored['np:videoContext'];
            if (!context || context.videoId !== message.videoId || context.sourceTabId !== message.sourceTabId
                || context.sourceUrl !== message.sourceUrl) throw new Error('表示中の動画情報が変わりました。開き直してください。');
            // JPEG bytes are forwarded for this request only, never stored in session state.
            const candidate = message.artwork;
            const bytes = candidate?.bytes;
            const artwork = candidate && candidate.videoId === context.videoId
                && candidate.sourceTabId === context.sourceTabId && candidate.sourceUrl === context.sourceUrl
                && candidate.thumbnailUrl === context.thumbnailUrl && Array.isArray(bytes)
                && bytes.length >= 4 && bytes.length <= 2 * 1024 * 1024
                && bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
                && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217
                ? bytes : null;
            const state = { id: crypto.randomUUID(), phase: 'starting', videoId: context.videoId,
                sourceTabId: context.sourceTabId, title: NicoPocketTitle.normalize(message.title, context.videoId), startedAt: Date.now(),
                metadata: { uploader: context.uploader, sourceUrl: context.sourceUrl,
                    genre: context.genre, series: context.series, registeredAt: context.registeredAt } };
            await chrome.storage.session.set({ 'np:aacJob': state });
            try {
                // Receiver verifies the current watch ID again immediately before execution.
                const reply = await chrome.tabs.sendMessage(context.sourceTabId, {
                    kind: 'np:aac-run', jobId: state.id, videoId: context.videoId, title: state.title, metadata: state.metadata, artwork
                }, { frameId: 0 });
                if (!reply?.ok) throw new Error(reply?.error || '取得元タブでAAC処理を開始できませんでした。');
                return { ok: true, jobId: state.id };
            } catch (error) {
                await updateAAC(state.id, { phase: 'error', error: error.message });
                throw error;
            }
        })().then(respond, error => respond({ ok: false, error: error.message || '取得開始に失敗しました。' }))
            .finally(() => { startingAAC = false; });
        return true;
    }
    if (!['np:aac-event', 'np:aac-save-ready'].includes(message?.kind) || !sender.tab || sender.frameId !== 0) return;
    void (async () => {
        const stored = await chrome.storage.session.get('np:aacJob');
        const state = stored['np:aacJob'];
        if (!state || state.id !== message.jobId || state.sourceTabId !== sender.tab.id || terminalAAC(state)) return { ok: false };
        if (message.kind === 'np:aac-save-ready') {
            if (typeof message.url !== 'string' || !message.url.startsWith('blob:https://www.nicovideo.jp/')) return { ok: false };
            await updateAAC(state.id, { phase: 'saving', saveUrl: message.url, saveReadyAt: Date.now() });
        } else if (['acquiring', 'saving', 'error'].includes(message.phase)) {
            await updateAAC(state.id, { phase: message.phase, error: typeof message.error === 'string' ? message.error.slice(0, 500) : undefined });
        }
        return { ok: true };
    })().then(respond, () => respond({ ok: false }));
    return true;
});
chrome.downloads.onCreated.addListener(item => {
    void (async () => {
        const stored = await chrome.storage.session.get('np:aacJob');
        const state = stored['np:aacJob'];
        if (!state || terminalAAC(state) || !state.saveUrl || ![item.url, item.finalUrl].includes(state.saveUrl)) return;
        await updateAAC(state.id, { downloadId: item.id, saveUrl: null });
        const records = await chrome.downloads.search({ id: item.id });
        if (records[0]?.state === 'complete') await updateAAC(state.id, { phase: 'complete' });
        if (records[0]?.state === 'interrupted') await updateAAC(state.id, { phase: 'error', error: 'M4Aの保存が中断されました。再度実行できます。' });
    })().catch(console.error);
});
chrome.downloads.onChanged.addListener(delta => {
    if (!['complete', 'interrupted'].includes(delta.state?.current)) return;
    void (async () => {
        const stored = await chrome.storage.session.get('np:aacJob');
        const state = stored['np:aacJob'];
        if (state?.downloadId !== delta.id) return;
        await updateAAC(state.id, delta.state.current === 'complete'
            ? { phase: 'complete' } : { phase: 'error', error: 'M4Aの保存が中断されました。再度実行できます。' });
    })().catch(console.error);
});
chrome.tabs.onRemoved.addListener(tabId => {
    void chrome.storage.session.get('np:aacJob').then(stored => {
        const state = stored['np:aacJob'];
        if (state?.sourceTabId === tabId) return updateAAC(state.id, { phase: 'error', error: '取得元タブが閉じられました。' });
    }).catch(console.error);
});
