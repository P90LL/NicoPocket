// Shared by the editor and later filename / metadata integrations.
const NicoPocketTitle = {
    normalize(value, fallback = 'untitled') {
        const clean = text => String(text ?? '').normalize('NFC')
            .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
            .replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
        let title = clean(value) || clean(fallback) || 'untitled';
        title = Array.from(title).slice(0, 180).join('').replace(/[. ]+$/g, '');
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(title)) title = '_' + title;
        return title;
    }
};
