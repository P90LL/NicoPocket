import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers/load-script.mjs';

const { exported } = loadScript('nico_downloader/pocket/policy.js', {
    exportNames: ['NicoPocketPolicy'],
});
const { NicoPocketPolicy } = exported;

test('NicoPocketPolicy.artworkAllowedHosts is frozen and contains exact allowed hosts', () => {
    assert.equal(Object.isFrozen(NicoPocketPolicy), true);
    assert.equal(Object.isFrozen(NicoPocketPolicy.artworkAllowedHosts), true);
    assert.deepEqual(NicoPocketPolicy.artworkAllowedHosts, [
        'nicovideo.cdn.nimg.jp',
        'tn.smilevideo.jp',
    ]);
});

test('NicoPocketPolicy.normalizeThumbnailUrl accepts valid https URLs from allowed hosts', () => {
    assert.equal(
        NicoPocketPolicy.normalizeThumbnailUrl(
            'https://nicovideo.cdn.nimg.jp/thumbnails/12345/12345.L'
        ),
        'https://nicovideo.cdn.nimg.jp/thumbnails/12345/12345.L'
    );
    assert.equal(
        NicoPocketPolicy.normalizeThumbnailUrl('https://tn.smilevideo.jp/smile?i=12345'),
        'https://tn.smilevideo.jp/smile?i=12345'
    );
    assert.equal(
        NicoPocketPolicy.normalizeThumbnailUrl(
            'https://NICOVIDEO.CDN.NIMG.JP/thumbnails/12345/12345.L'
        ),
        'https://nicovideo.cdn.nimg.jp/thumbnails/12345/12345.L'
    );
});

test('NicoPocketPolicy.normalizeThumbnailUrl rejects non-https, unallowed hosts, credentials, custom ports, and non-strings', () => {
    // Non-https protocols
    assert.equal(
        NicoPocketPolicy.normalizeThumbnailUrl('http://nicovideo.cdn.nimg.jp/thumbnails/123/123.L'),
        ''
    );
    assert.equal(
        NicoPocketPolicy.normalizeThumbnailUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='),
        ''
    );

    // Unallowed hosts and subdomain spoofing
    assert.equal(NicoPocketPolicy.normalizeThumbnailUrl('https://example.com/a.jpg'), '');
    assert.equal(
        NicoPocketPolicy.normalizeThumbnailUrl(
            'https://nicovideo.cdn.nimg.jp.evil.example/a.jpg'
        ),
        ''
    );
    assert.equal(
        NicoPocketPolicy.normalizeThumbnailUrl('https://sub.nicovideo.cdn.nimg.jp/a.jpg'),
        ''
    );

    // Embedded credentials
    assert.equal(
        NicoPocketPolicy.normalizeThumbnailUrl(
            'https://user:pass@nicovideo.cdn.nimg.jp/thumbnails/123/123.L'
        ),
        ''
    );
    assert.equal(
        NicoPocketPolicy.normalizeThumbnailUrl(
            'https://user@tn.smilevideo.jp/smile?i=123'
        ),
        ''
    );

    // Explicit non-default port
    assert.equal(
        NicoPocketPolicy.normalizeThumbnailUrl(
            'https://nicovideo.cdn.nimg.jp:8443/thumbnails/123/123.L'
        ),
        ''
    );

    // Relative paths, empty strings, and non-strings
    assert.equal(NicoPocketPolicy.normalizeThumbnailUrl('/thumbnails/123/123.L'), '');
    assert.equal(NicoPocketPolicy.normalizeThumbnailUrl(''), '');
    assert.equal(NicoPocketPolicy.normalizeThumbnailUrl(null), '');
    assert.equal(NicoPocketPolicy.normalizeThumbnailUrl(undefined), '');
    assert.equal(NicoPocketPolicy.normalizeThumbnailUrl(123), '');
    assert.equal(NicoPocketPolicy.normalizeThumbnailUrl({}), '');
});
