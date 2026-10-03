import test from "node:test";
import assert from "node:assert/strict";
import { WatchPlaylistSnapshot } from "../.build/pocket/assets/watch-playlist-snapshot.js";

const source = { videoId: "sm1", epoch: "synthetic-epoch" };
const summary = { reason: "ready", messages: 4, initializations: 1, containers: 1, rows: 4, adjacentTimes: 4 };
const live = { playlist: new URL("https://delivery.domand.nicovideo.jp/hls/synthetic/master.m3u8?fixture=1"), summary };
const missing = { summary: { ...summary, reason: "no-messages", messages: 0, initializations: 0, containers: 0, rows: 0, adjacentTimes: 0 } };

test("追加時の確認済みURLをパネル除去後も同じ文書・世代に限り引き継ぐ", () => {
  const snapshot = new WatchPlaylistSnapshot(() => 10);
  snapshot.capture(source, live);
  const result = snapshot.resolve(source, missing);
  assert.equal(result.playlist.href, live.playlist.href);
  assert.equal(result.playlistFrom, "entry");
  assert.equal(result.entryLog.reason, "ready"); assert.equal(result.currentLog.reason, "no-messages");
  assert(!JSON.stringify({ log: result.summary, entryLog: result.entryLog, currentLog: result.currentLog }).includes("fixture=1"));
  assert.equal(snapshot.resolve({ ...source, epoch: "new-epoch" }, missing).playlist, undefined);
  assert.equal(snapshot.resolve(source, missing).playlist, undefined);
});
test("最新ログが再初期化中または破損なら保存済みURLを使わない", () => {
  const snapshot = new WatchPlaylistSnapshot(() => 10);
  snapshot.capture(source, live);
  assert.equal(snapshot.resolve(source, { summary: { ...summary, reason: "page-sequence" } }).playlist, undefined);
  assert.equal(snapshot.resolve(source, missing).playlist, undefined);
});
test("利用期限・時刻逆転・別動画で破棄し、元のURLへ戻らない", () => {
  let now = 100;
  const snapshot = new WatchPlaylistSnapshot(() => now);
  snapshot.capture(source, live); now = 60100;
  assert.equal(snapshot.resolve(source, missing).playlist, undefined);
  now = 100; snapshot.capture(source, live); now = 99;
  assert.equal(snapshot.resolve(source, missing).playlist, undefined);
  now = 100; snapshot.capture(source, live);
  assert.equal(snapshot.resolve({ ...source, videoId: "sm2" }, missing).playlist, undefined);
});
test("新しい追加操作の欠落ログと明示破棄が古い確認結果を解除する", () => {
  const snapshot = new WatchPlaylistSnapshot(() => 10);
  snapshot.capture(source, live); snapshot.capture(source, missing);
  assert.equal(snapshot.resolve(source, missing).playlist, undefined);
  snapshot.capture(source, live); snapshot.clear();
  assert.equal(snapshot.resolve(source, missing).playlist, undefined);
});
test("事前確認直後にパネルが消えても最新の確認URLを使い、期限は延長しない", () => {
  let now = 100;
  const snapshot = new WatchPlaylistSnapshot(() => now);
  snapshot.capture(source, live);
  now = 200;
  const latest = { ...live, playlist: new URL(live.playlist.href.replace('fixture=1','fixture=2')) };
  assert.equal(snapshot.resolve(source, latest).playlistFrom, "live");
  assert.equal(snapshot.resolve(source, missing).playlist.href, latest.playlist.href);
  now = 60100;
  assert.equal(snapshot.resolve(source, missing).playlist, undefined);
});
