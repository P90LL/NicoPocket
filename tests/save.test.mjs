import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, normalizeRealm } from './helpers/load-script.mjs';

function createSaveEnv({ jobState } = {}) {
    let messageListener = null;
    const sentMessages = [];
    const createdObjectUrls = [];
    const revokedObjectUrls = [];
    const clickedLinks = [];

    const state = jobState ?? {
        owner: 'nicopocket',
        id: 'job-1',
        sourceTabId: 42,
        phase: 'processing',
        title: 'テスト曲',
    };

    const chromeMock = {
        runtime: {
            id: 'ext-id',
            onMessage: {
                addListener(fn) {
                    messageListener = fn;
                },
            },
            async sendMessage(msg) {
                sentMessages.push(normalizeRealm(msg));
                return { ok: true };
            },
        },
        storage: {
            session: {
                async get() {
                    return { 'np:aacJob': state };
                },
            },
            onChanged: {
                addListener() {},
            },
        },
    };

    const urlMock = {
        createObjectURL(blob) {
            const url = `blob:chrome-extension://ext-id/${createdObjectUrls.length + 1}`;
            createdObjectUrls.push({ url, blob });
            return url;
        },
        revokeObjectURL(url) {
            revokedObjectUrls.push(url);
        },
    };

    const documentMock = {
        createElement(tag) {
            assert.equal(tag, 'a');
            const link = {
                href: '',
                download: '',
                listeners: [],
                addEventListener(type, fn) {
                    this.listeners.push({ type, fn });
                },
                click() {
                    clickedLinks.push({ href: this.href, download: this.download });
                },
            };
            return link;
        },
    };

    const windowMock = {
        addEventListener() {},
    };

    loadScript('nico_downloader/pocket/save.js', {
        globals: {
            chrome: chromeMock,
            URL: urlMock,
            Blob,
            document: documentMock,
            window: windowMock,
        },
    });

    async function sendTransfer(payload) {
        return new Promise(resolve => {
            messageListener(
                {
                    kind: 'np:m4a-transfer',
                    owner: 'nicopocket',
                    jobId: state.id,
                    ...payload,
                },
                { id: 'ext-id', tab: { id: state.sourceTabId }, frameId: 0 },
                reply => resolve(normalizeRealm(reply))
            );
        });
    }

    return {
        state,
        sendTransfer,
        sentMessages,
        createdObjectUrls,
        revokedObjectUrls,
        clickedLinks,
    };
}

// Valid M4A box header: size=24 (0x00000018), type='ftyp' (0x66,0x74,0x79,0x70), brand='M4A '
const VALID_FTYP_BYTES = [
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x4d, 0x34, 0x41, 0x20,
    0x00, 0x00, 0x00, 0x00,
];

test('save.js accepts valid single-chunk ftyp M4A transfer and triggers download', async () => {
    const env = createSaveEnv();

    assert.deepEqual(
        await env.sendTransfer({
            stage: 'begin',
            mime: 'audio/mp4',
            filename: 'テスト曲.m4a',
            size: VALID_FTYP_BYTES.length,
        }),
        { ok: true }
    );

    assert.deepEqual(
        await env.sendTransfer({
            stage: 'chunk',
            index: 0,
            bytes: VALID_FTYP_BYTES,
        }),
        { ok: true }
    );

    assert.deepEqual(await env.sendTransfer({ stage: 'end' }), { ok: true });
    assert.equal(env.createdObjectUrls.length, 1);
    assert.equal(env.sentMessages.length, 1);
    assert.equal(env.sentMessages[0].kind, 'np:aac-save-ready');
    assert.equal(env.sentMessages[0].filename, 'テスト曲.m4a');
    assert.equal(env.clickedLinks.length, 1);
    assert.equal(env.clickedLinks[0].download, 'テスト曲.m4a');
});

test('save.js accepts valid ftyp header split across multiple small chunks (4 bytes + 8 bytes + 4 bytes)', async () => {
    const env = createSaveEnv();
    const chunk0 = VALID_FTYP_BYTES.slice(0, 4); // size field only
    const chunk1 = VALID_FTYP_BYTES.slice(4, 12); // 'ftyp' + major brand
    const chunk2 = VALID_FTYP_BYTES.slice(12); // remaining payload

    assert.deepEqual(
        await env.sendTransfer({
            stage: 'begin',
            mime: 'audio/mp4',
            filename: 'テスト曲.m4a',
            size: VALID_FTYP_BYTES.length,
        }),
        { ok: true }
    );

    assert.deepEqual(await env.sendTransfer({ stage: 'chunk', index: 0, bytes: chunk0 }), { ok: true });
    assert.deepEqual(await env.sendTransfer({ stage: 'chunk', index: 1, bytes: chunk1 }), { ok: true });
    assert.deepEqual(await env.sendTransfer({ stage: 'chunk', index: 2, bytes: chunk2 }), { ok: true });

    assert.deepEqual(await env.sendTransfer({ stage: 'end' }), { ok: true });
    assert.equal(env.createdObjectUrls.length, 1);
    assert.equal(env.sentMessages.length, 1);
    assert.equal(env.clickedLinks.length, 1);
});

test('save.js rejects non-ftyp headers and payloads shorter than 12 bytes without issuing Blob URLs', async () => {
    // 1. Non-ftyp header (e.g. raw ADTS / arbitrary header)
    const envInvalidHeader = createSaveEnv();
    const adtsBytes = [
        0xff, 0xf1, 0x50, 0x80,
        0x41, 0x44, 0x54, 0x53,
        0x00, 0x00, 0x00, 0x00,
    ];
    await envInvalidHeader.sendTransfer({
        stage: 'begin',
        mime: 'audio/mp4',
        filename: 'テスト曲.m4a',
        size: adtsBytes.length,
    });
    await envInvalidHeader.sendTransfer({ stage: 'chunk', index: 0, bytes: adtsBytes });
    assert.deepEqual(await envInvalidHeader.sendTransfer({ stage: 'end' }), { ok: false });
    assert.equal(envInvalidHeader.createdObjectUrls.length, 0);
    assert.equal(envInvalidHeader.sentMessages.length, 0);
    assert.equal(envInvalidHeader.clickedLinks.length, 0);

    // 2. Payload shorter than 12 bytes
    const envShort = createSaveEnv();
    const shortBytes = [0x00, 0x00, 0x00, 0x08, 0x66, 0x74, 0x79, 0x70];
    await envShort.sendTransfer({
        stage: 'begin',
        mime: 'audio/mp4',
        filename: 'テスト曲.m4a',
        size: shortBytes.length,
    });
    await envShort.sendTransfer({ stage: 'chunk', index: 0, bytes: shortBytes });
    assert.deepEqual(await envShort.sendTransfer({ stage: 'end' }), { ok: false });
    assert.equal(envShort.createdObjectUrls.length, 0);
    assert.equal(envShort.sentMessages.length, 0);
    assert.equal(envShort.clickedLinks.length, 0);
});
