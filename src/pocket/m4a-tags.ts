// iTunes 自由記述 Atom。末尾 moov の FFmpeg 出力に限定する。
// 配布条件と他プレイヤー互換性の判断は別途必要。
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const namespace = "com.apple.iTunes";

type Box = { start: number; end: number; type: string };
export type NicoPocketTags = { niconico_id: string; source_url: string };

function boxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: Box[] = [];
  for (let offset = start; offset < end;) {
    if (offset + 8 > end) throw new Error("切り詰められた MP4 Atom です");
    const size = view.getUint32(offset);
    if (size < 8 || offset + size > end) throw new Error("未対応または不正な MP4 Atom サイズです");
    found.push({ start: offset, end: offset + size,
      type: String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) });
    offset += size;
  }
  return found;
}

function oneBox(bytes: Uint8Array, type: string, start: number, end: number): Box {
  const found = boxes(bytes, start, end).filter((entry) => entry.type === type);
  if (found.length !== 1) throw new Error(`MP4 Atom ${type} が1件ではありません`);
  return found[0];
}

function makeBox(type: string, payload: Uint8Array): Uint8Array {
  if (payload.length + 8 > 0xffffffff) throw new Error("MP4 Atom サイズが上限を超えます");
  const result = new Uint8Array(payload.length + 8);
  new DataView(result.buffer).setUint32(0, result.length);
  result.set(encoder.encode(type), 4);
  result.set(payload, 8);
  return result;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function freeform(name: keyof NicoPocketTags, value: string): Uint8Array {
  const text = encoder.encode(value);
  if (!value || text.length > 16384) throw new Error(`${name} の値が不正です`);
  return makeBox("----", concat(
    makeBox("mean", concat(new Uint8Array(4), encoder.encode(namespace))),
    makeBox("name", concat(new Uint8Array(4), encoder.encode(name))),
    makeBox("data", concat(new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0]), text))
  ));
}

function existingNames(bytes: Uint8Array, ilst: Box): Set<string> {
  const names = new Set<string>();
  for (const entry of boxes(bytes, ilst.start + 8, ilst.end)) {
    if (entry.type !== "----") continue;
    const mean = oneBox(bytes, "mean", entry.start + 8, entry.end);
    const name = oneBox(bytes, "name", entry.start + 8, entry.end);
    if (mean.end - mean.start < 12 || name.end - name.start < 12) {
      throw new Error("不正な自由記述 Atom です");
    }
    const label = decoder.decode(bytes.subarray(mean.start + 12, mean.end));
    if (label === namespace) names.add(decoder.decode(bytes.subarray(name.start + 12, name.end)));
  }
  return names;
}

export function addNicoPocketTags(m4a: Uint8Array, tags: NicoPocketTags): Uint8Array {
  const top = boxes(m4a, 0, m4a.length);
  if (top[0]?.type !== "ftyp" || !top.some((entry) => entry.type === "mdat")) {
    throw new Error("FFmpeg の M4A 出力ではありません");
  }
  const moov = oneBox(m4a, "moov", 0, m4a.length);
  if (moov.end !== m4a.length) throw new Error("末尾以外の moov は未対応です");
  const udta = oneBox(m4a, "udta", moov.start + 8, moov.end);
  const meta = oneBox(m4a, "meta", udta.start + 8, udta.end);
  if (meta.start + 12 > meta.end) throw new Error("不正な meta Atom です");
  const ilst = oneBox(m4a, "ilst", meta.start + 12, meta.end);
  const present = existingNames(m4a, ilst);
  if (present.has("niconico_id") || present.has("source_url")) {
    throw new Error("NicoPocket のタグが既に存在します");
  }
  const added = concat(freeform("niconico_id", tags.niconico_id),
    freeform("source_url", tags.source_url));
  const view = new DataView(m4a.buffer, m4a.byteOffset, m4a.byteLength);
  for (const parent of [moov, udta, meta, ilst]) {
    if (view.getUint32(parent.start) + added.length > 0xffffffff) {
      throw new Error("MP4 Atom サイズが上限を超えます");
    }
  }
  const output = concat(m4a.subarray(0, ilst.end), added, m4a.subarray(ilst.end));
  const outputView = new DataView(output.buffer);
  for (const parent of [moov, udta, meta, ilst]) {
    outputView.setUint32(parent.start, view.getUint32(parent.start) + added.length);
  }
  return output;
}
