import assert from "node:assert/strict";
import test from "node:test";
import { PendingSaveStore } from "../.build/pocket/assets/pending-save-store.js";

function storage(values = {}) {
  const data = structuredClone(values);
  return { data, async get(key) { return { [key]: structuredClone(data[key]) }; },
    async set(values) { Object.assign(data, structuredClone(values)); }, async remove(key) { delete data[key]; } };
}
const job = (videoId, downloadId) => ({ videoId, title: "PRIVATE_TITLE", sourceUrl: "PRIVATE_URL",
  saveIssue: { pendingDownloadId: downloadId } });

test("保存開始時の追加・解除・保持を直列化し、同じ保存IDの別動画登録を拒否する", async () => {
  const local = storage(), store = new PendingSaveStore(local, storage());
  await Promise.all([store.add({ videoId: "sm1", downloadId: 7 }), store.add({ videoId: "sm2", downloadId: 8 })]);
  await assert.rejects(store.add({ videoId: "sm3", downloadId: 7 }));
  await Promise.all([store.remove(7), store.add({ videoId: "sm2", downloadId: 8 }), store.retain([])]);
  assert.deepEqual(await store.read(), [{ videoId: "sm2", downloadId: 8 }]);
});

test("session消失と新しいStoreでも識別子だけを復元できる", async () => {
  const local = storage(), session = storage();
  await new PendingSaveStore(local, session).retain([job("sm1", 7)]);
  assert.deepEqual(local.data, { ["np:pendingSaves"]: [{ videoId: "sm1", downloadId: 7 }] });
  assert.deepEqual(await new PendingSaveStore(local, storage()).read(), local.data["np:pendingSaves"]);
  assert.equal(JSON.stringify(local.data).includes("PRIVATE"), false);
});

test("旧sessionと永続側を重複なく移行し、移行後の解除で復活しない", async () => {
  const local = storage({ ["np:pendingSaves"]: [{ videoId: "sm1", downloadId: 7 }] });
  const session = storage({ ["np:pendingSaves"]: [{ videoId: "sm1", downloadId: 7 }, { videoId: "sm2", downloadId: 8 }] });
  const store = new PendingSaveStore(local, session);
  await Promise.all([store.read(), store.remove(7), store.retain([job("sm3", 9)])]);
  assert.deepEqual(await store.read(), [{ videoId: "sm2", downloadId: 8 }, { videoId: "sm3", downloadId: 9 }]);
  assert.equal(session.data["np:pendingSaves"], undefined);
});

test("永続書込みが失敗したら旧記録を残し、再試行で移行できる", async () => {
  const local = storage(), session = storage({ ["np:pendingSaves"]: [{ videoId: "sm1", downloadId: 7 }] });
  let fail = true; const set = local.set;
  local.set = async values => { if (fail) throw new Error("storage unavailable"); return set(values); };
  const store = new PendingSaveStore(local, session);
  await assert.rejects(store.read()); assert.equal(session.data["np:pendingSaves"].length, 1);
  assert.equal(local.data["np:pendingSaves"], undefined);
  fail = false; assert.equal((await store.read()).length, 1); assert.equal(session.data["np:pendingSaves"], undefined);
});

test("破損した記録を空扱いせず、解除の書込み失敗でも記録を維持する", async () => {
  const corrupt = storage({ ["np:pendingSaves"]: [{ videoId: "sm1", downloadId: 7, filename: "PRIVATE_PATH" }] });
  await assert.rejects(new PendingSaveStore(corrupt, storage()).read());
  assert.equal(corrupt.data["np:pendingSaves"][0].filename, "PRIVATE_PATH");
  const local = storage({ ["np:pendingSaves"]: [{ videoId: "sm1", downloadId: 7 }] });
  local.set = async () => { throw new Error("storage unavailable"); };
  const store = new PendingSaveStore(local, storage());
  await assert.rejects(store.remove(7)); assert.equal((await store.read()).length, 1);
});
