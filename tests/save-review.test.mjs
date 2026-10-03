import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmSaveEnded, inspectOwnSave } from '../.build/extension/pocket/assets/save-review.js';

const own = 'blob:chrome-extension://test-extension/12345678-1234-1234-1234-123456789abc';
function install(t, item) {
  const previous = globalThis.chrome;
  const reads = [];
  globalThis.chrome = { runtime: { id: 'test-extension', getURL: path => `chrome-extension://test-extension/${path}` },
    downloads: { search: async query => { reads.push(query); if (item instanceof Error) throw item; return item ? [item] : []; } } };
  t.after(() => { globalThis.chrome = previous; });
  return reads;
}

test('自拡張機能のBlob保存IDだけを保持し、終了後だけ解除する', async t => {
  const item = { id: 7, url: own, finalUrl: own, byExtensionId: 'test-extension', state: 'in_progress' };
  const reads = install(t, item);
  assert.equal((await inspectOwnSave(7)).id, 7);
  await assert.rejects(confirmSaveEnded(7));
  item.state = 'complete';
  await confirmSaveEnded(7);
  assert.deepEqual(reads, [{ id: 7 }, { id: 7 }, { id: 7 }]);
});

test('履歴消失・他拡張・外部URL・名義欠損を通常の保存として認めない', async t => {
  for (const item of [null, new Error('private detail'), { id: 8, url: own, byExtensionId: 'test-extension', state: 'complete' },
    { id: 7, url: own, byExtensionId: 'other', state: 'complete' },
    { id: 7, url: 'https://example.invalid/media', byExtensionId: 'test-extension', state: 'complete' },
    { id: 7, url: own, state: 'complete' }, { id: 7, url: `${own}?secret=x`, state: 'complete' }]) {
    install(t, item);
    await assert.rejects(inspectOwnSave(7));
  }
});

test('再起動後の識別子照合だけ、自拡張Blob元で名義欠損を補う', async t => {
  install(t, { id: 7, url: own, finalUrl: own, state: 'interrupted' });
  await assert.rejects(confirmSaveEnded(7));
  await confirmSaveEnded(7, true);
});
