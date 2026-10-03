import assert from "node:assert/strict";
import { test } from "node:test";
import { JobRunner } from "../.build/extension/pocket/assets/job-runner.js";
import { saveLocalFiles } from "../.build/extension/pocket/assets/download-saver.js";
import { JobMediaError } from "../.build/extension/pocket/assets/job-media-error.js";
import { appendJob, applyJobEvent } from "../.build/extension/pocket/assets/jobs.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((done) => setTimeout(done, 5));
  }
  throw new Error("Condition did not arrive");
}
const media = () => ({ m4a: new Uint8Array([1]), compressed: false, warning: false,
  warnings: [], coverEmbedded: false, sourceBitrate: 100000, outputBitrate: 100000, compressionAttempts: 0 });
function fixture(ids) {
  let jobs = [];
  for (const id of ids) jobs = appendJob(jobs, { videoId: id, title: id, sourceUrl: `https://www.nicovideo.jp/watch/${id}`,
    quality: "best", saveAac: false, saveJpeg: false, addedAt: 0 }, id, 0);
  const events = [], disposed = [], processed = [], saved = [];
  const state = {
    async get(id) { return structuredClone(jobs.find((job) => job.id === id)); },
    async apply(event) { jobs = applyJobEvent(jobs, event); events.push(event); return await state.get(event.id); }
  };
  const ports = { state,
    async acquire(job) { return { aac: new Uint8Array([2]), async dispose() { disposed.push(job.id); } }; },
    async process(job) { processed.push(job.id); return media(); },
    async save(job) { saved.push(job.id); }
  };
  return { ports, state, events, disposed, processed, saved, job: (id) => jobs.find((job) => job.id === id) };
}
const limits = { concurrency: 10, mediaSlots: 1 };
test("HLS取得結果はmedia枠で処理し、保存終了後に解放する",async()=>{
  const f=fixture(["sm1"]),hls={playlist:"synthetic",files:[]};let disposed=false;
  f.ports.acquire=async()=>({hls,async dispose(){disposed=true;}});
  f.ports.process=async(job,source,signal,onStage)=>{
    assert.equal(source,hls);assert.equal(disposed,false);onStage("mux");
    return{m4a:new Uint8Array([1]),warning:false};
  };
  f.ports.save=async()=>{assert.equal(disposed,false);};
  assert.equal((await new JobRunner(f.ports,limits).start("sm1")).status,"complete");
  assert.equal(disposed,true);assert.equal(f.job("sm1").percent,100);
});

test("工程の完了で途中進捗を進め、保存と後片付けの待機中は100％へ進めない", async () => {
  const f=fixture(["sm1"]),acquired=deferred(),processed=deferred(),saved=deferred(),disposed=deferred();
  let notify,disposing=false;
  f.ports.acquire=async()=>{await acquired.promise;return {aac:new Uint8Array([2]),async dispose(){disposing=true;await disposed.promise;}};};
  f.ports.process=async(_job,_aac,_signal,onStage)=>{notify=onStage;await processed.promise;return media();};
  f.ports.save=async()=>saved.promise;
  const pending=new JobRunner(f.ports,limits).start("sm1");
  await until(()=>f.job("sm1").stage==="audio");
  assert.equal(f.job("sm1").percent,0);acquired.resolve();
  await until(()=>notify!==undefined);
  const preparedPercent=f.job("sm1").percent;
  assert.ok(preparedPercent>0&&preparedPercent<100);
  notify("encode");await until(()=>f.job("sm1").stage==="encode");
  const encodePercent=f.job("sm1").percent;assert.ok(encodePercent>preparedPercent&&encodePercent<100);
  notify("mux");await until(()=>f.job("sm1").stage==="mux");
  const muxPercent=f.job("sm1").percent;assert.ok(muxPercent>encodePercent&&muxPercent<100);
  processed.resolve();await until(()=>f.job("sm1").stage==="save");
  const savePercent=f.job("sm1").percent;assert.ok(savePercent>muxPercent&&savePercent<100);
  saved.resolve();await until(()=>disposing);
  assert.equal(f.job("sm1").status,"processing");assert.equal(f.job("sm1").percent,savePercent);
  disposed.resolve();assert.equal((await pending).status,"complete");assert.equal(f.job("sm1").percent,100);
});

test("実保存応答のIDを完了状態へ渡し、壊れた保存応答は固定エラーにする", async () => {
  const f=fixture(['sm1']);
  f.ports.save=async()=>[{id:11,requestedFilename:'sm1.m4a'}];
  assert.equal((await new JobRunner(f.ports,limits).start('sm1')).status,'complete');
  assert.deepEqual(f.job('sm1').downloads,{m4a:11});
  for(const saved of [[],[{id:-1,requestedFilename:'sm2.m4a'}],
    [{id:1,requestedFilename:'sm2.mp4'}],[{id:1,requestedFilename:'sm2.m4a'},{id:2,requestedFilename:'PRIVATE.aac'}]]) {
    const invalid=fixture(['sm2']);invalid.ports.save=async()=>saved;
    assert.equal((await new JobRunner(invalid.ports,limits).start('sm2')).status,'error');
    assert.equal(invalid.job('sm2').errorDetail.code,'DOWNLOAD_FAILED');
    assert.equal(invalid.job('sm2').downloads,undefined);
    assert.doesNotMatch(JSON.stringify(invalid.job('sm2')),/PRIVATE/);
  }
});

test("実保存応答と入力の後片付けまで完了を確定せず、重複開始は同じ処理を返す", async () => {
  const f = fixture(["sm1"]), save = deferred(), dispose = deferred();
  f.ports.acquire = async () => ({ aac: new Uint8Array([2]), dispose: () => dispose.promise });
  f.ports.process = async (job) => { assert.equal(Object.isFrozen(job), true); return { ...media(), warning: true, warnings: ["COVER_UNAVAILABLE"] }; };
  f.ports.save = async () => save.promise;
  const runner = new JobRunner(f.ports, limits), result = runner.start("sm1");
  assert.equal(runner.start("sm1"), result);
  await until(() => f.job("sm1").stage === "save");
  assert.equal(f.job("sm1").status, "processing"); assert.equal(f.job("sm1").percent, 80);
  save.resolve(); await new Promise((done) => setImmediate(done));
  assert.equal(f.job("sm1").status, "processing"); dispose.resolve();
  assert.deepEqual(await result, { id: "sm1", status: "warning" });
  assert.equal(f.job("sm1").percent, 100);
  assert.deepEqual(f.events.map((event) => event.type === "progress" ? event.stage : event.type),
    ["start", "audio", "prepare", "save", "complete"]);
});

test("取得・画像復元・保存・後片付けの失敗を分類し、診断本文を状態へ残さない", async () => {
  const cases = [
    ["metadata", "JOB_IMAGE_UNAVAILABLE", new Error("unused")],
    ["acquire", "AUDIO_FETCH_FAILED", new Error("private token")],
    ["process", "JOB_IMAGE_UNAVAILABLE", new JobMediaError("JOB_IMAGE_UNAVAILABLE")],
    ["save", "DOWNLOAD_FAILED", new Error("private token")],
    ["dispose", "WORKER_FAILED", new Error("private token")]
  ];
  for (const [operation, code, error] of cases) {
    const f = fixture(["sm1"]);
    if (operation === "metadata") {
      const get = f.state.get;
      f.state.get = async (id) => ({ ...await get(id), thumbnail: { width: 0 } });
      f.ports.acquire = async () => { assert.fail("Invalid image must not start acquisition"); };
    } else if (operation === "dispose") f.ports.acquire = async () => ({ aac: new Uint8Array([2]), async dispose() { throw error; } });
    else f.ports[operation] = async () => { throw error; };
    const result = await new JobRunner(f.ports, limits).start("sm1");
    assert.equal(result.status, "error"); assert.equal(f.job("sm1").errorDetail.code, code);
    assert.equal(JSON.stringify(f.job("sm1")).includes("token"), false);
    assert.equal(f.job("sm1").percent, operation === "metadata" || operation === "acquire" ? 0 : operation === "process" ? 20 : 80);
    if (operation === "process" || operation === "save") assert.deepEqual(f.disposed, ["sm1"]);
    if (operation === "acquire" || operation === "process") assert.equal(f.saved.length, 0);
  }
});

test("実行中キャンセルでは高負荷処理の停止を待ち、次ジョブ・再試行へ影響しない", async () => {
  const f = fixture(["sm1", "sm2"]), stopped = deferred(), disposed = deferred();
  let cancelledSignal, first = true;
  f.ports.acquire = async (job) => ({ aac: new Uint8Array([2]), async dispose() {
    if (job.id === "sm1" && first) await disposed.promise;
  } });
  f.ports.process = async (job, _aac, signal) => {
    f.processed.push(job.id);
    if (job.id === "sm1" && first) { cancelledSignal = signal; await stopped.promise; signal.throwIfAborted(); }
    return media();
  };
  const runner = new JobRunner(f.ports, limits), cancelled = runner.start("sm1"), next = runner.start("sm2");
  await until(() => cancelledSignal !== undefined); assert.equal(runner.cancel("sm1"), true);
  assert.equal(runner.cancel("sm1"), false); assert.equal(cancelledSignal.aborted, true);
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(f.processed, ["sm1"]); assert.equal(f.job("sm1").status, "processing");
  stopped.resolve(); await until(() => f.processed.includes("sm2"));
  assert.equal(f.job("sm1").status, "processing"); disposed.resolve();
  assert.equal((await cancelled).status, "cancelled"); assert.equal((await next).status, "complete");
  assert.deepEqual(f.saved, ["sm2"]);
  first = false; await f.state.apply({ type: "retry", id: "sm1", at: Date.now() });
  assert.equal((await runner.start("sm1")).status, "complete"); assert.equal(f.job("sm1").attempts, 2);
});

test("待機枠でのキャンセルは開始せず、全体停止は全処理の終了解決を待つ", async () => {
  const ids = Array.from({ length: 11 }, (_, i) => `sm${i + 1}`), f = fixture(ids);
  const requested = [];
  f.ports.acquire = async (job, signal) => {
    requested.push(job.id);
    await new Promise((_done, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const runner = new JobRunner(f.ports, limits), results = ids.map((id) => runner.start(id));
  await until(() => requested.length === 10); assert.equal(runner.cancel("sm11"), true);
  assert.equal((await results[10]).status, "cancelled"); assert.equal(f.job("sm11").attempts, 0);
  await runner.stop(); assert.equal((await Promise.all(results)).every((item) => item.status === "cancelled"), true);
  await assert.rejects(runner.start("sm11"), (error) => error.code === "WORKER_FAILED");
  assert.equal(f.processed.length, 0); assert.equal(f.saved.length, 0);
});

test("完了書き込み後に到着したキャンセルは確定済みの状態を上書きしない", async () => {
  const f = fixture(["sm1"]), apply = f.state.apply;
  let runner;
  f.state.apply = async (event) => {
    const job = await apply(event);
    if (event.type === "complete") runner.cancel(event.id);
    return job;
  };
  runner = new JobRunner(f.ports, limits);
  assert.equal((await runner.start("sm1")).status, "complete");
  assert.equal(f.job("sm1").status, "complete"); assert.equal(f.events.some((event) => event.type === "cancel"), false);
});

test("工程の状態保存を待ってから保存へ進み、処理終了後の古い通知を無視する", async () => {
  const f = fixture(["sm1"]), persist = deferred(), apply = f.state.apply;
  let notify;
  f.state.apply = async (event) => {
    if (event.type === "progress" && event.stage === "mux") await persist.promise;
    return await apply(event);
  };
  f.ports.process = async (_job, _aac, _signal, onStage) => {
    notify = onStage; onStage("encode"); onStage("encode"); onStage("mux"); return media();
  };
  const runner = new JobRunner(f.ports, limits), pending = runner.start("sm1");
  await until(() => f.job("sm1").stage === "encode");
  assert.equal(f.saved.length, 0); persist.resolve();
  assert.equal((await pending).status, "complete");
  const count = f.events.length; notify("encode"); await new Promise((done) => setImmediate(done));
  assert.equal(f.events.length, count); assert.equal(f.job("sm1").status, "complete");
  assert.deepEqual(f.events.map((event) => event.type === "progress" ? event.stage : event.type),
    ["start", "audio", "prepare", "encode", "mux", "save", "complete"]);
});

test("工程保存の失敗はWorker停止を待って固定エラーへ変換し、次の高負荷処理を早く始めない", async () => {
  const f = fixture(["sm1", "sm2"]), stopped = deferred(), apply = f.state.apply;
  let signal1;
  f.state.apply = async (event) => {
    if (event.id === "sm1" && event.type === "progress" && event.stage === "mux") throw new Error("unsafe token");
    return await apply(event);
  };
  f.ports.process = async (job, _aac, signal, onStage) => {
    f.processed.push(job.id);
    if (job.id === "sm1") { signal1 = signal; onStage("mux"); await stopped.promise; signal.throwIfAborted(); }
    return media();
  };
  const runner = new JobRunner(f.ports, limits), first = runner.start("sm1"), second = runner.start("sm2");
  await until(() => signal1?.aborted);
  assert.deepEqual(f.processed, ["sm1"]); assert.equal(f.job("sm1").status, "processing");
  stopped.resolve(); assert.equal((await first).status, "error"); assert.equal((await second).status, "complete");
  assert.equal(f.job("sm1").errorDetail.code, "WORKER_FAILED");
  assert.equal(JSON.stringify(f.job("sm1")).includes("token"), false);
  assert.deepEqual(f.saved, ["sm2"]);
});

test("キャンセル後に届く工程を保存せず、M4A生成から音声変換への逆行を拒否する", async () => {
  const f = fixture(["sm1"]), done = deferred(); let notify;
  f.ports.process = async (_job, _aac, signal, onStage) => {
    notify = onStage; await done.promise; signal.throwIfAborted(); return media();
  };
  const runner = new JobRunner(f.ports, limits), pending = runner.start("sm1");
  await until(() => notify !== undefined); runner.cancel("sm1"); notify("mux"); done.resolve();
  assert.equal((await pending).status, "cancelled"); assert.equal(f.events.some((event) => event.stage === "mux"), false);
  const backward = fixture(["sm2"]);
  backward.ports.process = async (_job, _aac, _signal, onStage) => { onStage("mux"); onStage("encode"); return media(); };
  assert.equal((await new JobRunner(backward.ports, limits).start("sm2")).status, "error");
  assert.equal(backward.saved.length, 0);
});


test("Chrome保存の停止失敗はキャンセル扱いにせず、後片付け後に保存エラーを確定する", async (t) => {
  const previous = globalThis.chrome, listeners = new Set(), stop = deferred(), cleanup = deferred();
  let downloadStarted = false, cleaned = false;
  globalThis.chrome = { downloads: {
    onChanged: { addListener: (listener) => listeners.add(listener), removeListener: (listener) => listeners.delete(listener) },
    download: async () => { downloadStarted = true; return 7; },
    search: async ({id}) => [{id, state: "in_progress"}],
    cancel: () => stop.promise
  } };
  t.after(() => { globalThis.chrome = previous; });
  const f = fixture(["sm1", "sm2"]), save = f.ports.save;
  f.ports.acquire = async (job) => ({ aac: new Uint8Array([2]), async dispose() {
    if (job.id === "sm1") { await cleanup.promise; cleaned = true; }
  } });
  f.ports.save = async (job, _output, signal) => job.id === "sm1"
    ? saveLocalFiles([{filename: "sm1.m4a", blob: new Blob(["synthetic"])}], signal) : save(job);
  const runner = new JobRunner(f.ports, limits), first = runner.start("sm1");
  await until(() => downloadStarted); runner.cancel("sm1");
  await new Promise((done) => setImmediate(done));
  assert.equal(f.job("sm1").status, "processing");
  stop.reject(new Error("PRIVATE_STOP_FAILURE"));
  await until(() => listeners.size === 0);
  assert.equal(f.job("sm1").status, "processing");
  cleanup.resolve();
  assert.equal((await first).status, "error");
  assert.equal(cleaned, true);
  assert.equal(f.job("sm1").errorDetail.code, "DOWNLOAD_FAILED");
  assert.deepEqual(f.job("sm1").saveIssue, {pendingDownloadId: 7});
  assert.doesNotMatch(JSON.stringify(f.job("sm1")), /PRIVATE_STOP_FAILURE/);
  assert.equal((await runner.start("sm2")).status, "complete");
});


for (const mode of ["failure", "cancel"]) test(`一部実保存後の${mode}でも保存IDを保持し、次回試行へ古い結果を流さない`, async (t) => {
  const previous = globalThis.chrome, listeners = new Set();
  let starts = 0, waiting = false;
  globalThis.chrome = { downloads: {
    onChanged: { addListener: (listener) => listeners.add(listener), removeListener: (listener) => listeners.delete(listener) },
    download: async () => { starts++; if (mode === "failure" && starts === 2) throw new Error("PRIVATE_SAVE_TOKEN"); return starts; },
    search: async ({id}) => { if(id === 2) waiting = true; return [{id, state: id === 1 ? "complete" : "in_progress"}]; },
    cancel: async () => {}
  } };
  t.after(() => { globalThis.chrome = previous; });
  const f = fixture(["sm1"]); f.job("sm1").saveAac = true;
  f.ports.save = async (_job, _output, signal) => saveLocalFiles([
    {filename:"sm1.m4a",blob:new Blob(["synthetic-m4a"])},
    {filename:"sm1.aac",blob:new Blob(["synthetic-aac"])}],signal);
  const runner = new JobRunner(f.ports, limits), result = runner.start("sm1");
  if(mode === "cancel") { await until(() => waiting); runner.cancel("sm1"); }
  assert.equal((await result).status, mode === "cancel" ? "cancelled" : "error");
  assert.deepEqual(f.job("sm1").saveIssue, {completed:{m4a:1}});
  assert.equal(f.job("sm1").downloads, undefined);
  assert.equal(f.job("sm1").percent, 80);
  assert.equal(listeners.size, 0);
  assert.doesNotMatch(JSON.stringify(f.job("sm1")), /PRIVATE_SAVE_TOKEN|requestedFilename/);
  await f.state.apply({type:"retry",id:"sm1",at:Date.now()});
  assert.equal(f.job("sm1").saveIssue, undefined);
});

for (const extras of [false, true]) for (const mode of ["cancel", "cleanup-failure"]) test(`全ファイル保存後の${mode}でも確認済み保存IDを保持する（追加出力${extras}）`, async () => {
  const f=fixture(['sm1']), cleanup=deferred();let disposing=false;
  f.job('sm1').saveAac=extras;f.job('sm1').saveJpeg=extras;
  f.ports.process=async()=>({...media(),...(extras?{jpeg:new Uint8Array([3])}:{})});
  f.ports.save=async()=>[{id:21,requestedFilename:'sm1.m4a'},...(extras?[{id:22,requestedFilename:'sm1.aac'},{id:23,requestedFilename:'sm1.jpg'}]:[])];
  f.ports.acquire=async()=>({aac:new Uint8Array([2]),async dispose(){disposing=true;await cleanup.promise;}});
  const runner=new JobRunner(f.ports,limits),pending=runner.start('sm1');
  await until(()=>disposing);
  assert.equal(f.job('sm1').status,'processing');
  if(mode==='cancel'){runner.cancel('sm1');cleanup.resolve();}else cleanup.reject(new Error('PRIVATE_CLEANUP_TOKEN'));
  assert.equal((await pending).status,mode==='cancel'?'cancelled':'error');
  assert.deepEqual(f.job('sm1').saveIssue,{completed:{m4a:21,...(extras?{aac:22,jpeg:23}:{})}});
  assert.equal(f.job('sm1').downloads,undefined);
  assert.equal(f.job('sm1').percent,80);
  if(mode==='cleanup-failure') assert.equal(f.job('sm1').errorDetail.code,'WORKER_FAILED');
  assert.doesNotMatch(JSON.stringify(f.job('sm1')),/PRIVATE_CLEANUP_TOKEN|requestedFilename/);
});
