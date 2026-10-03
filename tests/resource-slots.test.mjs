import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ResourceSlots } from '../.build/extension/pocket/assets/resource-slots.js';

test('入力保持枠は解放まで次の取得を待たせ、重複解放でも枠を増やさない', async () => {
  const slots = new ResourceSlots(2);
  const release1 = await slots.acquire(new AbortController().signal);
  const release2 = await slots.acquire(new AbortController().signal);
  let entered = false;
  const third = slots.acquire(new AbortController().signal).then(release => { entered = true; return release; });
  await Promise.resolve();
  assert.equal(entered, false);
  release1();
  const release3 = await third;
  assert.equal(entered, true);
  release1();
  let fourthEntered = false;
  const fourth = slots.acquire(new AbortController().signal).then(release => { fourthEntered = true; return release; });
  await Promise.resolve();
  assert.equal(fourthEntered, false);
  release2();
  (await fourth)(); release3();
});

test('待機中の取消しは取得を開始せず、後続の枠を妨げない', async () => {
  const slots = new ResourceSlots(1);
  const release = await slots.acquire(new AbortController().signal);
  const controller = new AbortController();
  const cancelled = slots.acquire(controller.signal);
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(cancelled, error => error.name === 'AbortError');
  const next = slots.acquire(new AbortController().signal);
  release();
  (await next)();
});
