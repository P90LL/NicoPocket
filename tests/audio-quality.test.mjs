import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compressionTarget, measureAdtsBitrate } from '../.build/extension/pocket/assets/audio-quality.js';
import { muxAacToM4a } from '../.build/extension/pocket/assets/media-client.js';

function frame(payload) {
  const length = payload + 7, bytes = new Uint8Array(length);
  bytes.set([0xff, 0xf1, 0x4c, 0x80 | (length >> 11), (length >> 3) & 255,
    ((length & 7) << 5) | 0x1f, 0xfc]);
  return bytes;
}
const input = aac => ({ aac, title: '合成音声', videoId: 'sm100', sourceUrl: 'https://www.nicovideo.jp/watch/sm100' });

test('ADTS実効ビットレートで上限の要否を判定し、壊れた音声を拒否する', () => {
  assert.equal(measureAdtsBitrate(frame(512)), 192000);
  assert.equal(compressionTarget('limit160', 192000), 160000);
  assert.equal(compressionTarget('limit128', 48000), undefined);
  assert.equal(compressionTarget('best', 192000), undefined);
  assert.throws(() => measureAdtsBitrate(frame(512).subarray(0, 20)));
});

test('圧縮失敗3回再試行後は元AACでM4Aを作り警告を返す', async () => {
  const originalWorker = globalThis.Worker, calls = [], workers = [];
  class FakeWorker {
    constructor() { workers.push(this); }
    postMessage(task) {
      calls.push(task.kind);
      queueMicrotask(() => this.onmessage({ data: task.kind === 'compress'
        ? { ok: false } : { ok: true, bytes: new Uint8Array([1, 2, 3]) } }));
    }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker;
  try {
    const aac = frame(512);
    const output = await muxAacToM4a({ ...input(aac), quality: 'limit128', compressionRetries: 3 });
    assert.equal(output.aac, aac);
    assert.equal(output.compressed, false);
    assert.equal(output.compressionAttempts, 4);
    assert.equal(output.warnings.length, 1);
    assert.deepEqual(calls, ['compress','compress','compress','compress','mux']);
    assert.ok(workers.every(worker => worker.terminated));
  } finally { globalThis.Worker = originalWorker; }
});

test('上限以下では圧縮Workerを起動せず元AACを保持する', async () => {
  const originalWorker = globalThis.Worker, calls = [];
  class FakeWorker {
    postMessage(task) { calls.push(task.kind); queueMicrotask(() => this.onmessage({
      data: { ok: true, bytes: new Uint8Array([1]) }
    })); }
    terminate() {}
  }
  globalThis.Worker = FakeWorker;
  try {
    const aac = frame(128);
    const output = await muxAacToM4a({ ...input(aac), quality: 'limit128' });
    assert.deepEqual(calls, ['mux']);
    assert.equal(output.aac, aac);
    assert.equal(output.compressionAttempts, 0);
  } finally { globalThis.Worker = originalWorker; }
});
