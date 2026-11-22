import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadScript, resolveRepoPath } from './helpers/load-script.mjs';

const { exported } = loadScript('nico_downloader/pocket/metadata-presets.js', {
    exportNames: ['NicoPocketPresets'],
});
const { NicoPocketPresets } = exported;

const toHost = value => JSON.parse(JSON.stringify(value));

test('NicoPocketPresets.empty, normalize, and stringify/parse round-trip', () => {
    const empty = toHost(NicoPocketPresets.empty());
    assert.deepEqual(empty.artists, []);
    assert.deepEqual(empty.albumArtists, []);
    assert.deepEqual(empty.albums, []);
    assert.equal(empty.genres.enabledBuiltins.length, 8);
    assert.deepEqual(empty.genres.custom, []);

    const sample = {
        artists: ['  DECO*27 ', 'ピノキオピー', 'DECO*27'],
        albumArtists: ['初音ミク'],
        genres: {
            enabledBuiltins: ['vocaloid', 'music-sound'],
            custom: ['ボカロオリジナル'],
        },
        albums: ['テストアルバム'],
        excludedArtists: {
            artists: ['除外アーティスト'],
            albumArtists: [],
        },
    };

    const jsonText = NicoPocketPresets.stringify(sample);
    const parsed = toHost(NicoPocketPresets.parse(jsonText));
    assert.deepEqual(parsed, {
        artists: ['DECO*27', 'ピノキオピー'],
        albumArtists: ['初音ミク'],
        genres: {
            enabledBuiltins: ['vocaloid', 'music-sound'],
            custom: ['ボカロオリジナル'],
        },
        albums: ['テストアルバム'],
        excludedArtists: {
            artists: ['除外アーティスト'],
            albumArtists: [],
        },
    });
});

test('NicoPocketPresets.parse migrates version 1 genre labels into version 2 builtin IDs and custom genres', () => {
    const v1Text = JSON.stringify({
        version: 1,
        metadataPresets: {
            artists: ['Artist 1'],
            albumArtists: [],
            genres: ['音楽・サウンド', 'VOCALOID', '独自ジャンル'],
            albums: ['Series 1'],
        },
    });

    const migrated = toHost(NicoPocketPresets.parse(v1Text));
    assert.deepEqual(migrated, {
        artists: ['Artist 1'],
        albumArtists: [],
        genres: {
            enabledBuiltins: ['music-sound', 'vocaloid'],
            custom: ['独自ジャンル'],
        },
        albums: ['Series 1'],
    });
});

test('NicoPocketPresets rejects invalid JSON, unsupported versions, unknown builtin IDs, duplicate custom genre names, multiline items, and >1000 items', () => {
    assert.throws(() => NicoPocketPresets.parse('{invalid json'), /JSONとして読み込めませんでした/);
    assert.throws(
        () => NicoPocketPresets.parse(JSON.stringify({ version: 3, metadataPresets: {} })),
        /対応するJSONのversionは1または2です/
    );

    const base = toHost(NicoPocketPresets.empty());

    assert.throws(
        () =>
            NicoPocketPresets.normalize({
                ...base,
                genres: { enabledBuiltins: ['unknown-genre-id'], custom: [] },
            }),
        /未対応の標準ジャンルIDが含まれています/
    );

    assert.throws(
        () =>
            NicoPocketPresets.normalize({
                ...base,
                genres: { enabledBuiltins: [], custom: ['VOCALOID'] },
            }),
        /追加ジャンルは標準ジャンルと異なる名前にしてください/
    );

    assert.throws(
        () => NicoPocketPresets.normalize({ ...base, artists: ['line1\nline2'] }),
        /1行で指定してください/
    );

    const over1000 = Array.from({ length: 1001 }, (_, i) => `Artist ${i}`);
    assert.throws(
        () => NicoPocketPresets.normalize({ ...base, artists: over1000 }),
        /1000件以下の配列にしてください/
    );
});

test('bundled metadata-artists.json is version 1 and passes NicoPocketPresets.list', () => {
    const raw = fs.readFileSync(
        resolveRepoPath('nico_downloader/pocket/presets/metadata-artists.json'),
        'utf8'
    );
    const data = JSON.parse(raw);
    assert.equal(data.version, 1);
    const list = toHost(NicoPocketPresets.list(data.artists));
    assert.ok(Array.isArray(list) && list.length > 0);
});
