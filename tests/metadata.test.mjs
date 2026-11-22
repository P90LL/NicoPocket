import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers/load-script.mjs';

const { exported } = loadScript('nico_downloader/pocket/metadata.js', {
    exportNames: ['NicoPocketMetadata'],
});
const { NicoPocketMetadata } = exported;

test('NicoPocketMetadata.normalizeMultiValue joins line-separated names and preserves internal commas', () => {
    const input = '  Artist A, Jr. \r\n\n Artist B feat. C \r Artist\u0000D  ';
    assert.equal(
        NicoPocketMetadata.normalizeMultiValue(input),
        'Artist A, Jr., Artist B feat. C, Artist D'
    );
    assert.equal(NicoPocketMetadata.normalizeMultiValue(''), '');
    assert.equal(NicoPocketMetadata.normalizeMultiValue(null), '');
});

test('NicoPocketMetadata.normalizeTags enforces 50-item / 500-char limits, strips control chars, and filters non-strings', () => {
    const longTag = 'あ'.repeat(600);
    const manyTags = Array.from({ length: 60 }, (_, i) => `tag-${i}`);
    manyTags[0] = `  clean\u0007tag  `;
    manyTags[1] = longTag;

    const normalized = NicoPocketMetadata.normalizeTags([
        null,
        123,
        '   ',
        ...manyTags,
    ]);

    assert.equal(normalized.length, 47); // 50 sliced minus 3 non-string/blank items in first 50
    assert.equal(normalized[0], 'clean tag');
    assert.equal(Array.from(normalized[1]).length, 500);
    assert.deepEqual(NicoPocketMetadata.normalizeTags(null), []);
});

test('NicoPocketMetadata.build maps standard fields, omits album_artist when series is absent, and never outputs description', () => {
    const full = NicoPocketMetadata.build({
        title: 'テスト楽曲',
        uploader: 'テスト投稿者',
        videoId: 'sm12345',
        sourceUrl: 'https://www.nicovideo.jp/watch/sm12345',
        videoTags: ['VOCALOID', '初音ミク'],
        genre: '音楽・サウンド',
        series: 'テストシリーズ',
        registeredAt: '2026-10-01T12:00:00+09:00',
        description: 'この説明文は出力されてはならない',
    });

    assert.deepEqual(full, {
        title: 'テスト楽曲',
        artist: 'テスト投稿者',
        episode_id: 'sm12345',
        comment: 'https://www.nicovideo.jp/watch/sm12345',
        keywords: 'VOCALOID, 初音ミク',
        genre: '音楽・サウンド',
        album: 'テストシリーズ',
        album_artist: 'テスト投稿者',
        date: '2026-10-01T12:00:00+09:00',
        creation_time: '2026-10-01T12:00:00+09:00',
    });
    assert.equal('description' in full, false);

    const withoutSeriesOrValidDate = NicoPocketMetadata.build({
        title: '単発動画',
        uploader: '投稿者B',
        videoId: 'sm999',
        sourceUrl: 'https://www.nicovideo.jp/watch/sm999',
        videoTags: [],
        genre: '',
        series: '',
        registeredAt: 'invalid-date',
    });

    assert.deepEqual(withoutSeriesOrValidDate, {
        title: '単発動画',
        artist: '投稿者B',
        episode_id: 'sm999',
        comment: 'https://www.nicovideo.jp/watch/sm999',
    });
});

test('NicoPocketMetadata.build applies metadataEdits and removes tags when explicitly overridden with empty string', () => {
    const edited = NicoPocketMetadata.build({
        title: '曲名',
        uploader: '元投稿者',
        videoId: 'sm100',
        sourceUrl: 'https://www.nicovideo.jp/watch/sm100',
        videoTags: ['tag1'],
        genre: '音楽・サウンド',
        series: '元シリーズ',
        metadataEdits: {
            artist: '編集後Artist 1\n編集後Artist 2',
            genre: '',
            album: '   ',
            album_artist: '編集後AlbumArtist',
            description: '悪意あるdescription混入',
        },
    });

    assert.deepEqual(edited, {
        title: '曲名',
        artist: '編集後Artist 1, 編集後Artist 2',
        episode_id: 'sm100',
        comment: 'https://www.nicovideo.jp/watch/sm100',
        keywords: 'tag1',
        album_artist: '編集後AlbumArtist',
    });
    assert.equal('genre' in edited, false);
    assert.equal('album' in edited, false);
    assert.equal('description' in edited, false);
});
