// Carries lightweight video information; media acquisition stays disconnected.
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
