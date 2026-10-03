import assert from "node:assert/strict";
import test from "node:test";
import { JobScheduler } from "../.build/extension/pocket/assets/job-scheduler.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise((done) => setImmediate(done));

test("50件を登録してもジョブ枠10・高負荷枠2を守り、待機中のキャンセルを実行しない", async () => {
  const scheduler = new JobScheduler({ concurrency: 10, mediaSlots: 2 });
  const gates = Array.from({ length: 50 }, deferred);
  const started = [];
  let jobs = 0, media = 0, peakJobs = 0, peakMedia = 0;
  const runs = gates.map((gate, index) => scheduler.submit(String(index), async ({ runMedia }) => {
    jobs++;
    peakJobs = Math.max(peakJobs, jobs);
    try {
      return await runMedia(async () => {
        started.push(index);
        media++;
        peakMedia = Math.max(peakMedia, media);
        try { await gate.promise; return index; } finally { media--; }
      });
    } finally { jobs--; }
  }));
  const settled = Promise.allSettled(runs);
  await tick();
  assert.equal(jobs, 10);
  assert.equal(media, 2);
  assert.equal(scheduler.cancel("49"), true);
  assert.equal(scheduler.cancel("8"), true);
  for (const gate of gates) { gate.resolve(); await tick(); }
  const result = await settled;
  assert.equal(result.filter((entry) => entry.status === "fulfilled").length, 48);
  assert.equal(result[8].reason.name, "AbortError");
  assert.equal(result[49].reason.name, "AbortError");
  assert.equal(started.includes(8), false);
  assert.equal(started.includes(49), false);
  assert.equal(peakJobs, 10);
  assert.equal(peakMedia, 2);
  assert.equal(jobs, 0);
  assert.equal(media, 0);
});

test("実行中キャンセルは後片付け終了まで高負荷枠を保持し、次のジョブを守る", async () => {
  const scheduler = new JobScheduler({ concurrency: 10, mediaSlots: 1 });
  const cleanup = deferred();
  let secondStarted = false;
  const first = scheduler.submit("first", ({ signal, runMedia }) => runMedia(async () => {
    try {
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    } finally { await cleanup.promise; }
  }));
  const second = scheduler.submit("second", ({ runMedia }) => runMedia(async () => {
    secondStarted = true;
    return "safe";
  }));
  const settled = Promise.allSettled([first, second]);
  await tick();
  scheduler.cancel("first");
  await tick();
  assert.equal(secondStarted, false);
  cleanup.resolve();
  const results = await settled;
  assert.equal(results[0].reason.name, "AbortError");
  assert.equal(results[1].value, "safe");
});

test("1件の失敗は他ジョブへ波及せず、終了後に同じIDを再試行できる", async () => {
  const scheduler = new JobScheduler({ concurrency: 10, mediaSlots: 1 });
  const results = await Promise.allSettled([
    scheduler.submit("bad", ({ runMedia }) => runMedia(async () => { throw new Error("bad input"); })),
    scheduler.submit("good", ({ runMedia }) => runMedia(async () => 42))
  ]);
  assert.equal(results[0].reason.message, "bad input");
  assert.equal(results[1].value, 42);
  assert.equal(await scheduler.submit("bad", async () => "retry"), "retry");
  assert.equal(scheduler.cancel("missing"), false);
});

test("枠の縮小は実行中の処理を止めず、重複IDと不正な枠を拒否する", async () => {
  const scheduler = new JobScheduler({ concurrency: 20, mediaSlots: 2 });
  const gate = deferred();
  let active = 0, nextStarted = false;
  const first = scheduler.submit("a", ({ runMedia }) => runMedia(async () => { active++; await gate.promise; active--; }));
  const second = scheduler.submit("b", ({ runMedia }) => runMedia(async () => { active++; await gate.promise; active--; }));
  await tick();
  scheduler.setLimits({ concurrency: 10, mediaSlots: 1 });
  const third = scheduler.submit("c", ({ runMedia }) => runMedia(async () => { nextStarted = true; }));
  await tick();
  assert.equal(active, 2);
  assert.equal(nextStarted, false);
  await assert.rejects(scheduler.submit("a", async () => {}), /識別子/);
  gate.resolve();
  await Promise.all([first, second, third]);
  assert.equal(nextStarted, true);
  assert.throws(() => scheduler.setLimits({ concurrency: 9, mediaSlots: 1 }));
  assert.throws(() => new JobScheduler({ concurrency: 10, mediaSlots: 11 }));
});


test("中断後の後片付けエラーをAbortErrorで隠さない", async () => {
  const scheduler = new JobScheduler({ concurrency: 10, mediaSlots: 1 });
  const cleanup = deferred(), failure = new Error("cleanup failed");
  let entered = false;
  const first = scheduler.submit("failed-stop", async () => {
    entered = true; await cleanup.promise; throw failure;
  });
  const rejected = assert.rejects(first, (error) => error === failure);
  await tick(); assert.equal(entered, true);
  scheduler.cancel("failed-stop"); cleanup.resolve(); await rejected;
  assert.equal(await scheduler.submit("next", async () => 42), 42);
});

test("同時実行数の増減を待機ジョブへ反映し、実行中の処理と高負荷枠を維持する", async () => {
  const scheduler = new JobScheduler({ concurrency: 10, mediaSlots: 2 });
  const gates = Array.from({ length: 35 }, deferred);
  let active = 0, media = 0, peakMedia = 0, started = 0;
  const runs = gates.map((gate, index) => scheduler.submit(String(index), async ({ signal, runMedia }) => {
    active++; started++;
    try {
      await runMedia(async () => { media++; peakMedia = Math.max(peakMedia, media); await tick(); media--; });
      await gate.promise; assert.equal(signal.aborted, false);
    } finally { active--; }
  }));
  await tick(); assert.equal(active, 10);
  scheduler.setConcurrency(20); await tick(); assert.equal(active, 20);
  assert.throws(() => scheduler.setConcurrency(9));
  assert.throws(() => scheduler.setConcurrency(51));
  scheduler.setConcurrency(10); await tick(); assert.equal(active, 20);
  for (let i = 0; i < 11; i++) { gates[i].resolve(); await tick(); }
  assert.equal(active, 10); assert.equal(started, 21);
  for (const gate of gates) gate.resolve();
  await Promise.all(runs);
  assert.equal(started, 35); assert.equal(active, 0); assert.equal(peakMedia, 2);
});
