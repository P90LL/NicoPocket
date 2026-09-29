import { clampCrop, type SquareCrop } from "./crop.js";

type EncodeRequest = { kind: "encode-jpeg"; id: string; bitmap: ImageBitmap;
  crop: SquareCrop; outputSize: number; quality: number };

self.onmessage = async ({ data }: MessageEvent<EncodeRequest>) => {
  if (data.kind !== "encode-jpeg") return;
  try {
    if (!Number.isInteger(data.outputSize) || data.outputSize < 1 || data.outputSize > 4096
      || !Number.isFinite(data.quality) || data.quality < 0 || data.quality > 1) {
      throw new Error("JPEG 出力設定が正しくありません");
    }
    const crop = clampCrop(data.crop, data.bitmap.width, data.bitmap.height);
    const canvas = new OffscreenCanvas(data.outputSize, data.outputSize);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("画像処理を開始できません");
    context.drawImage(data.bitmap, crop.x, crop.y, crop.size, crop.size,
      0, 0, data.outputSize, data.outputSize);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: data.quality });
    if (blob.type !== "image/jpeg") throw new Error("JPEG の生成に失敗しました");
    const bytes = await blob.arrayBuffer();
    self.postMessage({ kind: "encoded", id: data.id, bytes, width: data.outputSize,
      height: data.outputSize }, { transfer: [bytes] });
  } catch (error) {
    self.postMessage({ kind: "error", id: data.id, error: String(error) });
  } finally {
    data.bitmap.close();
  }
};
