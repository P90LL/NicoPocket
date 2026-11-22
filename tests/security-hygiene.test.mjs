import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolveRepoPath } from './helpers/load-script.mjs';

const ROOT_DIR = resolveRepoPath();
const BINARY_EXTENSIONS = new Set([
    '.wasm',
    '.png',
    '.ico',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.crx',
    '.xpi',
    '.zip',
]);

function getTrackedFiles() {
    const out = execFileSync('git', ['ls-files', '-z'], {
        cwd: ROOT_DIR,
        encoding: 'utf8',
    });
    return out.split('\0').filter(Boolean);
}

function getTrackedTextFiles() {
    return getTrackedFiles().filter(relPath => {
        const ext = path.extname(relPath).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) return false;
        const fullPath = resolveRepoPath(relPath);
        return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
    });
}

test('no forbidden local/credential files are tracked by Git', () => {
    const tracked = getTrackedFiles();
    const forbiddenRules = [
        {
            name: '.env file (excluding .env.example / .env.template)',
            match: p =>
                /(?:^|\/)\.env(?:\.[^/]+)?$/.test(p) &&
                !/(?:^|\/)\.env\.(?:example|template)$/.test(p),
        },
        {
            name: '.DS_Store',
            match: p => /(?:^|\/)\.DS_Store$/.test(p),
        },
        {
            name: '.vscode/ directory file',
            match: p => /(?:^|\/)\.vscode\//.test(p),
        },
        {
            name: 'private key / certificate / secret file',
            match: p =>
                /\.(?:pem|key|p12|pfx|secret)$/i.test(p) ||
                /(?:^|\/)(?:[^/]*credentials[^/]*\.json|secrets\.[^/]+|id_rsa(?:\.[^/]+)?|id_ed25519(?:\.[^/]+)?)$/i.test(
                    p
                ),
        },
    ];

    for (const relPath of tracked) {
        for (const rule of forbiddenRules) {
            assert.equal(
                rule.match(relPath),
                false,
                `Forbidden tracked file detected (${rule.name}): ${relPath}`
            );
        }
    }
});

test('no private keys or API tokens are committed in tracked text files', () => {
    const patterns = [
        {
            name: 'Private Key Block',
            regex: new RegExp(
                '-----BEGIN ' + '(?:[A-Z0-9 ]+ )?PRIVATE KEY-----'
            ),
        },
        {
            name: 'GitHub Personal Access Token',
            regex: new RegExp(
                '\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\\b|\\bgithub_pat_[A-Za-z0-9_]{50,255}\\b'
            ),
        },
        {
            name: 'AWS Access Key ID',
            regex: new RegExp('\\bAKIA' + '[0-9A-Z]{16}\\b'),
        },
        {
            name: 'Slack Token',
            regex: new RegExp('\\bxox[baprs]-' + '[0-9A-Za-z-]{10,}\\b'),
        },
        {
            name: 'Google API Key',
            regex: new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'),
        },
    ];

    for (const relPath of getTrackedTextFiles()) {
        const content = fs.readFileSync(resolveRepoPath(relPath), 'utf8');
        for (const { name, regex } of patterns) {
            assert.equal(
                regex.test(content),
                false,
                `Potential secret (${name}) found in tracked file: ${relPath}`
            );
        }
    }
});

test('no personal local home paths or signed HLS delivery token URLs are hardcoded in tracked text files', () => {
    const patterns = [
        {
            name: 'macOS local user path (/Users/<name>/)',
            regex: new RegExp('(?<![A-Za-z0-9_.*])' + '/Users/(?!<|shared/)[A-Za-z0-9._-]+/', 'i'),
        },
        {
            name: 'Linux local user path (/home/<name>/)',
            regex: new RegExp('(?<![A-Za-z0-9_.*])' + '/home/(?!<)[A-Za-z0-9._-]+/', 'i'),
        },
        {
            name: 'Windows local user path (C:\\Users\\<name>\\)',
            regex: new RegExp('\\b[A-Z]:\\\\' + 'Users\\\\(?!<)[A-Za-z0-9._-]+\\\\', 'i'),
        },
        {
            name: 'Signed domand HLS delivery URL',
            regex: new RegExp(
                'https://delivery\\.domand\\.nicovideo\\.jp/hlsbid/' + '[A-Za-z0-9_-]{8,}'
            ),
        },
    ];

    for (const relPath of getTrackedTextFiles()) {
        const content = fs.readFileSync(resolveRepoPath(relPath), 'utf8');
        for (const { name, regex } of patterns) {
            assert.equal(
                regex.test(content),
                false,
                `Forbidden sensitive path/URL (${name}) found in tracked file: ${relPath}`
            );
        }
    }
});

test('.gitignore protects nico_downloader/dist/ assets while ignoring .vscode/settings.json and .env', () => {
    const mustNotIgnore = [
        'nico_downloader/dist/utils.js',
        'nico_downloader/dist/ffmpeg-core.wasm',
    ];
    for (const relPath of mustNotIgnore) {
        for (const args of [['check-ignore', relPath], ['check-ignore', '--no-index', relPath]]) {
            const res = spawnSync('git', args, {
                cwd: ROOT_DIR,
                encoding: 'utf8',
            });
            assert.equal(
                res.status,
                1,
                `Expected ${relPath} NOT to be ignored by .gitignore (${args.join(' ')}), but exited with ${res.status}: ${res.stdout}`
            );
        }
    }

    const mustIgnore = ['.vscode/settings.json', '.env'];
    for (const relPath of mustIgnore) {
        const res = spawnSync('git', ['check-ignore', relPath], {
            cwd: ROOT_DIR,
            encoding: 'utf8',
        });
        assert.equal(
            res.status,
            0,
            `Expected ${relPath} to be ignored by .gitignore, but git check-ignore exited with ${res.status}`
        );
    }
});
