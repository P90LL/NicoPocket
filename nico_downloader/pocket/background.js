// Only opens the editor. No video context or media is acquired in Phase 1.
let opening = Promise.resolve();
async function openEditor() {
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
    if (!sender.tab || !/^https:\/\/www\.nicovideo\.jp\/watch\/[a-zA-Z0-9]+\/?(?:[?#].*)?$/.test(sender.url || '')) {
        reply({ ok: false });
        return;
    }
    opening = opening.catch(() => {}).then(openEditor);
    opening.then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
});
