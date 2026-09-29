declare class NicovideoClass {
  video_title: string;
  SetAllFromVideoSm(id: string): Promise<unknown>;
}

(() => {
  let url = location.href;
  let epoch = crypto.randomUUID();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slotId = 'nicopocket-entry';
  const watchId = () => location.protocol === 'https:' && location.hostname === 'www.nicovideo.jp'
    ? /^\/watch\/([a-zA-Z0-9]+)\/?$/.exec(location.pathname)?.[1] : undefined;
  async function context() {
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
  function place() {
    if (url !== location.href) { url = location.href; epoch = crypto.randomUUID(); }
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
      void context().then(data => chrome.runtime.sendMessage({ kind: 'np:add-video', ...data }))
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
  window.addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(timer); clearInterval(interval); });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.kind !== 'np:context' || sender.id !== chrome.runtime.id) return;
    void context().then(reply, () => reply({ ok: false }));
    return true;
  });
  schedule();
})();
