export class AcquisitionFetchError extends Error {
  constructor() { super('取得通信に失敗しました'); this.name = 'AcquisitionFetchError'; }
}

const cancelled = () => new DOMException('取得を中止しました', 'AbortError');

/** Keep upstream's credential behavior while limiting every fetch to trusted origins. */
export function createUpstreamCompatibleFetcher(allowedOrigins: readonly string[]) {
  const origins = new Set<string>();
  for (const value of allowedOrigins) {
    let url: URL;
    try { url = new URL(value); } catch { throw new AcquisitionFetchError(); }
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password || url.hostname.includes('*')) {
      throw new AcquisitionFetchError();
    }
    origins.add(value);
  }
  if (!origins.size) throw new AcquisitionFetchError();

  return async (input: string | URL, signal: AbortSignal): Promise<Response> => {
    if (signal.aborted) throw cancelled();
    let url: URL;
    try { url = new URL(input); } catch { throw new AcquisitionFetchError(); }
    if (url.protocol !== 'https:' || !origins.has(url.origin) || url.username || url.password || url.hash) {
      throw new AcquisitionFetchError();
    }
    try {
      const response = await fetch(url.href, {
        method: 'GET', credentials: 'include', mode: 'cors', cache: 'no-store',
        redirect: 'error', signal
      });
      if (signal.aborted) { void response.body?.cancel().catch(() => {}); throw cancelled(); }
      if (!response.ok || response.redirected || response.url && new URL(response.url).origin !== url.origin) {
        await response.body?.cancel().catch(() => {});
        throw new AcquisitionFetchError();
      }
      return response;
    } catch {
      if (signal.aborted) throw cancelled();
      throw new AcquisitionFetchError();
    }
  };
}
