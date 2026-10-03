import assert from "node:assert/strict";
import test from "node:test";
import { playlistFromPlayerMessages, playlistFromSystemLog } from "../.build/pocket/assets/watch-source-message.js";

// 合成文字列だけ。これらのURLへアクセスしない。
const fixture = "https://delivery.domand.nicovideo.jp/hls/synthetic/master.m3u8?fixture=1";
const message = url => `動画の初期化処理が完了しました (${url})`;

test("既知形式の単一URLを解析し、署名付きqueryを勝手に変更しない", () => {
  const result = playlistFromPlayerMessages(["音声の読み込みを開始しました", "  " + message(fixture) + "  "]);
  assert.equal(result?.href, fixture);
  assert.equal(playlistFromPlayerMessages([message(fixture), message(fixture)])?.href, fixture);
});

test("異なる動画の候補が混ざった場合に最後のURLを勝手に選ばない", () => {
  const other = fixture.replace("synthetic", "another-synthetic");
  assert.equal(playlistFromPlayerMessages([message(fixture), message(other)]), undefined);
  assert.equal(playlistFromPlayerMessages([message(other), message(fixture)]), undefined);
});

test("HTTP・外部host・偽suffix・資格情報・異なるport・fragment・別形式を拒否する", () => {
  for (const url of [fixture.replace("https:", "http:"), fixture.replace("delivery.domand.nicovideo.jp", "example.invalid"),
    fixture.replace("delivery.domand.nicovideo.jp", "delivery.domand.nicovideo.jp.example.invalid"),
    fixture.replace("https://", "https://name:synthetic@"), fixture.replace("nicovideo.jp", "nicovideo.jp:8443"),
    fixture + "#fragment", fixture.replace("master.m3u8", "script.js"), fixture.replace("master.m3u8", "master.m3u8/segment.js"),
    fixture.replace("https://", "https:\\\\"), fixture + "\nignored", fixture + "\u0000"]) {
    assert.equal(playlistFromPlayerMessages([message(url)]), undefined, url);
  }
});

test("引用や不完全なメッセージはURL候補にせず、初期化メッセージの破損は閉じて失敗する", () => {
  for (const text of ["引用: " + message(fixture), "URL: " + fixture, "動画の初期化処理が完了しました",
    message(fixture) + " 余分な本文", message(fixture).replace(" (", " ( ")]) {
    assert.equal(playlistFromPlayerMessages([text]), undefined);
  }
  assert.equal(playlistFromPlayerMessages([message(fixture), "動画の初期化処理が完了しました"]), undefined);
});

test("空・非文字列・過大な入力を拒否し、入力を変更しない", () => {
  const original = Object.freeze([message(fixture)]);
  assert.equal(playlistFromPlayerMessages(original)?.href, fixture);
  assert.equal(playlistFromPlayerMessages([]), undefined);
  assert.equal(playlistFromPlayerMessages([null]), undefined);
  assert.equal(playlistFromPlayerMessages([message(fixture), "a".repeat(8193)]), undefined);
  assert.equal(playlistFromPlayerMessages(Array(101).fill(message(fixture))), undefined);
});

const log = (id, url = fixture) => [
  "2026/09/29 10:37:47 : ユーザー情報: guest",
  `2026/09/29 10:37:47 : ${id} のページを表示します (synthetic-session)`,
  "2026/09/29 10:37:47 : 動画の初期化処理を開始します",
  "2026/09/29 10:37:48 : 現在の画質 (自動, Video: video-h264-720p, Audio: audio-aac-192kbps, Time: 0)",
  "2026/09/29 10:37:49 : " + message(url),
  "2026/09/29 10:37:56 : 動画の再生準備が完了しました"
];

test("提供されたログの構造で日時と動画IDを照合する（URL・IDは合成）", () => {
  const lines = Object.freeze(log("sm100"));
  assert.equal(playlistFromSystemLog(lines, "sm100")?.href, fixture);
  assert.equal(playlistFromSystemLog(lines, "sm200"), undefined);
});

test("SPA遷移後は最新ページと初期化だけを採用する", () => {
  const next = fixture.replace("synthetic", "new-synthetic");
  assert.equal(playlistFromSystemLog([...log("sm100"), ...log("sm200", next)], "sm100"), undefined);
  assert.equal(playlistFromSystemLog([...log("sm100"), ...log("sm200", next)], "sm200")?.href, next);
  assert.equal(playlistFromSystemLog([...log("sm100"), ...log("sm200").slice(0, 4)], "sm200"), undefined);
});

test("同じ動画の再初期化中に古いURLを再使用しない", () => {
  assert.equal(playlistFromSystemLog([...log("sm100"), "動画の初期化処理を開始します"], "sm100"), undefined);
  assert.equal(playlistFromSystemLog([...log("sm100"), ...log("sm100").slice(0, 4)], "sm100"), undefined);
});

test("ページ表示・初期化開始の欠落、順序逆転、引用を拒否する", () => {
  for (const lines of [[message(fixture)], log("sm100").filter((_, i) => i !== 1),
    log("sm100").filter((_, i) => i !== 2), [message(fixture), ...log("sm100").slice(0, 4)],
    [...log("sm100").slice(0, 4), "引用: " + message(fixture)]]) {
    assert.equal(playlistFromSystemLog(lines, "sm100"), undefined);
  }
});

test("最新初期化の複数URL・破損URL・過大ログを拒否する", () => {
  assert.equal(playlistFromSystemLog([...log("sm100"), message(fixture + "&other=1")], "sm100"), undefined);
  assert.equal(playlistFromSystemLog([...log("sm100"), "動画の初期化処理が完了しました"], "sm100"), undefined);
  assert.equal(playlistFromSystemLog(log("sm100", fixture.replace("https:", "http:")), "sm100"), undefined);
  assert.equal(playlistFromSystemLog([...log("sm100"), null], "sm100"), undefined);
  assert.equal(playlistFromSystemLog(Array(1001).fill(""), "sm100"), undefined);
  assert.equal(playlistFromSystemLog(log("sm100"), "sm100/path"), undefined);
  assert.equal(playlistFromSystemLog([...log("sm100"), "sm200 のページを表示します (broken"], "sm100"), undefined);
});
