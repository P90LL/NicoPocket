// RFC 8216のVOD取得計画。URLは署名情報を含み得るため、計画をログ・storageへ保存しない。
export class HlsPlaylistError extends Error {
  constructor() { super("音声配信リストを処理できません"); this.name = "HlsPlaylistError"; }
}
export type HlsRange = Readonly<{ offset: number; length: number }>;
export type HlsKey = Readonly<{ url: string; iv?: string }>;
export type HlsResource = Readonly<{ url: string; range?: HlsRange; key?: HlsKey }>;
export type HlsSegment = HlsResource & Readonly<{ duration: number; sequence: bigint;
  initialization?: HlsResource; discontinuity: boolean }>;
export type HlsAudioCandidate = Readonly<{ url: string; bandwidth?: number; group?: string; name?: string }>;
export type HlsPlaylist = Readonly<{ kind: "master"; audio: readonly HlsAudioCandidate[] }>
  | Readonly<{ kind: "media"; targetDuration: number; sequence: bigint; segments: readonly HlsSegment[] }>;

const fail = (): never => { throw new HlsPlaylistError(); };
const integer = (value: string | undefined, positive = false): number => {
  if (!value || !/^\d{1,20}$/u.test(value)) return fail();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (positive ? 1 : 0)) return fail();
  return number;
};
const attributes = (text: string): Map<string, string> => {
  const values = new Map<string, string>();
  let position = 0;
  while (position < text.length) {
    const name = /^[A-Z0-9-]+=/u.exec(text.slice(position));
    if (!name) return fail();
    const key = name[0].slice(0, -1); position += name[0].length;
    if (values.has(key)) return fail();
    let value: string;
    const quoted = text[position] === '"';
    if (quoted) {
      const end = text.indexOf('"', position + 1);
      if (end < 0) return fail();
      value = text.slice(position + 1, end); position = end + 1;
    } else {
      const end = text.indexOf(",", position);
      value = text.slice(position, end < 0 ? text.length : end);
      if (!value || /[\s"]/u.test(value)) return fail();
      position = end < 0 ? text.length : end;
    }
    const quoteRequired = ["URI", "BYTERANGE", "CODECS", "GROUP-ID", "NAME", "AUDIO", "VIDEO", "KEYFORMAT", "KEYFORMATVERSIONS"];
    const quoteForbidden = ["TYPE", "METHOD", "BANDWIDTH", "AVERAGE-BANDWIDTH", "RESOLUTION", "IV", "DEFAULT", "AUTOSELECT", "FORCED"];
    if ((quoteRequired.includes(key) && !quoted) || (quoteForbidden.includes(key) && quoted)) return fail();
    values.set(key, value);
    if (position < text.length && (text[position++] !== "," || position === text.length)) return fail();
  }
  if (!values.size) return fail();
  return values;
};

export function parseHlsPlaylist(text: string, playlistURL: string, allowedOrigins: readonly string[]): HlsPlaylist {
  if (typeof text !== "string" || !text || text.length > 4 * 1024 * 1024
    || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\ufeff]/u.test(text)
    || text !== text.normalize("NFC")) return fail();
  const lines = text.split(/\r?\n/u).filter(line => line !== "");
  if (lines[0] !== "#EXTM3U" || lines.filter(line => line === "#EXTM3U").length !== 1
    || lines.length > 200000 || lines.some(line => line !== line.trim())) return fail();
  const origins = new Set(allowedOrigins);
  const resolveURI = (value: string | undefined): string => {
    if (!value || /[\u0000-\u0020\u007f\\{}]/u.test(value)) return fail();
    let url: URL;
    try { url = new URL(value, playlistURL); } catch { return fail(); }
    if (url.protocol !== "https:" || !origins.has(url.origin) || url.username || url.password || url.hash) return fail();
    return url.href;
  };
  resolveURI(playlistURL);
  const isMaster = lines.some(line => /^#EXT-X-(?:STREAM-INF:|MEDIA:|I-FRAME-STREAM-INF:|SESSION-)/u.test(line));
  if (isMaster && lines.some(line => /^#(?:EXTINF:|EXT-X-(?:TARGETDURATION:|MEDIA-SEQUENCE:|KEY:|MAP:|ENDLIST|BYTERANGE:))/u.test(line))) return fail();
  // delta・低遅延・変数置換・I-frame専用は別途検証が必要。黙って部分媒体を取得しない。
  if (lines.some(line => /^#EXT-X-(?:SKIP:|PART:|PART-INF:|PRELOAD-HINT:|DEFINE:|I-FRAMES-ONLY|GAP)/u.test(line))) return fail();
  const versionLines = lines.filter(line => line.startsWith("#EXT-X-VERSION:"));
  if (versionLines.length > 1) return fail();
  const version = versionLines.length ? integer(versionLines[0].slice(15), true) : 1;
  if (version > 7) return fail();
  if (isMaster) {
    const renditions: { group: string; name: string; url?: string }[] = [];
    const streams: { uri: string; values: Map<string, string> }[] = [];
    let pending: Map<string, string> | undefined;
    for (const line of lines.slice(1)) {
      if (line.startsWith("#EXT-X-MEDIA:")) {
        const a = attributes(line.slice(13));
        if (a.get("TYPE") === "AUDIO") {
          const group = a.get("GROUP-ID"), name = a.get("NAME");
          if (!group || !name || renditions.some(r => r.group === group && r.name === name)) return fail();
          renditions.push({ group, name, url: a.has("URI") ? resolveURI(a.get("URI")) : undefined });
        }
      } else if (line.startsWith("#EXT-X-STREAM-INF:")) {
        if (pending) return fail();
        pending = attributes(line.slice(18)); integer(pending.get("BANDWIDTH"), true);
      } else if (!line.startsWith("#")) {
        if (!pending) return fail();
        streams.push({ uri: resolveURI(line), values: pending }); pending = undefined;
      }
    }
    if (pending || !streams.length) return fail();
    const candidates: HlsAudioCandidate[] = [];
    for (const stream of streams) {
      const codecs = stream.values.get("CODECS")?.split(","), group = stream.values.get("AUDIO");
      const hasAac = codecs?.some(codec => /^mp4a\.40\.\d+$/u.test(codec));
      if (group) {
        const matching = renditions.filter(r => r.group === group);
        if (!matching.length) return fail();
        if (hasAac) for (const r of matching) if (r.url) candidates.push({ url: r.url, group, name: r.name });
      } else if (hasAac && codecs?.every(codec => /^mp4a\.40\.\d+$/u.test(codec))
        && !stream.values.has("RESOLUTION") && !stream.values.has("VIDEO")) {
        candidates.push({ url: stream.uri, bandwidth: integer(stream.values.get("BANDWIDTH"), true) });
      }
    }
    const unique = new Map<string, HlsAudioCandidate>();
    for (const candidate of candidates) {
      const previous = unique.get(candidate.url);
      const bandwidth = previous ? previous.bandwidth !== undefined && candidate.bandwidth !== undefined
        ? Math.max(previous.bandwidth, candidate.bandwidth) : undefined : candidate.bandwidth;
      unique.set(candidate.url, Object.freeze({ ...candidate, bandwidth }));
    }
    const audio = [...unique.values()];
    if (!audio.length) return fail();
    return Object.freeze({ kind: "master", audio: Object.freeze(audio) });
  }

  let targetDuration: number | undefined, sequence = 0n, sequenceSeen = false, ended = false;
  let duration: number | undefined, pendingRange: string | undefined, key: HlsKey | undefined;
  let initialization: HlsResource | undefined, discontinuity = false;
  const segments: HlsSegment[] = [];
  const range = (value: string, url: string, previous?: HlsResource): HlsRange => {
    const match = /^(\d+)(?:@(\d+))?$/u.exec(value); if (!match) return fail();
    const length = integer(match[1], true);
    const offset = match[2] !== undefined ? integer(match[2])
      : previous?.url === url && previous.range ? previous.range.offset + previous.range.length : fail();
    if (!Number.isSafeInteger(offset + length)) return fail();
    return Object.freeze({ offset, length });
  };
  for (const line of lines.slice(1)) {
    if (line === "#EXT-X-ENDLIST") { if (ended) return fail(); ended = true; }
    else if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      if (targetDuration !== undefined) return fail(); targetDuration = integer(line.slice(22), true);
    } else if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      const value = line.slice(22);
      if (sequenceSeen || segments.length || !/^\d{1,20}$/u.test(value)) return fail();
      sequence = BigInt(value); sequenceSeen = true;
      if (sequence > 18446744073709551615n) return fail();
    } else if (line.startsWith("#EXTINF:")) {
      const match = /^#EXTINF:(\d+(?:\.\d+)?),/u.exec(line);
      if (duration !== undefined || !match || (version < 3 && match[1].includes("."))) return fail();
      duration = Number(match[1]); if (!Number.isFinite(duration)) return fail();
    } else if (line.startsWith("#EXT-X-BYTERANGE:")) {
      if (pendingRange || version < 4) return fail(); pendingRange = line.slice(17);
    } else if (line === "#EXT-X-DISCONTINUITY") discontinuity = true;
    else if (line.startsWith("#EXT-X-KEY:")) {
      const a = attributes(line.slice(11)), method = a.get("METHOD");
      if (method === "NONE") { if (a.size !== 1) return fail(); key = undefined; }
      else {
        if (method !== "AES-128" || (a.has("KEYFORMAT") && a.get("KEYFORMAT") !== "identity")
          || (a.has("KEYFORMATVERSIONS") && a.get("KEYFORMATVERSIONS") !== "1")) return fail();
        const iv = a.get("IV");
        if ((iv !== undefined && (version < 2 || !/^0[xX][0-9a-fA-F]{1,32}$/u.test(iv)))
          || (version < 5 && (a.has("KEYFORMAT") || a.has("KEYFORMATVERSIONS")))) return fail();
        key = Object.freeze({ url: resolveURI(a.get("URI")), ...(iv ? { iv: iv.slice(2).padStart(32, "0").toLowerCase() } : {}) });
      }
    } else if (line.startsWith("#EXT-X-MAP:")) {
      if (version < 6 || (key && !key.iv)) return fail();
      const a = attributes(line.slice(11)), url = resolveURI(a.get("URI"));
      // MAPの省略offsetの解釈は未検証。初期化データの別範囲を黙って読むことを避ける。
      if (a.has("BYTERANGE") && !a.get("BYTERANGE")!.includes("@")) return fail();
      initialization = Object.freeze({ url, ...(a.has("BYTERANGE") ? { range: range(a.get("BYTERANGE")!, url) } : {}), ...(key ? { key } : {}) });
    } else if (line.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
      if (!["VOD", "EVENT"].includes(line.slice(21))) return fail();
    } else if (!line.startsWith("#")) {
      if (duration === undefined || segments.length >= 100000) return fail();
      const url = resolveURI(line), currentSequence = sequence + BigInt(segments.length);
      if (currentSequence > 18446744073709551615n) return fail();
      segments.push(Object.freeze({ url, duration, sequence: currentSequence, discontinuity,
        ...(pendingRange ? { range: range(pendingRange, url, segments.at(-1)) } : {}),
        ...(key ? { key } : {}), ...(initialization ? { initialization } : {}) }));
      duration = undefined; pendingRange = undefined; discontinuity = false;
    }
  }
  if (!ended || !targetDuration || !segments.length || duration !== undefined || pendingRange || discontinuity
    || segments.some(segment => Math.round(segment.duration) > targetDuration)) return fail();
  return Object.freeze({ kind: "media", targetDuration, sequence, segments: Object.freeze(segments) });
}

export function chooseHlsAudio(playlist: Extract<HlsPlaylist, { kind: "master" }>): HlsAudioCandidate {
  if (playlist.audio.length === 1) return playlist.audio[0];
  // 映像を含むBANDWIDTHを音声品質の根拠にしない。別音声の帯域不明・言語混在は勝手に選ばない。
  if (playlist.audio.some(audio => audio.bandwidth === undefined)) return fail();
  return playlist.audio.reduce((best, audio) => audio.bandwidth! > best.bandwidth! ? audio : best);
}
