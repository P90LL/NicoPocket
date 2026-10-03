import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build as bundle } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const build = resolve(root, '.build');
rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });
const compiler = resolve(root, 'node_modules/typescript/bin/tsc');
execFileSync(process.execPath, [compiler, '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });
await bundle({ entryPoints: [resolve(root, 'src/pocket/content.ts')],
  outfile: resolve(build, 'pocket/assets/content.js'), bundle: true,
  platform: 'browser', format: 'iife', target: 'chrome116', sourcemap: false });
const extension = resolve(build, 'extension');
cpSync(resolve(root, 'nico_downloader'), extension, { recursive: true, dereference: true,
  filter: path => !path.endsWith('.DS_Store') });
const pocket = resolve(extension, 'pocket');
cpSync(resolve(build, 'pocket'), pocket, { recursive: true });
for (const name of ['window.html', 'window.css', 'content.css']) {
  cpSync(resolve(root, 'src/pocket', name), resolve(pocket, name));
}
mkdirSync(resolve(pocket, 'assets'), { recursive: true });
cpSync(resolve(root, 'src/pocket/logo.svg'), resolve(pocket, 'assets/logo.svg'));
cpSync(resolve(root, 'src/pocket/media-worker.js'), resolve(pocket, 'assets/media-worker.js'));
// Export adapter for a module Worker. Original core files remain byte-for-byte intact.
writeFileSync(resolve(pocket, 'assets/legacy-core.js'),
  readFileSync(resolve(root, 'nico_downloader/dist/ffmpeg-core2.js'), 'utf8') + '\nexport default createFFmpegCore;\n');
const manifest = JSON.parse(readFileSync(resolve(extension, 'manifest.json'), 'utf8'));
manifest.name = 'NicoPocket';
manifest.description = 'にこぽけ：nico downloaderをベースに音声保存とジャケット編集を開発しています。';
manifest.action = { default_title: 'NicoPocketを開く' };
manifest.background = { service_worker: 'pocket/assets/background.js', type: 'module' };
manifest.minimum_chrome_version = '123';
manifest.content_security_policy = { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" };
manifest.permissions = [...new Set([...manifest.permissions, 'activeTab', 'downloads'])];
manifest.optional_permissions = [...new Set([...(manifest.optional_permissions ?? []), 'downloads.open'])];
const watch = manifest.content_scripts.find(row => row.matches.includes('https://www.nicovideo.jp/*'));
watch.js.push('pocket/assets/content.js');
watch.css = [...(watch.css ?? []), 'pocket/content.css'];
writeFileSync(resolve(extension, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const files = [manifest.background.service_worker, ...Object.values(manifest.icons), manifest.options_page,
  ...manifest.content_scripts.flatMap(row => [...row.js, ...(row.css ?? [])]),
  ...manifest.web_accessible_resources.flatMap(row => row.resources)];
if (files.some(name => !existsSync(resolve(extension, name)))) throw new Error('Build contains missing manifest resources');
console.log('Built .build/extension; upstream runtime files preserved.');
