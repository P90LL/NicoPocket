import assert from "node:assert/strict";
import test from "node:test";
import { acquireWatchAudio, acquireWatchJobAudio } from "../.build/pocket/assets/watch-audio-client.js";

const videoId = "sm1";
const sourceTab = { tabId: 10, documentId: "document-1", epoch: "epoch-1" };
function fixture(reply) {
  const requests = [], connections = [];
  globalThis.chrome = { runtime: { async sendMessage(message) { requests.push(message); return typeof reply === 'function' ? reply() : reply; } },
    tabs: { connect(...args) { connections.push(args); throw new Error("SYNTHETIC_CONNECT_FAILURE"); } } };
  return { requests, connections };
}
test("確認済みの同じ動画・文書だけへ接続し、取得URLを要求本文に含めない", async () => {
  const f = fixture({ ok: true, videoId: "sm1", sourceTab });
  await assert.rejects(acquireWatchAudio(videoId, new AbortController().signal, 1000000));
  assert.deepEqual(f.requests, [{ kind: "np:read-draft-source", videoId: "sm1" }]);
  assert.deepEqual(f.connections, [[10, { documentId: "document-1", frameId: 0, name: "nicopocket-hls:sm1:epoch-1:1000000" }]]);
});
test("登録ジョブの識別子からだけ取得元を読み直す", async () => {
  const f = fixture({ ok: true, videoId: "sm1", sourceTab });
  await assert.rejects(acquireWatchJobAudio({ id: 'job-1', videoId }, new AbortController().signal, 1000000));
  assert.deepEqual(f.requests, [{ kind: 'np:read-job-source', id: 'job-1' }]);
  assert.equal(f.connections.length, 1);
  const invalid = fixture({ ok: true, videoId: "sm1", sourceTab });
  await assert.rejects(acquireWatchJobAudio({ id: '../job', videoId }, new AbortController().signal, 1000000));
  assert.equal(invalid.requests.length, 0);
});
test("別動画・拒否応答・不正な文書識別子ではPortを作らない", async () => {
  for (const reply of [undefined, { ok: false }, { ok: true, videoId: "sm2", sourceTab },
    { ok: true, videoId: "sm1", sourceTab: { ...sourceTab, documentId: "" } }]) {
    const f = fixture(reply);
    await assert.rejects(acquireWatchAudio(videoId, new AbortController().signal, 1000000));
    assert.equal(f.connections.length, 0);
  }
});
test("事前取消しでは要求せず、確認待ちの取消しでもPortを作らない", async () => {
  const c = new AbortController(); c.abort(new DOMException("Synthetic cancel", "AbortError"));
  const f = fixture({ ok: true, videoId: "sm1", sourceTab });
  await assert.rejects(acquireWatchAudio(videoId, c.signal, 1000000), error => error === c.signal.reason);
  assert.equal(f.requests.length, 0);
  const d = new AbortController(), g = fixture(() => { d.abort(c.signal.reason); return { ok: true, videoId: "sm1", sourceTab }; });
  await assert.rejects(acquireWatchAudio(videoId, d.signal, 1000000), error => error === d.signal.reason);
  assert.equal(g.connections.length, 0);
});
test("不正な資産上限と接続エラーの任意本文を画面へ持ち出さない", async () => {
  for (const max of [0, -1, 1.5, Infinity]) {
    const f = fixture({ ok: true, videoId: "sm1", sourceTab });
    await assert.rejects(acquireWatchAudio(videoId, new AbortController().signal, max)); assert.equal(f.requests.length, 0);
  }
  fixture({ ok: true, videoId: "sm1", sourceTab });
  await assert.rejects(acquireWatchAudio(videoId, new AbortController().signal, 1000000),
    error => !error.message.includes("SYNTHETIC_CONNECT_FAILURE"));
});
