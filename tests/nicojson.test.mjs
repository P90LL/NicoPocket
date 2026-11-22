import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers/load-script.mjs';

const toHost = value => JSON.parse(JSON.stringify(value));

function makeEl(tagName, { attrs = {}, classes = [], text = '', children = [] } = {}) {
    const el = {
        tagName: tagName.toUpperCase(),
        children: [],
        textContent: text,
        classList: { contains: c => classes.includes(c) },
        getAttribute: name => (name in attrs ? attrs[name] : null),
        contains(target) {
            if (target === el) return true;
            return el.children.some(child => child.contains(target));
        },
        querySelectorAll(selector) {
            const results = [];
            const walk = node => {
                for (const child of node.children) {
                    if (
                        selector === 'a[href]' &&
                        child.tagName === 'A' &&
                        child.getAttribute('href') != null
                    ) {
                        results.push(child);
                    }
                    walk(child);
                }
            };
            walk(el);
            return results;
        },
    };
    el.children = children;
    return el;
}

function buildDecoratedRoot(videoId, { includeDescription = true } = {}) {
    const descLink = makeEl('a', { attrs: { href: '/user/99999' }, text: '説明文内の別ユーザー' });
    const descGenreLink = makeEl('a', {
        attrs: { href: '/video_top/genre/other' },
        text: '説明文内ジャンル',
    });
    const descP = makeEl('p', { children: [descLink, descGenreLink], text: '説明文テキスト' });
    const pressable = makeEl('div', { classes: ['Pressable'], children: [descP] });

    const makeRow = (label, ddChild) =>
        makeEl('div', {
            children: [makeEl('dt', { text: label }), makeEl('dd', { children: [ddChild] })],
        });

    const dl = makeEl('dl', {
        children: [
            makeRow(
                '投稿日時',
                makeEl('time', {
                    attrs: { datetime: '2026-10-01T12:00:00+09:00' },
                    text: '2026/10/01 12:00',
                })
            ),
            makeRow('再生', makeEl('span', { text: '1,234' })),
            makeRow('コメント', makeEl('span', { text: '56' })),
            makeRow('いいね！', makeEl('span', { text: '78' })),
            makeRow('マイリスト', makeEl('span', { text: '9' })),
        ],
    });

    const genreLink = makeEl('a', {
        attrs: { href: '/video_top/genre/music' },
        text: '音楽・サウンド',
    });
    const seriesLink = makeEl('a', { attrs: { href: '/series/111' }, text: 'テストシリーズ' });
    const ownerLink = makeEl('a', { attrs: { href: '/user/222' }, text: '正規投稿者' });

    const children = [];
    if (includeDescription) children.push(pressable);
    children.push(dl, genreLink, seriesLink, ownerLink);

    return makeEl('div', { attrs: { 'data-decoration-video-id': videoId }, children });
}

function createNicojsonEnv({
    pathname = '/watch/sm12345',
    querySelectorMap = {},
    querySelectorAllMap = {},
    title = 'ニコニコ動画',
} = {}) {
    const location = {
        origin: 'https://www.nicovideo.jp',
        pathname,
        href: 'https://www.nicovideo.jp' + pathname,
    };
    const messageListeners = [];
    const postedMessages = [];
    const windowObj = {
        location,
        addEventListener: (type, fn) => {
            if (type === 'message') messageListeners.push(fn);
        },
        postMessage: (msg, origin) => {
            postedMessages.push({ msg, origin });
        },
    };
    const documentObj = {
        title,
        querySelector: sel => querySelectorMap[sel] ?? null,
        querySelectorAll: sel => querySelectorAllMap[sel] ?? [],
    };

    const { sandbox, exported } = loadScript('nico_downloader/func/nicojson.js', {
        globals: {
            chrome: { runtime: { id: 'test-ext-id' } },
            crypto: { randomUUID: () => 'test-client-uuid' },
            location,
            window: windowObj,
            document: documentObj,
            IsShortVideoPage: () => false,
            DebugPrint: () => {},
        },
        exportNames: ['NicovideoClass', 'NicoWatchMetadata'],
    });

    return {
        sandbox,
        NicovideoClass: exported.NicovideoClass,
        NicoWatchMetadata: exported.NicoWatchMetadata,
        location,
        windowObj,
        documentObj,
        messageListeners,
        postedMessages,
    };
}

test('NicoWatchMetadata registers listener and caches metadata message for current watch route', () => {
    const env = createNicojsonEnv({ pathname: '/watch/sm12345' });
    assert.ok(env.NicoWatchMetadata);
    assert.equal(env.postedMessages.length, 1);
    assert.equal(env.postedMessages[0].msg.type, 'subscribe');
    const client = env.postedMessages[0].msg.client;

    for (const listener of env.messageListeners) {
        listener({
            source: env.windowObj,
            origin: 'https://www.nicovideo.jp',
            data: {
                channel: 'nico-downloader-watch-metadata-v1',
                client,
                type: 'metadata',
                videoId: 'sm12345',
                href: 'https://www.nicovideo.jp/watch/sm12345',
                owner: 'ブリッジ投稿者',
                series: 'ブリッジシリーズ',
            },
        });
    }

    const cached = toHost(env.NicoWatchMetadata.get('sm12345'));
    assert.deepEqual(cached, {
        owner: 'ブリッジ投稿者',
        series: 'ブリッジシリーズ',
        href: 'https://www.nicovideo.jp/watch/sm12345',
    });
    assert.equal(env.NicoWatchMetadata.get('sm99999'), null);
});

test('NicovideoClass parses embedded server-response JSON and extracts metadata fields', async () => {
    const payload = JSON.stringify({
        meta: { status: 200 },
        data: {
            response: {
                video: {
                    id: 'sm12345',
                    title: '埋め込みJSONタイトル',
                    registeredAt: '2026-09-15T10:00:00+09:00',
                    count: { view: 100, comment: 20, mylist: 5, like: 30 },
                },
                owner: { nickname: 'JSON投稿者' },
                genre: { label: '音楽・サウンド' },
                series: { title: 'JSONシリーズ' },
                tag: { items: [{ name: 'VOCALOID' }, { name: '初音ミク' }] },
            },
        },
    });
    const metaEl = {
        getAttribute: name => (name === 'content' ? payload : null),
    };
    const env = createNicojsonEnv({
        pathname: '/watch/sm12345',
        querySelectorAllMap: {
            'meta[name="server-response"], #js-initial-watch-data[data-api-data]': [metaEl],
        },
    });

    const v = new env.NicovideoClass();
    await v.SetAllFromVideoSm('sm12345');

    assert.equal(v.JsonToId(), 'sm12345');
    assert.equal(v.JsonToTitle(), '埋め込みJSONタイトル');
    assert.equal(v.JsonToUser(), 'JSON投稿者');
    assert.deepEqual(toHost(v.JsonToTags()), ['VOCALOID', '初音ミク']);
    assert.equal(v.JsonToGenre(), '音楽・サウンド');
    assert.equal(v.JsonToSeries(), 'JSONシリーズ');
    assert.equal(v.JsonToRegisteredAt(), '2026-09-15T10:00:00+09:00');
    assert.equal(v.view_count, 100);
});

test('NicovideoClass.GetPageTitle prioritizes main h1.fs_xl.fw_bold, falls back to h1, and strips site suffix', () => {
    const env1 = createNicojsonEnv({
        pathname: '/watch/sm12345',
        querySelectorMap: {
            'main h1.fs_xl.fw_bold': { textContent: '優先H1タイトル - ニコニコ動画' },
            h1: { textContent: '汎用H1タイトル - ニコニコ動画' },
        },
    });
    const v1 = new env1.NicovideoClass();
    assert.equal(v1.GetPageTitle(), '優先H1タイトル');

    const env2 = createNicojsonEnv({
        pathname: '/watch/sm12345',
        querySelectorMap: {
            h1: { textContent: '汎用H1タイトル | niconico' },
        },
    });
    const v2 = new env2.NicovideoClass();
    assert.equal(v2.GetPageTitle(), '汎用H1タイトル');
});

test('NicovideoClass ReadDecoratedPageMetadata DOM fallback and page_counts reset on video switch', async () => {
    const envCheck = createNicojsonEnv();
    if (typeof envCheck.NicovideoClass.prototype.ReadDecoratedPageMetadata !== 'function') {
        return;
    }

    // 1. Decorated DOM fallback without description and filtering links inside description <p>
    const rootWithDescLinks = buildDecoratedRoot('sm12345', { includeDescription: true });
    const envDom = createNicojsonEnv({
        pathname: '/watch/sm12345',
        querySelectorMap: {
            'main h1.fs_xl.fw_bold': { textContent: 'DOM補完タイトル' },
        },
        querySelectorAllMap: {
            'meta[name="server-response"], #js-initial-watch-data[data-api-data]': [],
            '[data-decoration-video-id]': [rootWithDescLinks],
        },
    });
    const vDom = new envDom.NicovideoClass();
    await vDom.SetAllFromVideoSm('sm12345');
    assert.equal(vDom.JsonToId(), 'sm12345');
    assert.equal(vDom.JsonToTitle(), 'DOM補完タイトル');
    assert.equal(vDom.JsonToUser(), '正規投稿者');
    assert.equal(vDom.JsonToGenre(), '音楽・サウンド');
    assert.equal(vDom.JsonToSeries(), 'テストシリーズ');
    assert.equal(vDom.JsonToRegisteredAt(), '2026-10-01T12:00:00+09:00');
    assert.equal(vDom.view_count, 1234);

    // 2. Description element completely absent still succeeds
    const rootNoDesc = buildDecoratedRoot('sm12345', { includeDescription: false });
    const envNoDesc = createNicojsonEnv({
        pathname: '/watch/sm12345',
        querySelectorMap: {
            'main h1.fs_xl.fw_bold': { textContent: '説明文なしDOMタイトル' },
        },
        querySelectorAllMap: {
            'meta[name="server-response"], #js-initial-watch-data[data-api-data]': [],
            '[data-decoration-video-id]': [rootNoDesc],
        },
    });
    const vNoDesc = new envNoDesc.NicovideoClass();
    await vNoDesc.SetAllFromVideoSm('sm12345');
    assert.equal(vNoDesc.JsonToTitle(), '説明文なしDOMタイトル');
    assert.equal(vNoDesc.JsonToUser(), '正規投稿者');

    // 3. Different videoId DOM is ignored
    const otherRoot = buildDecoratedRoot('sm99999', { includeDescription: true });
    const envMismatch = createNicojsonEnv({
        pathname: '/watch/sm12345',
        querySelectorAllMap: {
            '[data-decoration-video-id]': [otherRoot],
        },
    });
    const vMismatch = new envMismatch.NicovideoClass();
    vMismatch.video_sm = 'sm12345';
    assert.equal(vMismatch.ReadDecoratedPageMetadata(), false);

    // 4. Video switch (sm1 -> sm2) resets page_counts
    const root1 = buildDecoratedRoot('sm1', { includeDescription: true });
    const sm2Payload = JSON.stringify({
        meta: { status: 200 },
        data: { video: { id: 'sm2', title: '動画2' } },
    });
    const sm2Meta = {
        getAttribute: name => (name === 'content' ? sm2Payload : null),
    };
    const envSwitch = createNicojsonEnv({
        pathname: '/watch/sm1',
        querySelectorMap: {
            'main h1.fs_xl.fw_bold': { textContent: '動画1' },
        },
        querySelectorAllMap: {
            'meta[name="server-response"], #js-initial-watch-data[data-api-data]': [],
            '[data-decoration-video-id]': [root1],
        },
    });
    const vSwitch = new envSwitch.NicovideoClass();
    await vSwitch.SetAllFromVideoSm('sm1');
    assert.equal(vSwitch.view_count, 1234);

    envSwitch.location.pathname = '/watch/sm2';
    envSwitch.location.href = 'https://www.nicovideo.jp/watch/sm2';
    envSwitch.documentObj.querySelectorAll = sel => {
        if (sel === 'meta[name="server-response"], #js-initial-watch-data[data-api-data]') {
            return [sm2Meta];
        }
        return [];
    };
    await vSwitch.SetAllFromVideoSm('sm2');
    assert.deepEqual(toHost(vSwitch.page_counts), {});
    assert.equal(vSwitch.view_count, 0);
});
