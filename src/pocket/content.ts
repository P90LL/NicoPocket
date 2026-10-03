import { acquireLocalHlsInput } from './hls-acquisition.js';
import { inspectPlayerSystemLog } from './watch-system-log.js';
import { openPlayerSystemLog } from './watch-log-open.js';
import { WatchPlaylistSnapshot } from './watch-playlist-snapshot.js';
import { WatchHlsServer, type CurrentWatchSource } from './watch-hls-server.js';

declare class NicovideoClass {
  video_title: string;
  SetAllFromVideoSm(id: string): Promise<unknown>;
}

(() => {
  let url = location.href;
  let epoch = crypto.randomUUID();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slotId = 'nicopocket-entry';
  const snapshot = new WatchPlaylistSnapshot();
  const watchId = () => location.protocol === 'https:' && location.hostname === 'www.nicovideo.jp'
    ? /^\/watch\/([a-zA-Z0-9]+)\/?$/.exec(location.pathname)?.[1] : undefined;
  const sameSource = (source: CurrentWatchSource) => {
    const now = currentSource();
    return now.videoId === source.videoId && now.epoch === source.epoch;
  };
  const currentSource = (): CurrentWatchSource => { syncSource(); return { videoId: watchId(), epoch }; };
  function syncSource() {
    if (url === location.href) return;
    url = location.href; epoch = crypto.randomUUID(); snapshot.clear();
    void server.sourceChanged({ videoId: watchId(), epoch });
  }
  const server = new WatchHlsServer({
    extensionId: chrome.runtime.id,
    windowUrl: chrome.runtime.getURL('pocket/window.html'),
    currentSource,
    acquire: async (source, signal, maxBytes) => {
      signal.throwIfAborted();
      if (!source.videoId || !sameSource(source)) throw new Error('取得元が変更されました。');
      let live = inspectPlayerSystemLog(document, source.videoId);
      if (!live.playlist) {
        const opened = await openPlayerSystemLog(document, source.videoId, () => sameSource(source));
        if (opened) live = opened.log;
      }
      const resolved = snapshot.resolve(source, live);
      if (!sameSource(source) || !resolved.playlist) throw new Error('音声の配信元を確認できませんでした。');
      return acquireLocalHlsInput(resolved.playlist.href, signal, {
        allowedOrigins: ['https://delivery.domand.nicovideo.jp'], maxTransferBytes: maxBytes
      });
    }
  });
  async function capturePlaylist(source: CurrentWatchSource) {
    if (!source.videoId) return;
    let log = inspectPlayerSystemLog(document, source.videoId);
    if (!log.playlist) {
      const opened = await openPlayerSystemLog(document, source.videoId, () => sameSource(source));
      if (opened) log = opened.log;
    }
    if (sameSource(source)) snapshot.capture(source, log);
  }
  async function context() {
    syncSource();
    const at = location.href;
    const id = watchId();
    if (!id) throw new Error('対象の視聴ページではありません。');
    let title = document.querySelector('h1')?.textContent?.trim() || document.title;
    if (typeof NicovideoClass !== 'undefined') {
      try {
        const video = new NicovideoClass();
        await video.SetAllFromVideoSm(id);
        if (video.video_title) title = video.video_title;
      } catch { /* Keep the displayed title if the upstream metadata request fails. */ }
    }
    if (at !== location.href) throw new Error('動画が切り替わりました。');
    return { url: at, title, epoch };
  }
  async function addCurrent() {
    const data = await context();
    const source = currentSource();
    if (source.epoch !== data.epoch) throw new Error('動画が切り替わりました。');
    await capturePlaylist(source);
    if (!sameSource(source)) throw new Error('動画が切り替わりました。');
    return chrome.runtime.sendMessage({ kind: 'np:add-video', ...data });
  }
  function place() {
    syncSource();
    const existing = document.getElementById(slotId);
    if (!watchId()) { existing?.remove(); return; }
    if (existing?.isConnected) return;
    const share = [...document.querySelectorAll('button,[role="button"]')].find(el =>
      ['共有', 'シェア'].includes(el.textContent?.trim() ?? '') || el.getAttribute('aria-label') === '共有');
    const row = share?.parentElement;
    const fallback = document.getElementById('Dlink');
    const anchor = row ?? fallback;
    if (!anchor) return;
    const slot = document.createElement('div'); slot.id = slotId;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'NicoPocketで保存';
    button.addEventListener('click', () => {
      button.disabled = true;
      void addCurrent()
        .then(reply => { button.textContent = reply?.ok ? 'NicoPocketを開きました' : '追加できませんでした。再試行'; },
          () => { button.textContent = '追加できませんでした。再試行'; })
        .finally(() => { button.disabled = false; });
    });
    slot.append(button); anchor.insertAdjacentElement('afterend', slot);
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(place, 150); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const interval = setInterval(place, 2000);
  window.addEventListener('pagehide', () => {
    observer.disconnect(); clearTimeout(timer); clearInterval(interval); snapshot.clear(); void server.dispose();
  });
  chrome.runtime.onConnect.addListener(port => {
    if (!port.name.startsWith('nicopocket-hls:')) return;
    void server.accept(port).catch(() => { try { port.disconnect(); } catch { /* Already closed. */ } });
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.kind === 'np:context') void context().then(reply, () => reply({ ok: false }));
    else if (message?.kind === 'np:add-current') void addCurrent().then(reply, () => reply({ ok: false }));
    else return;
    return true;
  });
  schedule();
})();
