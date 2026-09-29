import { addNicoPocketTags } from './m4a-tags.js';

export type MuxInput = { aac: Uint8Array; jpeg?: Uint8Array; title: string; videoId: string; sourceUrl: string };
export type LegacyCore = {
  FS: { writeFile(path: string, bytes: Uint8Array): void; readFile(path: string): Uint8Array; unlink(path: string): void };
  HEAPU8: Uint8Array;
  _malloc(size: number): number; _free(pointer: number): void;
  setValue(pointer: number, value: number, type: string): void;
  ccall(name: string, result: string, types: string[], values: number[]): number;
};

// The upstream core expects argv pointers. Allocate UTF-8 rather than ASCII so titles survive.
function execute(core: LegacyCore, args: string[]): void {
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
