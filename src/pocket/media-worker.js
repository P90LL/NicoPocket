import createFFmpegCore from './legacy-core.js';
import { muxAac } from './media-mux.js';

// One conversion per dedicated Worker. The upstream core is loaded without changing its files.
const root = new URL('../../', self.location.href);
// The upstream loader uses chrome.runtime.getURL; dedicated Workers lack this API.
self.chrome ??= { runtime: { getURL: path => new URL(path, root).href } };
self.onmessage = async ({ data }) => {
  self.onmessage = null;
  try {
    const core = await createFFmpegCore({ noInitialRun: true, locateFile: () => new URL('dist/ffmpeg-core.wasm', root).href, print: () => {}, printErr: () => {} });
    const m4a = muxAac(core, data);
    self.postMessage({ ok: true, m4a }, [m4a.buffer]);
  } catch {
    // FFmpeg diagnostics may contain source information; expose only a generic error.
    self.postMessage({ ok: false, error: 'M4A生成に失敗しました' });
  } finally {
    self.close();
  }
};
