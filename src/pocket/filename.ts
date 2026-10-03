// 保存名の候補だけを作る。既存ファイルとの衝突判定はダウンロード時に行う。
const encoder = new TextEncoder();
const maxStemBytes = 200;
const reservedDevice = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;

export function normalizeFileStem(rawTitle: string, videoId: string): string {
  if (!/^[a-zA-Z0-9]{1,128}$/.test(videoId)) throw new Error("動画 ID が正しくありません");
  const cleaned = rawTitle.normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").trim().replace(/^\.+/, "").replace(/[. ]+$/, "");
  let stem = "";
  for (const { segment } of new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(cleaned)) {
    if (encoder.encode(stem + segment).length > maxStemBytes) break;
    stem += segment;
  }
  stem = stem.trim().replace(/[. ]+$/, "") || videoId;
  return reservedDevice.test(stem) ? `_${stem}` : stem;
}

export function outputNames(rawTitle: string, videoId: string, sequence: number,
  saveAac: boolean, saveJpeg: boolean): { m4a: string; aac?: string; jpeg?: string } {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("連番が正しくありません");
  const suffix = sequence ? `(${sequence})` : "";
  const available = maxStemBytes - encoder.encode(suffix).length;
  let base = normalizeFileStem(rawTitle, videoId);
  if (encoder.encode(base).length > available) {
    let shortened = "";
    for (const { segment } of new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(base)) {
      if (encoder.encode(shortened + segment).length > available) break;
      shortened += segment;
    }
    base = shortened.trim().replace(/[. ]+$/, "") || videoId;
  }
  const stem = base + suffix;
  return {
    m4a: `${stem}.m4a`,
    ...(saveAac ? { aac: `${stem}.aac` } : {}),
    ...(saveJpeg ? { jpeg: `${stem}.jpg` } : {})
  };
}
