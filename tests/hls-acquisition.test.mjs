import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireHlsAssets, acquireLocalHlsInput } from '../.build/pocket/assets/hls-acquisition.js';
import { HlsPlaylistError } from '../.build/pocket/assets/hls-playlist.js';
import { createUpstreamCompatibleFetcher } from '../.build/pocket/assets/acquisition-fetch.js';

const origin = 'https://fixture.invalid';
const start = `${origin}/master.m3u8`;
const settings = (maxTransferBytes = 1024 * 1024) => ({ allowedOrigins: [origin], maxTransferBytes });
const media = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:3\n'
  + '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1\n'
  + '#EXT-X-MAP:URI="init.bin",BYTERANGE="2@0"\n'
  + '#EXTINF:3,\n#EXT-X-BYTERANGE:3@0\nwhole.bin\n'
  + '#EXTINF:3,\n#EXT-X-BYTERANGE:3\nwhole.bin\n#EXT-X-ENDLIST\n';

async function withFetch(implementation, work) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try { await work(); } finally { globalThis.fetch = original; }
}

test('フォーク元と同じCookie送信で取得し、URLを除いたHLS入力を返して消去する', async () => {
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2"\naudio.m3u8\n';
  const routes = new Map([
    [start, master], [`${origin}/audio.m3u8`, media],
    [`${origin}/key.bin`, new Uint8Array(16).fill(9)],
    [`${origin}/init.bin`, new Uint8Array([1, 2, 3])],
    [`${origin}/whole.bin`, new Uint8Array([10, 11, 12, 13, 14, 15])]
  ]);
  const requests = [];
  await withFetch(async (url, init) => {
    requests.push(url);
    assert.equal(init.credentials, 'include');
    assert.equal(init.redirect, 'error');
    return new Response(routes.get(url));
  }, async () => {
    const acquired = await acquireHlsAssets(start, new AbortController().signal, settings());
    assert.equal(acquired.assets.length, 4);
    assert.equal(requests.length, 5);
    assert.deepEqual([...acquired.assets[2].bytes], [10, 11, 12]);
    await acquired.dispose();
    assert(acquired.assets.every(asset => asset.bytes.every(byte => byte === 0)));
    const local = await acquireLocalHlsInput(start, new AbortController().signal, settings());
    assert.doesNotMatch(local.hls.playlist, /fixture|https|key\.bin|whole\.bin/u);
    assert.deepEqual([...local.hls.files.at(-1).bytes], [13, 14, 15]);
    local.dispose();
    assert(local.hls.files.every(file => file.bytes.every(byte => byte === 0)));
  });
});

test('外部参照と未対応暗号を拒否し、媒体片を取得しない', async () => {
  for (const playlist of [media.replace('whole.bin', 'https://elsewhere.invalid/a.bin'),
    media.replace('AES-128', 'SAMPLE-AES')]) {
    const requests = [];
    await withFetch(async url => { requests.push(url); return new Response(playlist); }, async () => {
      await assert.rejects(acquireHlsAssets(start, new AbortController().signal, settings()), HlsPlaylistError);
      assert.deepEqual(requests, [start]);
    });
  }
});

test('許可元以外とリダイレクトを通信境界で拒否する', async () => {
  const get = createUpstreamCompatibleFetcher([origin]);
  let requests = 0;
  await withFetch(async () => { requests++; return new Response('unused'); }, async () => {
    await assert.rejects(get('https://elsewhere.invalid/a.m3u8', new AbortController().signal));
    assert.equal(requests, 0);
  });
  await withFetch(async () => {
    requests++;
    const response = new Response(media);
    Object.defineProperty(response, 'redirected', { value: true });
    return response;
  }, async () => {
    await assert.rejects(get(start, new AbortController().signal), { message: '取得通信に失敗しました' });
    assert.equal(requests, 1);
  });
});

test('転送予算、鍵長、HTTP失敗を固定エラーで拒否する', async () => {
  for (const failure of ['budget', 'key', 'http']) {
    const options = settings(failure === 'budget' ? 5 : 1024 * 1024);
    await withFetch(async url => {
      if (failure === 'http') return new Response('signed private detail', { status: 403 });
      if (url === start) return new Response(media);
      if (url.endsWith('key.bin')) return new Response(new Uint8Array(failure === 'key' ? 15 : 16));
      return new Response(new Uint8Array([1]));
    }, async () => {
      await assert.rejects(acquireHlsAssets(start, new AbortController().signal, options), error =>
        error instanceof HlsPlaylistError && error.message === '音声配信リストを処理できません');
    });
  }
});

test('取消し済みなら通信せず、読み取り中の取消しも停止する', async () => {
  const before = new AbortController(); before.abort();
  let requests = 0;
  await withFetch(async () => { requests++; return new Response(media); }, async () => {
    await assert.rejects(acquireHlsAssets(start, before.signal, settings()), { name: 'AbortError' });
    assert.equal(requests, 0);
  });
  const during = new AbortController(); let cancelled = 0;
  await withFetch(async () => new Response(new ReadableStream({
    start() { queueMicrotask(() => during.abort()); }, cancel() { cancelled++; }
  })), async () => {
    await assert.rejects(acquireHlsAssets(start, during.signal, settings()), { name: 'AbortError' });
    assert.equal(cancelled, 1);
  });
});
