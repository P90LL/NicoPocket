import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addNicoPocketTags } from '../.build/extension/pocket/assets/m4a-tags.js';
import { muxAac } from '../.build/extension/pocket/assets/media-mux.js';

test('切り詰め・未対応サイズのM4Aはタグ追加せず拒否する', () => {
  const tags = { niconico_id: 'sm100', source_url: 'https://www.nicovideo.jp/watch/sm100' };
  for (const bytes of [new Uint8Array(), new Uint8Array([0,0,0,16,102,116,121,112]),
    new Uint8Array([0,0,0,1,102,116,121,112])]) {
    const before = bytes.slice();
    assert.throws(() => addNicoPocketTags(bytes, tags));
    assert.deepEqual(bytes, before);
  }
});
test('不正なタグ・取得元はFFmpegへ渡さない', () => {
  const input = { aac: new Uint8Array([1]), title: '合成', videoId: 'sm100', sourceUrl: 'https://www.nicovideo.jp/watch/sm100' };
  const core = { FS: { writeFile() { assert.fail('Invalid input reached FFmpeg'); } } };
  for (const patch of [{ title: 'bad\0title' }, { title: '' }, { videoId: undefined },
    { sourceUrl: 'https://example.org/watch/sm100' }, { aac: new Uint8Array() }]) {
    assert.throws(() => muxAac(core, { ...input, ...patch }), /不正/);
  }
});
test('FFmpeg失敗時も引数領域と一時ファイルを解放する', () => {
  const allocated = [], freed = [], erased = [];
  let position = 8;
  const core = {
    FS: { writeFile() {}, readFile() { assert.fail('Failed output read'); }, unlink(path) { erased.push(path); } },
    HEAPU8: new Uint8Array(8192), setValue() {}, ccall() { return 1; },
    _malloc(size) { const pointer = position; position += size; allocated.push(pointer); return pointer; },
    _free(pointer) { freed.push(pointer); }
  };
  assert.throws(() => muxAac(core, { aac: new Uint8Array([1]), title: '合成', videoId: 'sm100',
    sourceUrl: 'https://www.nicovideo.jp/watch/sm100' }), /失敗/);
  assert.deepEqual([...freed].sort((a,b)=>a-b), allocated);
  assert.deepEqual(erased, ['input.aac', 'cover.jpg', 'output.m4a']);
});
