import assert from "node:assert/strict";
import test from "node:test";
import { JobActionController } from "../.build/extension/pocket/assets/job-action-controller.js";
import { JobRunner } from "../.build/extension/pocket/assets/job-runner.js";
import { appendJob, applyJobEvent } from "../.build/extension/pocket/assets/jobs.js";

function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(done => setTimeout(done, 1)); }
  throw new Error("Condition did not arrive");
}
function fixture() {
  let jobs = appendJob([], { videoId: "sm1", title: "Fixture", sourceUrl: "https://www.nicovideo.jp/watch/sm1",
    quality: "best", saveAac: false, saveJpeg: false }, "job-1", 0);
  const calls = []; let errors = 0;
  const state = { async get(id) { return structuredClone(jobs.find(job => job.id === id)); },
    async apply(event) { jobs = applyJobEvent(jobs, event); return state.get(event.id); } };
  const controller = new JobActionController(async message => {
    calls.push(message);
    await state.apply({ type: message.action, id: message.id, at: Date.now() }); return { ok: true };
  }, () => { errors++; });
  const ports = { state, async acquire() { return { aac: new Uint8Array([1]), async dispose() {} }; },
    async process() { return { m4a: new Uint8Array([1]), warning: false, warnings: [] }; }, async save() {} };
  const runner = new JobRunner(ports, { concurrency: 10, mediaSlots: 1 });
  return { runner, controller, state, ports, calls, errors: () => errors, job: () => jobs[0] };
}

test("実行元が残る間は復旧対象にせず、処理終了後に再描画通知を送る", async () => {
  const f = fixture(), saving = deferred(), observed = [];
  f.ports.save = async () => saving.promise;
  const controller = new JobActionController(async () => ({ ok: true }), () => {},
    () => observed.push(controller.isRunning('job-1')));
  controller.connect(f.runner); controller.start('job-1');
  await until(() => f.job().stage === 'save');
  assert.equal(controller.isRunning('job-1'), true); assert.deepEqual(observed, []);
  saving.resolve(); await until(() => observed.length === 1);
  assert.deepEqual(observed, [false]); assert.equal(f.job().status, 'complete');
});

test("実行中の重複キャンセルは同じ後片付け完了を待ち、状態を先に変えない", async () => {
  const f = fixture(), stopped = deferred(); let signal, disposed = false, done = 0;
  f.ports.process = async (_job, _source, current) => { signal = current; await stopped.promise; current.throwIfAborted(); };
  f.ports.acquire = async () => ({ aac: new Uint8Array([1]), async dispose() { disposed = true; } });
  f.controller.connect(f.runner); f.controller.start("job-1"); await until(() => signal);
  const first = f.controller.perform("job-1", "cancel").then(() => { done++; });
  const second = f.controller.perform("job-1", "cancel").then(() => { done++; });
  await Promise.resolve(); assert.equal(signal.aborted, true);
  assert.equal(f.job().status, "processing"); assert.equal(done, 0); assert.equal(f.calls.length, 0);
  stopped.resolve(); await Promise.all([first, second]);
  assert.equal(f.job().status, "cancelled"); assert.equal(disposed, true); assert.equal(done, 2);
});

test("所有する処理の停止と入力解放の後だけ削除要求を送る", async () => {
  const f = fixture(), stopped = deferred(); let active = false, disposed = false;
  f.ports.acquire = async () => ({ aac: new Uint8Array([1]), async dispose() { disposed = true; } });
  f.ports.process = async (_job, _source, signal) => { active = true; await stopped.promise; signal.throwIfAborted(); };
  f.controller.connect(f.runner); f.controller.start("job-1"); await until(() => active);
  const removed = f.controller.perform("job-1", "remove"); await Promise.resolve();
  assert.equal(f.calls.length, 0); assert.ok(f.job());
  stopped.resolve(); await removed;
  assert.equal(disposed, true); assert.equal(f.calls[0].action, "remove"); assert.equal(f.job(), undefined);
});

test("再試行状態の保存後に同じエンジンへ再投入する", async () => {
  const f = fixture(); await f.state.apply({ type: "cancel", id: "job-1", at: 1 });
  let acquired = false;
  f.ports.acquire = async job => { assert.equal(job.status, "processing"); acquired = true;
    return { aac: new Uint8Array([1]), async dispose() {} }; };
  f.controller.connect(f.runner); await f.controller.perform("job-1", "retry");
  await until(() => f.job().status === "complete");
  assert.equal(acquired, true); assert.equal(f.calls[0].action, "retry"); assert.equal(f.job().attempts, 1);
});

test("開始入力が未接続の一覧は既存の状態操作を維持する", async () => {
  const f = fixture(); await f.controller.perform("job-1", "cancel");
  await f.controller.perform("job-1", "retry");
  assert.equal(f.job().status, "waiting"); assert.equal(f.job().attempts, 0);
  assert.deepEqual(f.calls.map(row => row.action), ["cancel", "retry"]);
  assert.throws(() => f.controller.start("job-1"));
});

test("状態操作の失敗・処理終了待ちの失敗は任意の本文を画面へ返さない", async () => {
  const c = new JobActionController(async () => { throw new Error("PRIVATE_SOURCE_TOKEN"); }, () => {});
  await assert.rejects(c.perform("job-1", "cancel"), error => !error.message.includes("PRIVATE_SOURCE_TOKEN"));
  const d = new JobActionController(async () => ({ ok: true }), () => {});
  d.connect({ async cancelAndWait() { throw new Error("PRIVATE_SOURCE_TOKEN"); } });
  await assert.rejects(d.perform("job-1", "remove"), error => !error.message.includes("PRIVATE_SOURCE_TOKEN"));
});

test("終了要求では処理停止を待ち、新規開始と再試行を拒否する", async () => {
  const f = fixture(), stopped = deferred(); let signal, ended = false;
  f.ports.process = async (_job, _source, current) => { signal = current; await stopped.promise; current.throwIfAborted(); };
  f.controller.connect(f.runner); f.controller.start("job-1"); await until(() => signal);
  const closing = f.controller.stop().then(() => { ended = true; });
  assert.equal(signal.aborted, true); assert.equal(ended, false);
  assert.throws(() => f.controller.start("job-1")); await assert.rejects(f.controller.perform("job-1", "retry"));
  stopped.resolve(); await closing; assert.equal(f.job().status, "cancelled");
});

test("接続前に復元した同時実行設定を接続時と以後の変更で反映する", () => {
  const f = fixture(), values = [];
  const native = f.runner.setConcurrency.bind(f.runner);
  f.runner.setConcurrency = value => { values.push(value); native(value); };
  f.controller.setConcurrency(30); assert.deepEqual(values, []);
  f.controller.connect(f.runner); assert.deepEqual(values, [30]);
  f.controller.setConcurrency(20); f.controller.setConcurrency(20);
  assert.deepEqual(values, [30, 20]);
  assert.throws(() => f.controller.setConcurrency(9));
  assert.throws(() => f.controller.setConcurrency(NaN));
  assert.deepEqual(values, [30, 20]);
});

test("設定反映の失敗は固定本文に置換し、同じ値の再反映を可能にする", () => {
  const controller = new JobActionController(async () => ({ ok: true }), () => {});
  let reject = true; const values = [];
  controller.connect({ setConcurrency(value) { if (reject) throw new Error("PRIVATE_SOURCE_TOKEN"); values.push(value); } });
  assert.throws(() => controller.setConcurrency(20), error => !error.message.includes("PRIVATE_SOURCE_TOKEN"));
  reject = false; controller.setConcurrency(20); assert.deepEqual(values, [20]);
});
