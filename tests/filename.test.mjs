import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeFileStem, outputNames } from "../.build/extension/pocket/assets/filename.js";

test("禁則文字と空白を安全な単一ファイル名へ変換する", () => {
  assert.equal(normalizeFileStem('  A\\B / C:*?"<>|  ', "sm1"), "A B C");
  assert.equal(normalizeFileStem("..\n  ", "sm1"), "sm1");
  assert.equal(normalizeFileStem(".見出し. ", "sm1"), "見出し");
});

test("Windows の予約名と末尾のピリオドを避ける", () => {
  assert.equal(normalizeFileStem("CON", "sm1"), "_CON");
  assert.equal(normalizeFileStem("com¹.txt", "sm1"), "_com¹.txt");
  assert.equal(normalizeFileStem("題名...", "sm1"), "題名");
});

test("日本語と絵文字を途中で切らず、200 バイト以内にする", () => {
  assert.equal(normalizeFileStem("あ".repeat(100), "sm1"), "あ".repeat(66));
  assert.equal(normalizeFileStem("👩‍💻".repeat(30), "sm1"), "👩‍💻".repeat(18));
});

test("同じジョブの全成果物に同じ連番を付ける", () => {
  assert.deepEqual(outputNames("A/B", "sm1", 1, true, true), {
    m4a: "A B(1).m4a", aac: "A B(1).aac", jpeg: "A B(1).jpg"
  });
  assert.deepEqual(outputNames("", "sm1", 0, false, false), { m4a: "sm1.m4a" });
  assert.throws(() => outputNames("A", "sm1", -1, false, false));
});

test("連番を含む保存名を200バイト以内に収め、書記素を途中で切らない", () => {
  const names = outputNames("👩‍💻".repeat(30), "sm1", 12, true, true);
  const stem = names.m4a.slice(0, -4);
  assert(stem.endsWith("(12)"));
  assert(new TextEncoder().encode(stem).length <= 200);
  assert.equal(names.aac, `${stem}.aac`);
  assert.equal(names.jpeg, `${stem}.jpg`);
});
