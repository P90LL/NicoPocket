import createFFmpegCore from './legacy-core.js';
import { muxAac, compressAac, extractLocalHls } from './media-mux.js';

// One conversion per dedicated Worker. The upstream core is loaded without changing its files.
const root = new URL('../../', self.location.href);
// The upstream loader uses chrome.runtime.getURL; dedicated Workers lack this API.
self.chrome ??= { runtime: { getURL: path => new URL(path, root).href } };
self.onmessage = async ({ data }) => {
  self.onmessage = null;
  try {
    let ffmpegError = false;
    const core = await createFFmpegCore({ noInitialRun: true,
      locateFile: () => new URL('dist/ffmpeg-core.wasm', root).href,
      print: () => {}, printErr: line => { if (line?.trim()) ffmpegError = true; } });
    const bytes = data?.kind === 'compress'
      ? compressAac(core, data.aac, data.target)
      : data?.kind === 'extract-hls' ? await extractLocalHls(core, data.hls, () => ffmpegError)
      : data?.kind === 'mux' ? muxAac(core, data.input) : undefined;
    if (!bytes) throw new Error('未対応の変換です');
    self.postMessage({ ok: true, bytes }, [bytes.buffer]);
  } catch {
    // FFmpeg diagnostics may contain source information; expose only a generic error.
    self.postMessage({ ok: false, error: 'M4A生成に失敗しました' });
  } finally {
    self.close();
  }
};
