import { addNicoPocketTags } from './m4a-tags.js';
import type { Quality } from './audio-quality.js';
import { inspectAdts } from './audio-quality.js';
import { copyLocalHlsInput, splitLocalHlsPlaylist, type LocalHlsInput } from './hls-local-input.js';
import { parseHlsPlaylist } from './hls-playlist.js';

export type MuxInput = { aac: Uint8Array; jpeg?: Uint8Array; title: string; videoId: string; sourceUrl: string; quality?: Quality; compressionRetries?: number; hls?: LocalHlsInput };
export type LegacyCore = {
  FS: { writeFile(path: string, bytes: Uint8Array): void; readFile(path: string): Uint8Array; unlink(path: string): void };
  HEAPU8: Uint8Array;
  _malloc(size: number): number; _free(pointer: number): void;
  setValue(pointer: number, value: number, type: string): void;
  ccall(name: string, result: string, types: string[], values: number[]): number;
};

// The upstream core expects argv pointers. Allocate UTF-8 rather than ASCII so titles survive.
export function execute(core: LegacyCore, args: string[]): void {
  const encoder = new TextEncoder(), pointers: number[] = [];
  let argv = 0;
  try {
    const values = ['ffmpeg', '-nostdin', '-y', ...args];
    argv = core._malloc(values.length * 4);
    if (!argv) throw new Error('引数領域を確保できません');
    for (let index = 0; index < values.length; index++) {
      const bytes = encoder.encode(values[index] + '\0');
      const pointer = core._malloc(bytes.length);
      if (!pointer) throw new Error('引数領域を確保できません');
      pointers.push(pointer);
      core.HEAPU8.set(bytes, pointer);
      core.setValue(argv + index * 4, pointer, 'i32');
    }
    const code = core.ccall('main', 'number', ['number', 'number'], [values.length, argv]);
    if (code !== 0) throw new Error('M4A生成に失敗しました');
  } catch (error) {
    // This Emscripten build signals a normal process exit with an ExitStatus object.
    if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 0) throw error;
  } finally {
    for (const pointer of pointers) core._free(pointer);
    if (argv) core._free(argv);
  }
}

export function muxAac(core: LegacyCore, input: MuxInput): Uint8Array {
  if (!(input.aac instanceof Uint8Array) || !input.aac.length
    || (input.jpeg !== undefined && (!(input.jpeg instanceof Uint8Array) || !input.jpeg.length))
    || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500 || input.title.includes('\0')
    || typeof input.videoId !== 'string' || !/^[a-zA-Z0-9]+$/.test(input.videoId)
    || input.sourceUrl !== `https://www.nicovideo.jp/watch/${input.videoId}`) {
    throw new Error('音声またはメタデータが不正です');
  }
  try {
    core.FS.writeFile('input.aac', input.aac);
    if (input.jpeg) core.FS.writeFile('cover.jpg', input.jpeg);
    execute(core, ['-i', 'input.aac', ...(input.jpeg ? ['-i', 'cover.jpg'] : []),
      '-map', '0:a:0', ...(input.jpeg ? ['-map', '1:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic'] : []),
      '-c:a', 'copy', '-metadata', `title=${input.title}`, '-f', 'ipod', 'output.m4a']);
    const bytes = core.FS.readFile('output.m4a').slice();
    return addNicoPocketTags(bytes, { niconico_id: input.videoId, source_url: input.sourceUrl });
  } finally {
    for (const name of ['input.aac', 'cover.jpg', 'output.m4a']) {
      try { core.FS.unlink(name); } catch { /* File may not have been created. */ }
    }
  }
}

/** Runs a single compression attempt in its own Worker/Core instance. */
export function compressAac(core: LegacyCore, aac: Uint8Array, target: 128000 | 160000): Uint8Array {
  if (!(aac instanceof Uint8Array) || !aac.length || (target !== 128000 && target !== 160000)) {
    throw new Error('圧縮入力が正しくありません');
  }
  try {
    core.FS.writeFile('input.aac', aac);
    // Give the encoder 3% headroom; the result is measured again before adoption.
    execute(core, ['-i', 'input.aac', '-vn', '-c:a', 'aac', '-b:a', String(Math.floor(target * 0.97)),
      '-f', 'adts', 'compressed.aac']);
    return core.FS.readFile('compressed.aac').slice();
  } finally {
    for (const name of ['input.aac', 'compressed.aac']) {
      try { core.FS.unlink(name); } catch { /* It may not exist after a failed command. */ }
    }
  }
}

/** Extracts AAC from a validated local-only HLS playlist. No network URI enters the core. */
export async function extractLocalHls(core: LegacyCore, source: LocalHlsInput,
  hadFfmpegError: () => boolean): Promise<Uint8Array> {
  const local = copyLocalHlsInput(source);
  const parts: Uint8Array[] = [];
  try {
    const base = 'https://local-hls.invalid/';
    const parsed = parseHlsPlaylist(local.playlist, base + 'source.m3u8', [base.slice(0, -1)]);
    if (parsed.kind !== 'media') throw new Error('HLS入力が正しくありません');
    const playlists = splitLocalHlsPlaylist(local.playlist);
    if (playlists.length !== parsed.segments.length) throw new Error('HLS音声片が正しくありません');
    const files = new Map(local.files.map(file => [file.name, file.bytes]));
    const imported = new Map<string, CryptoKey>();
    const decrypt = async (resource: { url: string; key?: { url: string; iv?: string } },
      owned: Uint8Array[]): Promise<Uint8Array | undefined> => {
      if (!resource.key) return undefined;
      const name = new URL(resource.url).pathname.slice(1);
      const keyName = new URL(resource.key.url).pathname.slice(1);
      const ciphertext = files.get(name), keyBytes = files.get(keyName), iv = resource.key.iv;
      if (!ciphertext || !keyBytes || keyBytes.length !== 16 || !iv) throw new Error('HLS暗号化入力が正しくありません');
      let key = imported.get(keyName);
      if (!key) {
        key = await crypto.subtle.importKey('raw', new Uint8Array(keyBytes), 'AES-CBC', false, ['decrypt']);
        imported.set(keyName, key);
      }
      const ivBytes = Uint8Array.from(iv.match(/.{2}/g)!, pair => parseInt(pair, 16));
      const clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: new Uint8Array(ivBytes) }, key, new Uint8Array(ciphertext)));
      owned.push(clear);
      core.FS.writeFile(name, clear);
      return clear;
    };
    for (const file of local.files) core.FS.writeFile(file.name, file.bytes);
    let total = 0;
    for (let index = 0; index < playlists.length; index++) {
      const clearBuffers: Uint8Array[] = [];
      try {
        const segment = parsed.segments[index];
        if (segment.initialization) await decrypt(segment.initialization, clearBuffers);
        const segmentClear = await decrypt(segment, clearBuffers);
        const playlist = playlists[index].replace(/^#EXT-X-KEY:METHOD=AES-128[^\n]*$/gm,
          '#EXT-X-KEY:METHOD=NONE');
        core.FS.writeFile('source.m3u8', new TextEncoder().encode(playlist));
        // One segment at a time prevents FFmpeg from hiding a failed segment behind later success.
        const name = new URL(segment.url).pathname.slice(1);
        const sourceBytes = segmentClear ?? files.get(name);
        const transportStream = sourceBytes && sourceBytes.length >= 376
          && sourceBytes[0] === 0x47 && sourceBytes[188] === 0x47;
        const inputArgs = transportStream ? ['-f', 'mpegts', '-i', name] : ['-i', 'source.m3u8'];
        execute(core, ['-hide_banner', '-loglevel', 'error',
          '-protocol_whitelist', 'file', ...(transportStream ? [] : ['-allowed_extensions', 'ALL']),
          ...inputArgs, '-map', '0:a:0', '-vn', '-c:a', 'copy', '-f', 'adts', 'part.aac']);
        if (hadFfmpegError()) throw new Error('HLS音声片に失敗があります');
        const audio = core.FS.readFile('part.aac').slice();
        const { duration } = inspectAdts(audio), expected = segment.duration;
        if (Math.abs(duration - expected) > Math.max(0.15, expected * 0.02)) {
          throw new Error('HLS音声片の長さが一致しません');
        }
        parts.push(audio); total += audio.length;
        core.FS.unlink('part.aac');
      } finally { for (const bytes of clearBuffers) bytes.fill(0); }
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { joined.set(part, offset); offset += part.length; }
    inspectAdts(joined);
    return joined;
  } finally {
    for (const name of ['source.m3u8', 'part.aac', ...local.files.map(file => file.name)]) {
      try { core.FS.unlink(name); } catch { /* Missing after a failed command. */ }
    }
    for (const file of local.files) file.bytes.fill(0);
    for (const part of parts) part.fill(0);
  }
}
