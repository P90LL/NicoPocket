import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyLocalHlsInput, eraseLocalHlsInput } from '../.build/extension/pocket/assets/hls-local-input.js';

const playlist = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:2\n'
  + '#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:1,\nasset-0.bin\n#EXT-X-ENDLIST\n';

test('HLS Worker入力はローカル資産名だけを採用し、外部参照と欠落を拒否', () => {
  const source = { playlist, files: [{ name: 'asset-0.bin', bytes: new Uint8Array([1,2,3]) }] };
  const copied = copyLocalHlsInput(source);
  assert.notEqual(copied.files[0].bytes, source.files[0].bytes);
  assert.throws(() => copyLocalHlsInput({ ...source, playlist: playlist.replace('asset-0.bin',
    'https://example.org/audio.bin') }));
  assert.throws(() => copyLocalHlsInput({ ...source, files: [] }));
  assert.throws(() => copyLocalHlsInput({ ...source, files: [...source.files, ...source.files] }));
  eraseLocalHlsInput(copied);
  assert.deepEqual([...copied.files[0].bytes], [0,0,0]);
  assert.deepEqual([...source.files[0].bytes], [1,2,3]);
});
