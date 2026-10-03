import { parseHlsPlaylist, type HlsPlaylist, type HlsResource, type HlsKey } from "./hls-playlist.js";
type HlsAcquisition = Readonly<{ playlist: Extract<HlsPlaylist, { kind: "media" }>;
  assets: readonly Readonly<{ resource: HlsResource; bytes: Uint8Array }>[] }>;

export type LocalHlsInput = Readonly<{ playlist: string;
  files: readonly Readonly<{ name: string; bytes: Uint8Array }>[] }>;
type MediaPlaylist = Extract<HlsPlaylist, { kind: "media" }>;
const fail = (): never => { throw new Error("同梱データの音声配信入力が正しくありません"); };
const id = (resource: HlsResource) => JSON.stringify([resource.url, resource.range?.offset, resource.range?.length]);
const namePattern = /^asset-\d{1,6}\.bin$/u;
const decimal = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) return fail();
  const text = String(value); if (!text.includes("e")) return text;
  const [mantissa, exponent] = text.split("e"), digits = mantissa.replace(".", "");
  const point = (mantissa.includes(".") ? mantissa.indexOf(".") : mantissa.length) + Number(exponent);
  return point <= 0 ? "0." + "0".repeat(-point) + digits
    : point >= digits.length ? digits + "0".repeat(point - digits.length)
      : digits.slice(0, point) + "." + digits.slice(point);
};

function render(playlist: MediaPlaylist, filename: (resource: HlsResource) => string): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6", `#EXT-X-TARGETDURATION:${playlist.targetDuration}`,
    "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD"];
  const keyLine = (key?: HlsKey, sequence?: bigint): string => {
    if (!key) return "#EXT-X-KEY:METHOD=NONE";
    const iv = key.iv ?? sequence?.toString(16).padStart(32, "0");
    if (!iv || !/^[0-9a-f]{32}$/u.test(iv)) return fail();
    return `#EXT-X-KEY:METHOD=AES-128,URI="${filename({ url: key.url })}",IV=0x${iv}`;
  };
  let previousMap: string | undefined;
  for (const segment of playlist.segments) {
    if (segment.discontinuity) lines.push("#EXT-X-DISCONTINUITY");
    if (segment.initialization) {
      const name = filename(segment.initialization), mapKey = keyLine(segment.initialization.key);
      const signature = JSON.stringify([name, mapKey]);
      if (signature !== previousMap) {
        lines.push(mapKey, `#EXT-X-MAP:URI="${name}"`); previousMap = signature;
      }
    } else if (previousMap !== undefined) return fail();
    // 外部媒体のsequenceをIVとして明示し、ローカルsequence番号の再採番で復号を変えない。
    lines.push(keyLine(segment.key, segment.sequence), `#EXTINF:${decimal(segment.duration)},`, filename(segment));
  }
  lines.push("#EXT-X-ENDLIST"); return lines.join("\n") + "\n";
}

export function localizeHlsAcquisition(acquired: HlsAcquisition): LocalHlsInput {
  const files: { name: string; bytes: Uint8Array }[] = [];
  try {
    const names = new Map<string, string>();
    for (const asset of acquired.assets) {
      if (!(asset.bytes instanceof Uint8Array) || !asset.bytes.length || names.has(id(asset.resource))) return fail();
      const name = `asset-${files.length}.bin`; names.set(id(asset.resource), name);
      files.push({ name, bytes: Uint8Array.from(asset.bytes) });
    }
    const playlist = render(acquired.playlist, resource => {
      const name = names.get(id(resource)); if (!name) return fail(); return name;
    });
    // Workerと同じ境界検査を行う。返す入力は取得計画・署名付きURLから独立する。
    return copyLocalHlsInput({ playlist, files });
  } finally {
    for (const file of files) file.bytes.fill(0);
  }
}

// 呼び出し側とWorker側の双方で再構築し、FFmpegへ渡すURIを宣言済みの生成名に限定する。
export function copyLocalHlsInput(input: LocalHlsInput): LocalHlsInput {
  const copied: { name: string; bytes: Uint8Array }[] = [];
  try {
    if (!input || typeof input.playlist !== "string" || !Array.isArray(input.files)
      || !input.files.length || input.files.length > 300000) return fail();
    const files = new Map<string, Uint8Array>();
    for (const file of input.files) {
      if (!file || !namePattern.test(file.name) || files.has(file.name)
        || !(file.bytes instanceof Uint8Array) || !file.bytes.length) return fail();
      files.set(file.name, file.bytes);
    }
    const base = "https://local-hls.invalid/";
    const playlist = parseHlsPlaylist(input.playlist, base + "source.m3u8", [base.slice(0, -1)]);
    if (playlist.kind !== "media") return fail();
    const referenced = new Set<string>();
    const filename = (resource: HlsResource): string => {
      const url = new URL(resource.url), name = url.pathname.slice(1);
      if (url.search || resource.range || !namePattern.test(name) || !files.has(name)) return fail();
      referenced.add(name); return name;
    };
    for (const segment of playlist.segments) {
      for (const resource of [segment.initialization, segment]) {
        if (!resource) continue;
        filename(resource);
        if (resource.key && files.get(filename({ url: resource.key.url }))!.length !== 16) return fail();
      }
    }
    if (referenced.size !== files.size) return fail();
    const safePlaylist = render(playlist, filename);
    for (const [name, bytes] of files) copied.push({ name, bytes: Uint8Array.from(bytes) });
    return Object.freeze({ playlist: safePlaylist, files: Object.freeze(copied.map(file => Object.freeze(file))) });
  } catch {
    for (const file of copied) file.bytes.fill(0);
    return fail();
  }
}

export function eraseLocalHlsInput(input?: LocalHlsInput): void {
  if (!Array.isArray(input?.files)) return;
  for (const file of input.files) {
    // 転送済み・不正なメッセージでも終了通知の後片付けを止めない。
    if (file?.bytes instanceof Uint8Array && file.bytes.byteLength) file.bytes.fill(0);
  }
}

// HLS demuxerが後続の失敗をskipする場合に備え、各断片を単独の有限リストとして読む。
// URIは引き続き固定生成名だけ。元の暗黙IVはcopyLocalHlsInputで既に明示化されている。
export function splitLocalHlsPlaylist(text: string): readonly string[] {
  try {
    const base = "https://local-hls.invalid/";
    const playlist = parseHlsPlaylist(text, base + "source.m3u8", [base.slice(0, -1)]);
    if (playlist.kind !== "media") return fail();
    const filename = (resource: HlsResource): string => {
      const url = new URL(resource.url), name = url.pathname.slice(1);
      if (url.search || resource.range || !namePattern.test(name)) return fail();
      return name;
    };
    return Object.freeze(playlist.segments.map(segment => render({ ...playlist, segments: [segment] }, filename)));
  } catch { return fail(); }
}
