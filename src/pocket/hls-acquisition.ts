import { createUpstreamCompatibleFetcher } from './acquisition-fetch.js';
import { chooseHlsAudio, parseHlsPlaylist, HlsPlaylistError, type HlsResource, type HlsPlaylist } from './hls-playlist.js';
import { eraseLocalHlsInput, localizeHlsAcquisition, type LocalHlsInput } from './hls-local-input.js';

type MediaPlaylist = Extract<HlsPlaylist, { kind: "media" }>;
export type HlsAsset = Readonly<{ resource: HlsResource; bytes: Uint8Array }>;
export type HlsAcquisition = Readonly<{ playlist: MediaPlaylist; assets: readonly HlsAsset[]; dispose(): Promise<void> }>;
export type HlsAcquisitionOptions = Readonly<{ allowedOrigins: readonly string[]; maxTransferBytes: number }>;
const cancelled = () => new DOMException("音声取得を中止しました", "AbortError");

// 署名URL・鍵は一時メモリに留める。通信先と転送予算は拡張機能側で決める。
export async function acquireHlsAssets(playlistURL: string, signal: AbortSignal,
  options: HlsAcquisitionOptions): Promise<HlsAcquisition> {
  if (signal.aborted) throw cancelled();
  const budget = options.maxTransferBytes;
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new HlsPlaylistError();
  const origins = [...options.allowedOrigins];
  let get: ReturnType<typeof createUpstreamCompatibleFetcher>;
  try { get = createUpstreamCompatibleFetcher(origins); } catch { throw new HlsPlaylistError(); }
  const owned = new Set<Uint8Array>(), cache = new Map<string, Uint8Array>(), assets = new Map<string, HlsAsset>();
  let transferred = 0;
  const release = async () => {
    // 成功・失敗・取消しのいずれも、取得した鍵と媒体の所有バッファを解放する。
    for (const bytes of owned) bytes.fill(0);
    owned.clear(); cache.clear(); assets.clear();
  };
  const read = async (url: string, limit: number): Promise<Uint8Array> => {
    if (signal.aborted) throw cancelled();
    const response = await get(url, signal), reader = response.body?.getReader();
    if (!reader) throw new HlsPlaylistError();
    const chunks: Uint8Array[] = []; let length = 0;
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) throw cancelled();
      for (;;) {
        const next = await reader.read();
        if (signal.aborted) throw cancelled();
        if (next.done) break;
        length += next.value.length; transferred += next.value.length;
        chunks.push(next.value);
        if (length > limit || transferred > budget) throw new HlsPlaylistError();
      }
      if (!length) throw new HlsPlaylistError();
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      owned.add(bytes); return bytes;
    } finally {
      signal.removeEventListener("abort", abort);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
      for (const chunk of chunks) chunk.fill(0);
    }
  };
  const loadPlaylist = async (url: string) => {
    const bytes = await read(url, 4 * 1024 * 1024);
    try { return parseHlsPlaylist(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), url, origins); }
    finally { bytes.fill(0); owned.delete(bytes); }
  };
  const loadResource = async (resource: HlsResource): Promise<HlsAsset> => {
    const id = JSON.stringify([resource.url, resource.range?.offset, resource.range?.length]);
    const previous = assets.get(id); if (previous) return previous;
    let whole = cache.get(resource.url);
    if (!whole) { whole = await read(resource.url, budget); cache.set(resource.url, whole); }
    const range = resource.range;
    if (range && range.offset + range.length > whole.length) throw new HlsPlaylistError();
    const bytes = range ? whole.slice(range.offset, range.offset + range.length) : whole;
    owned.add(bytes);
    const asset = Object.freeze({ resource, bytes }); assets.set(id, asset); return asset;
  };
  try {
    let playlist = await loadPlaylist(playlistURL);
    if (playlist.kind === "master") {
      playlist = await loadPlaylist(chooseHlsAudio(playlist).url);
      if (playlist.kind !== "media") throw new HlsPlaylistError();
    }
    for (const segment of playlist.segments) {
      if (signal.aborted) throw cancelled();
      for (const resource of [segment.initialization, segment]) {
        if (!resource) continue;
        if (resource.key) {
          const key = await loadResource(Object.freeze({ url: resource.key.url }));
          if (key.bytes.length !== 16) throw new HlsPlaylistError();
        }
        await loadResource(resource);
      }
    }
    if (signal.aborted) throw cancelled();
    return Object.freeze({ playlist, assets: Object.freeze([...assets.values()]), dispose: release });
  } catch {
    await release();
    if (signal.aborted) throw cancelled();
    throw new HlsPlaylistError();
  }
}

/** Convert acquired assets to the worker's local-only input, then erase URL-bearing acquisition state. */
export async function acquireLocalHlsInput(playlistURL: string, signal: AbortSignal,
  options: HlsAcquisitionOptions): Promise<{ hls: LocalHlsInput; dispose(): void }> {
  const acquired = await acquireHlsAssets(playlistURL, signal, options);
  let hls: LocalHlsInput | undefined;
  try {
    signal.throwIfAborted();
    hls = localizeHlsAcquisition(acquired);
    signal.throwIfAborted();
    const output = hls;
    return { hls: output, dispose() { eraseLocalHlsInput(output); } };
  } catch (error) {
    eraseLocalHlsInput(hls);
    throw error;
  } finally { await acquired.dispose(); }
}
