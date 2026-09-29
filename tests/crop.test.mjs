import assert from "node:assert/strict";
import { test } from "node:test";
import { centerCrop, clampCrop, initialCrop, maximizeCrop, moveCrop, resizeCropFromCorner }
  from "../.build/extension/pocket/assets/crop.js";

const inside = (crop, width, height) => {
  assert.ok(crop.x >= 0 && crop.y >= 0 && crop.size >= 1);
  assert.ok(crop.x + crop.size <= width && crop.y + crop.size <= height);
};

test("初期位置と中央復帰は正方形で、中央復帰は大きさを保つ", () => {
  assert.deepEqual(initialCrop(640, 360), { x: 140, y: 0, size: 360 });
  assert.deepEqual(centerCrop({ x: 10, y: 20, size: 100 }, 640, 360), { x: 270, y: 130, size: 100 });
  assert.deepEqual(initialCrop(400, 400), { x: 0, y: 0, size: 400 });
});

test("移動と不正な入力は画像外へ出さない", () => {
  assert.deepEqual(moveCrop({ x: 20, y: 20, size: 100 }, 1000, -1000, 640, 360),
    { x: 540, y: 0, size: 100 });
  assert.deepEqual(clampCrop({ x: -50, y: 500, size: 500 }, 640, 360),
    { x: 0, y: 0, size: 360 });
  assert.throws(() => initialCrop(0, 200));
  assert.throws(() => moveCrop({ x: 0, y: 0, size: 20 }, Number.NaN, 0, 640, 360));
});

test("四隅の操作は反対側の角を固定し、画像端で止まる", () => {
  const start = { x: 100, y: 60, size: 80 };
  const expected = {
    nw: { x: 80, y: 40, size: 100 },
    ne: { x: 100, y: 40, size: 100 },
    sw: { x: 80, y: 60, size: 100 },
    se: { x: 100, y: 60, size: 100 }
  };
  for (const [corner, crop] of Object.entries(expected)) {
    const dx = corner.endsWith("w") ? -20 : 20;
    const dy = corner.startsWith("n") ? -20 : 20;
    assert.deepEqual(resizeCropFromCorner(start, corner, dx, dy, 640, 360), crop);
    inside(resizeCropFromCorner(start, corner, dx * 100, dy * 100, 640, 360), 640, 360);
  }
});

test("最大化は現位置を基準に正方形を広げ、端では反対側へ寄せる", () => {
  assert.deepEqual(maximizeCrop({ x: 10, y: 0, size: 100 }, 640, 360),
    { x: 0, y: 0, size: 360 });
  assert.deepEqual(maximizeCrop({ x: 500, y: 200, size: 100 }, 640, 360),
    { x: 280, y: 0, size: 360 });
  inside(maximizeCrop({ x: 500, y: 200, size: 100 }, 640, 360), 640, 360);
});
