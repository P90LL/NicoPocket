import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadScript, resolveRepoPath } from './helpers/load-script.mjs';

const EXT_DIR = resolveRepoPath('nico_downloader');
const TESTS_DIR = resolveRepoPath('tests');

function walkFiles(dir, extensions) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkFiles(fullPath, extensions));
        } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
            results.push(fullPath);
        }
    }
    return results.sort();
}

test('all JavaScript files under nico_downloader/ and tests/ pass node --check', () => {
    const jsFiles = [
        ...walkFiles(EXT_DIR, ['.js']),
        ...walkFiles(TESTS_DIR, ['.mjs', '.js']),
    ];
    assert.ok(jsFiles.length > 0, 'Expected to find JavaScript files in nico_downloader/ and tests/');
    for (const filePath of jsFiles) {
        execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
    }
});

test('manifest.json and metadata-artists.json are valid JSON', () => {
    const manifestRaw = fs.readFileSync(resolveRepoPath('nico_downloader/manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw);
    assert.equal(typeof manifest, 'object');

    const artistsRaw = fs.readFileSync(
        resolveRepoPath('nico_downloader/pocket/presets/metadata-artists.json'),
        'utf8'
    );
    const artists = JSON.parse(artistsRaw);
    assert.equal(typeof artists, 'object');
});

test('manifest.json invariants and referenced files exist', () => {
    const manifest = JSON.parse(
        fs.readFileSync(resolveRepoPath('nico_downloader/manifest.json'), 'utf8')
    );

    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual([...(manifest.permissions ?? [])].sort(), ['downloads', 'storage']);
    assert.deepEqual(
        [...(manifest.host_permissions ?? [])].sort(),
        ['https://nicovideo.cdn.nimg.jp/*', 'https://tn.smilevideo.jp/*']
    );

    const referencedFiles = new Set();
    for (const rel of Object.values(manifest.icons ?? {})) referencedFiles.add(rel);
    for (const rel of Object.values(manifest.action?.default_icon ?? {})) referencedFiles.add(rel);
    if (manifest.action?.default_popup) referencedFiles.add(manifest.action.default_popup);
    if (manifest.options_page) referencedFiles.add(manifest.options_page);
    if (manifest.background?.service_worker) referencedFiles.add(manifest.background.service_worker);

    for (const cs of manifest.content_scripts ?? []) {
        for (const js of cs.js ?? []) referencedFiles.add(js);
        for (const css of cs.css ?? []) referencedFiles.add(css);
    }

    for (const war of manifest.web_accessible_resources ?? []) {
        for (const res of war.resources ?? []) referencedFiles.add(res);
    }

    assert.ok(referencedFiles.size > 0, 'Expected manifest to reference extension files');
    for (const relPath of referencedFiles) {
        const fullPath = path.join(EXT_DIR, relPath);
        assert.ok(
            fs.existsSync(fullPath) && fs.statSync(fullPath).isFile(),
            `Missing file referenced in manifest.json: ${relPath}`
        );
    }
});

test('required protected assets exist', () => {
    const requiredAssets = [
        'nico_downloader/dist/ffmpeg-core.wasm',
        'nico_downloader/LICENSE',
        'LICENSE',
    ];
    for (const relPath of requiredAssets) {
        const fullPath = resolveRepoPath(relPath);
        assert.ok(
            fs.existsSync(fullPath) && fs.statSync(fullPath).isFile(),
            `Missing required protected asset: ${relPath}`
        );
    }
});

test('no Git conflict markers remain in text files under nico_downloader/', () => {
    const textFiles = walkFiles(EXT_DIR, ['.js', '.json', '.html', '.css']);
    const conflictPattern = /^(?:<<<<<<< |=======$|>>>>>>> )/m;
    for (const filePath of textFiles) {
        const content = fs.readFileSync(filePath, 'utf8');
        const rel = path.relative(EXT_DIR, filePath);
        assert.equal(
            conflictPattern.test(content),
            false,
            `Git conflict marker detected in nico_downloader/${rel}`
        );
    }
});

test('NicoPocketPolicy.artworkAllowedHosts matches manifest.json host_permissions hosts', () => {
    const manifest = JSON.parse(
        fs.readFileSync(resolveRepoPath('nico_downloader/manifest.json'), 'utf8')
    );
    const manifestHosts = (manifest.host_permissions ?? [])
        .map(pattern => new URL(pattern.replace(/\/\*$/, '/')).hostname.toLowerCase())
        .sort();

    const { exported } = loadScript('nico_downloader/pocket/policy.js', {
        exportNames: ['NicoPocketPolicy'],
    });
    const policyHosts = [...(exported.NicoPocketPolicy.artworkAllowedHosts ?? [])].sort();

    assert.deepEqual(policyHosts, manifestHosts);
});

test('pocket/download-runner.js does not contain legacy documentWriteText or window.onload', () => {
    const scriptContent = fs.readFileSync(
        resolveRepoPath('nico_downloader/pocket/download-runner.js'),
        'utf8'
    );
    assert.equal(/\bdocumentWriteText\b/.test(scriptContent), false);
    assert.equal(/\bwindow\.onload\b/.test(scriptContent), false);
});
