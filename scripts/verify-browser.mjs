import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const root = fileURLToPath(new URL('..', import.meta.url));
const executable = process.env.NICOPOCKET_CHROME;
if (!executable) throw new Error('Set NICOPOCKET_CHROME to a Chrome for Testing executable.');
const scratch = mkdtempSync(resolve(tmpdir(), 'nicopocket-verify-'));
const extension = resolve(scratch, 'extension');
cpSync(resolve(root, '.build/extension'), extension, { recursive: true });
// Test-only access to the same functions used by the toolbar. Never added to product sources.
const workerPath = resolve(extension, 'pocket/assets/background.js');
writeFileSync(workerPath, readFileSync(workerPath, 'utf8') + '\nglobalThis.__npVerify = { openWindow, addVideo };\n');
const manifestPath = resolve(extension, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.content_scripts[0].matches.push('http://127.0.0.1/*');
writeFileSync(manifestPath, JSON.stringify(manifest));
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>ローカル合成ページ</title><h1>合成動画</h1><div><button>共有</button></div>');
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const chrome = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
  `--user-data-dir=${resolve(scratch, 'profile')}`, `--load-extension=${extension}`, `--disable-extensions-except=${extension}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] });
const connections = [];
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));
async function until(task, message) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const value = await task(); if (value) return value; await delay(100);
  }
  throw new Error(message);
}
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  connections.push(socket);
  let sequence = 0;
  const pending = new Map(), exceptions = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params);
    if (!message.id) return;
    const waiter = pending.get(message.id); if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  };
  const call = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: done, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await call('Runtime.enable');
  return { call, evaluate, exceptions };
}
async function verifyMedia(ui) {
  const ffmpeg = process.env.NICOPOCKET_FFMPEG || 'ffmpeg';
  const ffprobe = process.env.NICOPOCKET_FFPROBE || 'ffprobe';
  const audio = resolve(scratch, 'synthetic.aac');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=440:sample_rate=48000:duration=0.75', '-c:a', 'aac', '-b:a', '192k', '-f', 'adts', audio]);
  const input = readFileSync(audio).toString('base64');
  const prepare = `globalThis.mux = (await import('./assets/media-client.js')).muxAacToM4a;
    globalThis.sample = {aac: Uint8Array.from(atob('${input}'), char=>char.charCodeAt(0)),
      title:'合成音声 🎵 日本語',videoId:'sm100',sourceUrl:'https://www.nicovideo.jp/watch/sm100'};
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
    canvas.getContext('2d').fillRect(0,0,512,512);
    globalThis.cover=new Uint8Array(await (await new Promise(done=>canvas.toBlob(done,'image/jpeg'))).arrayBuffer());`;
  await ui.evaluate(`(async()=>{${prepare} return true})()`);
  const convert = async expression => {
    const result = await ui.evaluate(`(async()=>{const output=await ${expression};
      return {bytes:btoa(String.fromCharCode(...output.m4a)),warnings:output.warnings,
        compressed:output.compressed,sourceBitrate:output.sourceBitrate,
        outputBitrate:output.outputBitrate,compressionAttempts:output.compressionAttempts}})()`);
    return { ...result, bytes: Buffer.from(result.bytes, 'base64') };
  };
  const covered = await convert('mux({...sample,jpeg:cover})');
  assert.deepEqual(covered.warnings, []);
  const file = resolve(scratch, 'covered.m4a'); writeFileSync(file, covered.bytes);
  const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {encoding:'utf8'}));
  assert.equal(probe.format.tags.title, '合成音声 🎵 日本語');
  assert.equal(probe.format.tags.niconico_id, 'sm100');
  assert.equal(probe.format.tags.source_url, 'https://www.nicovideo.jp/watch/sm100');
  assert.ok(probe.streams.some(row=>row.codec_name==='aac'));
  assert.ok(probe.streams.some(row=>row.codec_name==='mjpeg' && row.disposition.attached_pic===1));
  const packets = path => JSON.parse(execFileSync(ffprobe, ['-v','error','-select_streams','a:0',
    '-show_packets','-show_data_hash','sha256','-show_entries','packet=data_hash','-of','json',path],{encoding:'utf8'})).packets;
  // ADTS packets include transport headers. Compare with a native stream-copy M4A reference.
  const reference = resolve(scratch, 'reference.m4a');
  execFileSync(ffmpeg, ['-v','error','-i',audio,'-c:a','copy',reference]);
  assert.equal(JSON.stringify(packets(file)) === JSON.stringify(packets(reference)), true, 'AAC payload changed');
  execFileSync(ffmpeg, ['-v','error','-i',file,'-map','0:a:0','-f','null','-']);
  const fallback = await convert('mux({...sample,jpeg:new Uint8Array([1,2,3])})');
  assert.equal(fallback.warnings.length, 1);
  writeFileSync(file, fallback.bytes);
  const fallbackProbe = JSON.parse(execFileSync(ffprobe, ['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
  assert.equal(fallbackProbe.format.tags.niconico_id, 'sm100');
  assert.ok(fallbackProbe.streams.every(row=>row.codec_type==='audio'));
  assert.equal(await ui.evaluate("(async()=>{const controller=new AbortController();const promise=mux(sample,{signal:controller.signal});controller.abort();try{await promise;return false}catch(error){return error.name==='AbortError'}})()"), true);
  assert.equal(await ui.evaluate("(async()=>{try{await mux({...sample,aac:new Uint8Array([1,2,3])});return false}catch{return true}})()"), true);
  const high = resolve(scratch, 'high.aac'), low = resolve(scratch, 'low.aac');
  execFileSync(ffmpeg, ['-v','error','-f','lavfi','-i',
    'anoisesrc=duration=3:color=white:sample_rate=48000', '-c:a','aac','-b:a','192k','-f','adts',high]);
  execFileSync(ffmpeg, ['-v','error','-f','lavfi','-i',
    'sine=frequency=440:sample_rate=48000:duration=3', '-c:a','aac','-b:a','64k','-f','adts',low]);
  for (const [key, path] of [['high',high],['low',low]]) {
    const encoded = readFileSync(path).toString('base64');
    await ui.evaluate(`globalThis.${key}=Uint8Array.from(atob('${encoded}'),char=>char.charCodeAt(0));true`);
  }
  const untouched = await convert("mux({...sample,aac:low,quality:'limit128'})");
  assert.equal(untouched.compressed, false); assert.equal(untouched.compressionAttempts, 0);
  writeFileSync(file, untouched.bytes);
  const lowReference = resolve(scratch, 'low-reference.m4a');
  execFileSync(ffmpeg, ['-v','error','-i',low,'-c:a','copy',lowReference]);
  assert.equal(JSON.stringify(packets(file)) === JSON.stringify(packets(lowReference)), true, 'Below-cap AAC changed');
  for (const [quality, cap] of [['limit160',160000],['limit128',128000]]) {
    const limited = await convert(`mux({...sample,aac:high,quality:'${quality}',compressionRetries:3})`);
    assert.ok(limited.sourceBitrate > cap, 'Fixture is not above cap');
    assert.equal(limited.compressed, true, `${quality}: compression did not succeed`);
    assert.ok(limited.outputBitrate <= cap, `${quality}: output exceeds cap`);
    assert.equal(limited.compressionAttempts, 1);
    assert.deepEqual(limited.warnings, []);
    writeFileSync(file, limited.bytes);
    execFileSync(ffmpeg, ['-v','error','-i',file,'-map','0:a:0','-f','null','-']);
  }
  const hlsDir = resolve(scratch, 'hls'); mkdirSync(hlsDir);
  const playlistPath = resolve(hlsDir, 'source.m3u8');
  execFileSync(ffmpeg, ['-v','error','-f','lavfi','-i',
    'anoisesrc=duration=3:color=white:sample_rate=48000',
    '-c:a','aac','-b:a','192k','-f','hls','-hls_segment_type','fmp4',
    '-hls_time','1','-hls_list_size','0','-hls_segment_filename',
    resolve(hlsDir,'chunk-%03d.m4s'),playlistPath]);
  async function installHlsInput(key, directory, path) {
    let localPlaylist = readFileSync(path,'utf8');
    const names = [...new Set([...localPlaylist.matchAll(/URI="([^"]+)"|^([^#\r\n][^\r\n]*)$/gm)]
      .map(match=>match[1]||match[2]).filter(Boolean))];
    const files = names.map((name,index)=>{
      assert.match(name,/^[a-zA-Z0-9._-]+$/);
      const bytes=readFileSync(resolve(directory,name));
      const asset=`asset-${index}.bin`;
      localPlaylist=localPlaylist.replaceAll(name,asset);
      return {name:asset,bytes:bytes.toString('base64')};
    });
    await ui.evaluate(`globalThis[${JSON.stringify(key)}]={playlist:${JSON.stringify(localPlaylist)},
      files:${JSON.stringify(files)}.map(file=>({name:file.name,
      bytes:Uint8Array.from(atob(file.bytes),char=>char.charCodeAt(0))}))};true`);
  }
  await installHlsInput('hlsInput',hlsDir,playlistPath);
  const fromHls = await convert('mux({...sample,aac:new Uint8Array(),hls:hlsInput})');
  assert.equal(fromHls.compressed,false);
  writeFileSync(file,fromHls.bytes);
  execFileSync(ffmpeg,['-v','error','-i',file,'-map','0:a:0','-f','null','-']);
  const hlsReference=resolve(scratch,'hls-reference.m4a');
  execFileSync(ffmpeg,['-v','error','-i',playlistPath,'-map','0:a:0','-c:a','copy',hlsReference]);
  assert.deepEqual(packets(file).map(row=>row.data_hash),
    packets(hlsReference).map(row=>row.data_hash), 'HLS AAC payload changed');
  assert.equal(await ui.evaluate(`(async()=>{try{await mux({...sample,aac:new Uint8Array(),
    hls:{...hlsInput,files:hlsInput.files.slice(1)}});return false}catch{return true}})()`),true);
  assert.equal(await ui.evaluate(`(async()=>{try{const files=hlsInput.files.map((file,index)=>
    index===hlsInput.files.length-1?{name:file.name,bytes:new Uint8Array([1,2,3])}:file);
    await mux({...sample,aac:new Uint8Array(),hls:{...hlsInput,files}});return false}catch{return true}})()`),true);
  const encryptedDir=resolve(scratch,'encrypted');mkdirSync(encryptedDir);
  const keyPath=resolve(encryptedDir,'key.bin');
  writeFileSync(keyPath,randomBytes(16));
  const keyInfo=resolve(encryptedDir,'key.info');
  writeFileSync(keyInfo,`key.bin\n${keyPath}\n`);
  const encryptedPlaylist=resolve(encryptedDir,'source.m3u8');
  execFileSync(ffmpeg,['-v','error','-f','lavfi','-i',
    'sine=frequency=440:sample_rate=48000:duration=3','-c:a','aac','-b:a','160k',
    '-f','hls','-hls_time','1','-hls_list_size','0','-hls_key_info_file',keyInfo,
    '-hls_segment_filename',resolve(encryptedDir,'chunk-%03d.ts'),encryptedPlaylist]);
  await installHlsInput('encryptedHls',encryptedDir,encryptedPlaylist);
  const decrypted=await convert('mux({...sample,aac:new Uint8Array(),hls:encryptedHls})');
  writeFileSync(file,decrypted.bytes);
  execFileSync(ffmpeg,['-v','error','-i',file,'-map','0:a:0','-f','null','-']);
  const encryptedReference=resolve(scratch,'encrypted-reference.m4a');
  execFileSync(ffmpeg,['-v','error','-allowed_extensions','ALL','-i',encryptedPlaylist,'-map','0:a:0','-c:a','copy',encryptedReference]);
  assert.deepEqual(packets(file).map(row=>row.data_hash),
    packets(encryptedReference).map(row=>row.data_hash),'Encrypted HLS AAC payload changed');
  const report = {passed:true,scope:'bundled upstream Wasm; synthetic AAC/JPEG/HLS only',
    checks:['M4A decode','AAC packet hashes unchanged','Japanese title and two custom tags','JPEG attached picture',
      'image failure falls back to audio','abort terminates Worker','invalid audio rejected',
      'under-cap audio copied','160 kbps upper bound','128 kbps upper bound',
      'local HLS AAC extraction','missing HLS asset rejected','corrupt HLS asset rejected','encrypted HLS AAC extraction'],
    bitrateConversion:'synthetic AAC verified',downloadRegistration:'not connected',realSiteAcquisition:'unverified'};
  writeFileSync(resolve(root,'.build/media-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
try {
  const endpoint = await new Promise((done, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 15000);
    chrome.stderr.on('data', bytes => {
      text += bytes;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(text);
      if (match) { clearTimeout(timer); done(match[1]); }
    });
    chrome.once('error', error => { clearTimeout(timer); reject(error); });
    chrome.once('exit', () => { clearTimeout(timer); reject(new Error('Chrome exited during startup')); });
  });
  const origin = endpoint.replace('ws:', 'http:').split('/devtools/')[0];
  const list = async () => (await fetch(`${origin}/json`)).json();
  const target = await until(async () => (await list()).find(row => row.type === 'service_worker'
    && row.url.endsWith('/pocket/assets/background.js')), 'Extension worker missing');
  const worker = await connect(target);
  await until(() => worker.evaluate('typeof globalThis.__npVerify?.openWindow === "function"'), 'Worker initialization incomplete');
  const id = new URL(target.url).hostname;
  const windows = await worker.evaluate('Promise.all([__npVerify.openWindow(),__npVerify.openWindow()])');
  assert.equal(windows[0], windows[1]);
  const popup = await until(async () => (await list()).find(row => row.url === `chrome-extension://${id}/pocket/window.html`), 'Window missing');
  const ui = await connect(popup);
  await until(() => ui.evaluate("document.querySelector('#settings-status').textContent.includes('自動保存')"), 'Window did not initialize');
  if (process.argv.includes('--media')) {
    await verifyMedia(ui);
  } else {
    const added = await worker.evaluate("Promise.all([__npVerify.addVideo('https://www.nicovideo.jp/watch/sm100','合成動画 A'),__npVerify.addVideo('https://www.nicovideo.jp/watch/sm200','合成動画 B')])");
    assert.ok(added.every(row => row.added));
    await until(() => ui.evaluate("document.querySelectorAll('#drafts button').length===2"), 'Shared candidates missing');
    await ui.evaluate("document.querySelector('#draft-title').value='編集済み / タイトル';document.querySelector('#draft-title').dispatchEvent(new Event('change',{bubbles:true}))");
    await until(() => ui.evaluate("chrome.runtime.sendMessage({kind:'np:snapshot'}).then(row=>row.drafts[0].title==='編集済み / タイトル')"), 'Title edit not stored');
    const duplicate = await worker.evaluate("__npVerify.addVideo('https://www.nicovideo.jp/watch/sm100','上書き禁止')");
    assert.equal(duplicate.added, false);
    const preserved = await ui.evaluate("chrome.runtime.sendMessage({kind:'np:snapshot'})");
    assert.equal(preserved.drafts[0].title, '編集済み / タイトル');
    assert.equal(preserved.drafts.length, 2);
    const invalid = await ui.evaluate("chrome.runtime.sendMessage({kind:'np:update-settings',changes:{concurrency:9}})");
    assert.equal(invalid.ok, false);
    await ui.evaluate("document.querySelector('[data-view=settings]').click(); const field=document.querySelector('[name=defaultTheme]');field.value='dark';field.dispatchEvent(new Event('change',{bubbles:true}))");
    await until(() => ui.evaluate("document.documentElement.dataset.theme==='dark'"), 'Settings not applied');
    await ui.call('Page.reload');
    await until(() => ui.evaluate("document.documentElement.dataset.theme==='dark' && document.querySelectorAll('#drafts button').length===2"), 'Reload restoration failed');
    await ui.evaluate("document.querySelector('#theme-toggle').click()");
    assert.equal((await ui.evaluate("chrome.runtime.sendMessage({kind:'np:snapshot'})")).settings.defaultTheme, 'dark');
    await ui.evaluate("document.querySelector('[data-view=thumbnail]').click(); const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');ctx.fillStyle='#1769e0';ctx.fillRect(0,0,640,360);canvas.toBlob(blob=>{const transfer=new DataTransfer();transfer.items.add(new File([blob],'synthetic.png',{type:'image/png'}));const field=document.querySelector('#thumbnail-file');field.files=transfer.files;field.dispatchEvent(new Event('change'))},'image/png')");
    await until(() => ui.evaluate("!document.querySelector('#thumbnail-preview').hidden"), 'JPEG preview missing');
    const preview = await ui.evaluate("(()=>{const image=document.querySelector('#thumbnail-preview');return {width:image.naturalWidth,height:image.naturalHeight,status:document.querySelector('#thumbnail-status').textContent}})()");
    assert.equal(preview.width, 512); assert.equal(preview.height, 512);
    await ui.evaluate("document.querySelector('#crop-box').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");
    await until(() => ui.evaluate("!document.querySelector('#thumbnail-preview').hidden && document.querySelector('#thumbnail-coordinates').textContent.includes('x 141')"), 'Manual crop failed');
    await ui.evaluate("document.querySelector('[data-view=basic]').click()");
    await ui.call('Emulation.setDeviceMetricsOverride', { width: 980, height: 800, deviceScaleFactor: 1, mobile: false });
    const screenshot = await ui.call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(root, '.build/window.png'), Buffer.from(screenshot.data, 'base64'));
    const fixture = await (await fetch(`${origin}/json/new?http://127.0.0.1:${server.address().port}/watch/sm100`, { method: 'PUT' })).json();
    const page = await connect(fixture);
    await delay(2500);
    assert.equal(await page.evaluate("document.querySelector('#nicopocket-entry')===null"), true);
    await worker.evaluate(`chrome.windows.remove(${windows[0]})`);
    await until(() => worker.evaluate("chrome.storage.session.get('np:drafts').then(row=>!row['np:drafts'])"), 'Closed window did not clear candidates');
    const reopened = await worker.evaluate('__npVerify.openWindow()'); assert.notEqual(reopened, windows[0]);
    const clean = await worker.evaluate("chrome.storage.session.get('np:drafts')"); assert.equal(clean['np:drafts'], undefined);
    assert.equal((await worker.evaluate("chrome.storage.local.get('np:settings')"))['np:settings'].defaultTheme, 'dark');
    assert.equal(worker.exceptions.length, 0); assert.equal(ui.exceptions.length, 0); assert.equal(page.exceptions.length, 0);
    const report = { passed: true, scope: 'isolated Chrome for Testing; synthetic input only',
      checks: ['single window', 'shared candidates', 'duplicate preserves edits', 'invalid settings rejected',
        'settings autosave', 'reload restoration', 'temporary theme', 'JPEG preview', 'keyboard crop',
        'non-watch page exclusion', 'window-close cleanup', 'persistent settings'],
      exceptions: 0, realSiteAcquisition: 'unverified', upstreamSave: 'unverified', m4aSave: 'not connected' };
    writeFileSync(resolve(root, '.build/browser-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  }
} finally {
  for (const socket of connections) socket.close();
  chrome.kill('SIGTERM');
  if (chrome.exitCode === null && chrome.signalCode === null) await Promise.race([once(chrome, 'exit'), delay(3000)]);
  if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGKILL'); await once(chrome, 'exit'); }
  await new Promise(done => server.close(done));
  rmSync(scratch, { recursive: true, force: true });
}
