import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { watchSourceFromSender } from '../.build/extension/pocket/assets/watch-source-binding.js';
import { appendDraft, draftFromWatchUrl } from '../.build/extension/pocket/assets/state.js';

test('同一動画の再追加は編集済みタイトル・音質を上書きしない', () => {
  const edited = { ...draftFromWatchUrl('https://www.nicovideo.jp/watch/sm1', 'Original'), title: 'Edited', quality: 'limit128' };
  const before = [edited];
  const next = appendDraft(before, draftFromWatchUrl('https://www.nicovideo.jp/watch/sm1?from=share', 'Replacement'));
  assert.strictEqual(next, before);
  assert.equal(next[0].title, 'Edited'); assert.equal(next[0].quality, 'limit128');
  assert.equal(draftFromWatchUrl('https://example.org/watch/sm1', 'Invalid'), undefined);
});
test('ページの本文で取得元を偽装してもブラウザーの送信元と不一致なら拒否', () => {
  const sender = { id: 'extension', frameId: 0, documentId: 'document', tab: { id: 1 }, url: 'https://www.nicovideo.jp/watch/sm1' };
  assert.deepEqual(watchSourceFromSender(sender, 'sm1', 'epoch', 'extension'), { tabId: 1, documentId: 'document', epoch: 'epoch' });
  for (const patch of [{ frameId: 1 }, { id: 'other' }, { url: 'https://example.org/watch/sm1' }, { tab: undefined }]) {
    assert.throws(() => watchSourceFromSender({ ...sender, ...patch }, 'sm1', 'epoch', 'extension'));
  }
  assert.throws(() => watchSourceFromSender(sender, 'sm2', 'epoch', 'extension'));
});
test('ビルドはフォーク元のランタイム・Cookie設定・既存入口を維持', () => {
  const source = JSON.parse(readFileSync('nico_downloader/manifest.json'));
  const built = JSON.parse(readFileSync('.build/extension/manifest.json'));
  assert.equal(built.options_page, source.options_page);
  assert.deepEqual(built.web_accessible_resources, source.web_accessible_resources);
  assert.deepEqual(built.permissions, ['storage', 'activeTab', 'downloads']);
  for (const block of source.content_scripts) for (const file of block.js) {
    assert.deepEqual(readFileSync(`nico_downloader/${file}`), readFileSync(`.build/extension/${file}`));
  }
  assert.deepEqual(readFileSync('nico_downloader/dist/ffmpeg-core.wasm'), readFileSync('.build/extension/dist/ffmpeg-core.wasm'));
  assert.match(readFileSync('.build/extension/func/ndl.js', 'utf8'), /credentials: 'include'/);
});
