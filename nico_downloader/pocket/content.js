// Reuse the existing save control; intercept its click before the legacy handler.
const NicoPocketUI = (() => {
    const legacyLabel = element => /^aacを保存$/i.test((element.textContent || '').replace(/\s+/g, ''));
    const watchPage = () => location.origin === 'https://www.nicovideo.jp'
        && /^\/watch\/[a-zA-Z0-9]+\/?$/.test(location.pathname);
    let pending = false;

    function saveControls() {
        return [...document.querySelectorAll('button,a,[role="button"]')].filter(legacyLabel);
    }
    function convert(button) {
        // Retain the original element and its position, removing direct save attributes.
        button.removeAttribute('onclick');
        button.removeAttribute('download');
        if (button.tagName === 'A') {
            button.removeAttribute('href');
            button.setAttribute('role', 'button');
            button.tabIndex = 0;
        }
        if (button.tagName === 'BUTTON') button.type = 'button';
        button.dataset.nicopocketEditor = 'true';
        button.textContent = 'NicoPocketで保存';
    }
    function placeButton() {
        if (globalThis.NicoPocketAAC?.busy) return;
        if (!watchPage()) {
            document.querySelector('[data-nicopocket-created-slot]')?.remove();
            return;
        }
        const controls = saveControls();
        if (controls.length) {
            // A real legacy control takes priority over our initial-position fallback.
            document.querySelector('[data-nicopocket-created-slot]')?.remove();
            controls.forEach(convert);
            return;
        }
        if (document.querySelector('[data-nicopocket-editor]')) return;
        if (typeof VideoData === 'undefined') return;
        const existing = document.getElementById(VideoData.Video_DLlink.p);
        const original = existing?.querySelector('button,a,[role="button"]');
        if (original) { convert(original); return; }
        const target = document.getElementsByClassName(VideoData.Video_title_Element)[0];
        if (!existing && !target) return;
        // With no rendered legacy control, use its original slot, never a second entry.
        const slot = existing || document.createElement('p');
        slot.id = VideoData.Video_DLlink.p;
        slot.className = VideoData.Video_DLlink.div_class;
        if (!existing) slot.dataset.nicopocketCreatedSlot = 'true';
        const button = document.createElement('button');
        button.className = 'nicopocket-open';
        convert(button);
        slot.append(button);
        if (!existing) target.append(slot);
    }
    async function openEditor(button) {
        if (pending) return;
        pending = true;
        button.setAttribute('aria-busy', 'true');
        try {
            const context = await NicoPocketVideo.readCurrent();
            const reply = await chrome.runtime.sendMessage({ kind: 'np:open-editor', context });
            if (!reply?.ok) throw new Error('Editor could not be opened');
            document.getElementById('nicopocket-entry-status')?.remove();
        } catch {
            let status = document.getElementById('nicopocket-entry-status');
            if (!status) {
                status = document.createElement('span');
                status.id = 'nicopocket-entry-status';
                status.setAttribute('role', 'status');
                button.insertAdjacentElement('afterend', status);
            }
            status.textContent = '開けませんでした。ページを再読み込みして再試行してください。';
        } finally {
            button.removeAttribute('aria-busy');
            pending = false;
        }
    }
    function intercept(event) {
        if (!watchPage()) return;
        const button = event.target instanceof Element
            ? event.target.closest('[data-nicopocket-editor],button,a,[role="button"]') : null;
        if (!button || (!button.hasAttribute('data-nicopocket-editor') && !legacyLabel(button))) return;
        if (event.type === 'keydown' && (button.tagName !== 'A' || !['Enter', ' '].includes(event.key))) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!button.hasAttribute('data-nicopocket-editor')) convert(button);
        void openEditor(button);
    }
    // Installed at document_start: even a newly inserted AAC control cannot save first.
    document.addEventListener('click', intercept, true);
    document.addEventListener('keydown', intercept, true);
    new MutationObserver(placeButton).observe(document, { childList: true, subtree: true });
    placeButton();
    return { placeButton };
})();
