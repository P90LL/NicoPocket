import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings, restoreSettings, validateSettingsPatch } from "../.build/extension/pocket/assets/state.js";

test("保存済み設定の正常値は変更しない", () => {
  const original = { ...defaultSettings, defaultTheme: "dark", concurrency: 12, warningSeconds: 10 };
  const restored = restoreSettings(original);
  assert.deepEqual(restored, { settings: original, repaired: false });
  assert.notStrictEqual(restored.settings, original);
});

test("欠損・不正値・未知のキーだけを初期値へ補正する", () => {
  const restored = restoreSettings({ defaultTheme: "dark", defaultQuality: "limit128",
    concurrency: 9, warningSeconds: 10, unknown: "remove" });
  assert.equal(restored.repaired, true);
  assert.deepEqual(restored.settings, { ...defaultSettings, defaultTheme: "dark",
    defaultQuality: "limit128", warningSeconds: 10 });
  assert.deepEqual(restoreSettings(null), { settings: defaultSettings, repaired: true });
});

test("操作時の不正な設定値は引き続き拒否する", () => {
  assert.throws(() => validateSettingsPatch({ concurrency: 9 }));
  assert.throws(() => validateSettingsPatch({ unknown: 1 }));
  assert.deepEqual(validateSettingsPatch({ concurrency: 12 }), { concurrency: 12 });
});
