import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveRepoPath } from './helpers/load-script.mjs';

test('legacy colliding upstream paths are not referenced in manifest.json and do not exist in repository', () => {
    const forbiddenPaths = [
        'nicovideodownloader_scripts.js',
        'dist/utils.js',
    ];
    const manifestRaw = fs.readFileSync(resolveRepoPath('nico_downloader/manifest.json'), 'utf8');

    for (const rel of forbiddenPaths) {
        assert.equal(
            manifestRaw.includes(`"${rel}"`),
            false,
            `manifest.json must not reference legacy colliding path: ${rel}`
        );
        assert.equal(
            fs.existsSync(resolveRepoPath('nico_downloader', rel)),
            false,
            `Legacy colliding file must not exist at nico_downloader/${rel}`
        );
    }
});

test('manifest.json content_scripts load order preserves NicoPocket dependency invariants', () => {
    const manifest = JSON.parse(
        fs.readFileSync(resolveRepoPath('nico_downloader/manifest.json'), 'utf8')
    );
    const mainBundle = (manifest.content_scripts ?? []).find(cs =>
        Array.isArray(cs.js) && cs.js.includes('func/nicojson.js')
    );
    assert.ok(mainBundle, 'Expected content_scripts entry containing func/nicojson.js');

    const js = mainBundle.js;
    const indexOf = name => {
        const idx = js.indexOf(name);
        assert.notEqual(idx, -1, `Expected ${name} in content_scripts[].js`);
        return idx;
    };

    assert.ok(
        indexOf('pocket/watch-metadata-bridge.js') < indexOf('func/nicojson.js'),
        'pocket/watch-metadata-bridge.js must load before func/nicojson.js'
    );
    assert.ok(
        indexOf('pocket/download-runner.js') < indexOf('pocket/aac-bridge.js'),
        'pocket/download-runner.js must load before pocket/aac-bridge.js'
    );
    assert.ok(
        indexOf('pocket/m4a-encoder.js') < indexOf('pocket/aac-bridge.js'),
        'pocket/m4a-encoder.js must load before pocket/aac-bridge.js'
    );
    assert.ok(
        indexOf('pocket/policy.js') < indexOf('pocket/video-info.js'),
        'pocket/policy.js must load before pocket/video-info.js'
    );
});

test('NicoWatchMetadata definition is isolated in pocket/watch-metadata-bridge.js and not duplicated in func/nicojson.js', () => {
    const bridgeCode = fs.readFileSync(
        resolveRepoPath('nico_downloader/pocket/watch-metadata-bridge.js'),
        'utf8'
    );
    const nicojsonCode = fs.readFileSync(
        resolveRepoPath('nico_downloader/func/nicojson.js'),
        'utf8'
    );

    assert.equal(
        /globalThis\.NicoWatchMetadata\s*=/.test(bridgeCode),
        true,
        'Expected globalThis.NicoWatchMetadata assignment in pocket/watch-metadata-bridge.js'
    );
    assert.equal(
        /globalThis\.NicoWatchMetadata\s*=/.test(nicojsonCode),
        false,
        'func/nicojson.js must not contain duplicate globalThis.NicoWatchMetadata assignment'
    );
});

test('NicoPocket ownership guards exist in pocket/m4a-encoder.js and pocket/download-runner.js', () => {
    const encoderCode = fs.readFileSync(
        resolveRepoPath('nico_downloader/pocket/m4a-encoder.js'),
        'utf8'
    );
    const runnerCode = fs.readFileSync(
        resolveRepoPath('nico_downloader/pocket/download-runner.js'),
        'utf8'
    );

    for (const [label, code] of [
        ['pocket/m4a-encoder.js', encoderCode],
        ['pocket/download-runner.js', runnerCode],
    ]) {
        assert.equal(
            code.includes("outputOwner !== 'nicopocket'"),
            true,
            `Expected outputOwner !== 'nicopocket' guard in ${label}`
        );
        assert.equal(
            code.includes('NicoPocketAAC?.owns'),
            true,
            `Expected NicoPocketAAC?.owns guard in ${label}`
        );
    }
});
