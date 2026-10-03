import assert from "node:assert/strict";
import test from "node:test";
import { reserveJobSaveNames } from "../.build/pocket/assets/save-name-allocator.js";
import { saveJobMediaWithAllocatedNames } from "../.build/pocket/assets/job-save.js";
import { DownloadSaveError } from "../.build/pocket/assets/download-saver.js";

const signal = () => new AbortController().signal;
function history(t, items = [], queryImpl) {
  const previous = globalThis.chrome, queries = [];
  globalThis.chrome = { downloads: { search: async query => {
    queries.push(query); return queryImpl ? queryImpl(query) : items;
  } } };
  t.after(() => { globalThis.chrome = previous; });
  return queries;
}
function release(t, reservation) { t.after(() => reservation.release()); return reservation; }

test("AAC単独衝突でも3形式に同じ空白なし連番を割り当てる", async t => {
  const queries = history(t, [{ filename: "/Downloads/NicoPocket/共通.aac", byExtensionId: "other-extension" }]);
  const reservation = release(t, await reserveJobSaveNames("共通", "sm1", signal()));
  assert.deepEqual(reservation.names, { m4a: "共通(1).m4a", aac: "共通(1).aac", jpeg: "共通(1).jpg" });
  assert.equal(queries[0].limit, 0);
  const pattern = new RegExp(queries[0].filenameRegex);
  assert.ok(pattern.test("/Downloads/NicoPocket/共通.aac"));
  assert.ok(pattern.test("C:\\Downloads\\NICOPOCKET\\共通.aac"));
  assert.ok(!pattern.test("/Downloads/Other/共通.aac"));
  assert.ok(!pattern.test("/Downloads/NicoPocket/sub/共通.aac"));
});

test("全形式の既存連番を避け、他フォルダー・子フォルダーは混同しない", async t => {
  history(t, ["/Downloads/NicoPocket/穴.m4a", "/Downloads/NicoPocket/穴(1).aac",
    "/Downloads/NicoPocket/穴(2).jpeg", "/Downloads/Other/穴(3).m4a",
    "/Downloads/NicoPocket/sub/穴(3).jpg"].map(filename => ({ filename })));
  const reservation = release(t, await reserveJobSaveNames("穴", "sm2", signal()));
  assert.equal(reservation.names.m4a, "穴(3).m4a");
});

test("Windowsの区切り・大文字小文字・NFCの同名を保守的に照合する", async t => {
  history(t, [{ filename: "C:\\Downloads\\NICOPOCKET\\Cafe\u0301.AAC", exists: false, state: "interrupted" }]);
  const reservation = release(t, await reserveJobSaveNames("CAFÉ", "sm3", signal()));
  assert.equal(reservation.names.m4a, "CAFÉ(1).m4a");
});

test("同時要求とタイトル自体の括弧を含む要求へ重複名を渡さない", async t => {
  let resolveQueries;
  const gate = new Promise(resolve => { resolveQueries = resolve; });
  history(t, [], () => gate);
  const first = reserveJobSaveNames("同時", "sm4", signal());
  const second = reserveJobSaveNames("同時", "sm5", signal());
  const literal = reserveJobSaveNames("同時(1)", "sm6", signal());
  resolveQueries([]);
  const reservations = await Promise.all([first, second, literal]);
  reservations.forEach(r => release(t, r));
  assert.deepEqual(reservations.map(r => r.names.m4a), ["同時.m4a", "同時(1).m4a", "同時(1)(1).m4a"]);
});

test("未使用予約は解除し、書き込み試行済みの名前は同一ウィンドウで再使用しない", async t => {
  history(t);
  const first = await reserveJobSaveNames("解除", "sm7", signal());
  assert.ok(Object.isFrozen(first.names));
  first.release(); first.release(true);
  const reused = await reserveJobSaveNames("解除", "sm7", signal());
  assert.equal(reused.names.m4a, "解除.m4a");
  reused.release(true);
  const next = release(t, await reserveJobSaveNames("解除", "sm7", signal()));
  assert.equal(next.names.m4a, "解除(1).m4a");
});

test("履歴1000件を超えた衝突も照合対象へ含める", async t => {
  const items = Array.from({ length: 1001 }, (_, i) => ({ filename: `/Downloads/NicoPocket/多数${i ? `(${i})` : ""}.m4a` }));
  history(t, [], query => items.slice(0, query.limit || items.length));
  const reservation = release(t, await reserveJobSaveNames("多数", "sm8", signal()));
  assert.equal(reservation.names.m4a, "多数(1001).m4a");
});

test("履歴失敗は保存を開始せず、URL・パスを含む例外本文を返さない", async t => {
  history(t, [], () => { throw new Error("PRIVATE_PATH_AND_TOKEN"); });
  await assert.rejects(reserveJobSaveNames("拒否", "sm9", signal()), error => {
    assert.ok(error instanceof DownloadSaveError);
    assert.equal(error.code, "DOWNLOAD_FAILED");
    assert.ok(!JSON.stringify(error).includes("PRIVATE"));
    return true;
  });
});

test("開始前・履歴照合中の中断はAPI応答を待たず予約を残さず、不正動画IDは履歴参照前に拒否する", { timeout: 1000 }, async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const queries = history(t, [], () => pending);
  const before = new AbortController(); before.abort();
  await assert.rejects(reserveJobSaveNames("停止", "sm10", before.signal), { name: "AbortError" });
  await assert.rejects(reserveJobSaveNames("停止", "../invalid", signal()), DownloadSaveError);
  assert.equal(queries.length, 0);
  const during = new AbortController();
  const reserving = reserveJobSaveNames("停止", "sm10", during.signal);
  during.abort();
  await assert.rejects(reserving, { name: "AbortError" });
  finish([]);
  const next = release(t, await reserveJobSaveNames("停止", "sm10", signal()));
  assert.equal(next.names.m4a, "停止.m4a");
});

test("ジョブ保存入口は選択・バイトを固定し、履歴に基づく共通名で実保存部品へ渡す", async t => {
  const previous = globalThis.chrome, started = [], listeners = new Set(), queries = [];
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  globalThis.chrome = { runtime: { id: "allocator-test" }, downloads: {
    onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
    download: async options => {
      started.push({ options, bytes: [...new Uint8Array(await (await fetch(options.url)).arrayBuffer())] });
      return started.length;
    },
    search: async query => {
      if (query.id === undefined) { queries.push(query); return pending; }
      return [{ id: query.id, state: "complete", byExtensionId: "allocator-test",
        filename: "/Downloads/" + started[query.id - 1].options.filename }];
    }, cancel: async () => {}
  } };
  t.after(() => { globalThis.chrome = previous; });
  const job = { title: "固定", videoId: "sm11", saveAac: true, saveJpeg: false };
  const media = { m4a: new Uint8Array([1]), aac: new Uint8Array([2]), jpeg: new Uint8Array([3]) };
  const saving = saveJobMediaWithAllocatedNames(job, media, signal());
  job.title = "変化"; job.saveAac = false; job.saveJpeg = true; media.aac.fill(0);
  finish([{ filename: "/Downloads/NicoPocket/固定.jpg" }]);
  const saved = await saving;
  assert.deepEqual(started.map(x => x.options.filename), ["NicoPocket/固定(1).m4a", "NicoPocket/固定(1).aac"]);
  assert.deepEqual(started.map(x => x.bytes), [[1], [2]]);
  assert.deepEqual(saved.map(x => x.requestedFilename), ["固定(1).m4a", "固定(1).aac"]);
  assert.equal(queries.length, 1); assert.equal(listeners.size, 0);
});
