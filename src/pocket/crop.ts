// Coordinates use pixels in the original image. Every result stays within its bounds.
export type SquareCrop = { x: number; y: number; size: number };
export type Corner = "nw" | "ne" | "sw" | "se";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function dimensions(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("画像サイズが正しくありません");
  }
  return Math.min(width, height);
}

export function clampCrop(crop: SquareCrop, width: number, height: number): SquareCrop {
  const maxSize = dimensions(width, height);
  if (![crop.x, crop.y, crop.size].every(Number.isFinite)) throw new Error("クロップ座標が正しくありません");
  const size = clamp(crop.size, 1, maxSize);
  return { x: clamp(crop.x, 0, width - size), y: clamp(crop.y, 0, height - size), size };
}

export function initialCrop(width: number, height: number): SquareCrop {
  const size = dimensions(width, height);
  return { x: (width - size) / 2, y: (height - size) / 2, size };
}

export function centerCrop(crop: SquareCrop, width: number, height: number): SquareCrop {
  const { size } = clampCrop(crop, width, height);
  return { x: (width - size) / 2, y: (height - size) / 2, size };
}

export function moveCrop(crop: SquareCrop, dx: number, dy: number, width: number, height: number): SquareCrop {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error("移動量が正しくありません");
  const current = clampCrop(crop, width, height);
  return clampCrop({ ...current, x: current.x + dx, y: current.y + dy }, width, height);
}

export function resizeCropFromCorner(crop: SquareCrop, corner: Corner,
  dx: number, dy: number, width: number, height: number): SquareCrop {
  if (!["nw", "ne", "sw", "se"].includes(corner) || !Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new Error("サイズ変更の指定が正しくありません");
  }
  const current = clampCrop(crop, width, height);
  const west = corner.endsWith("w");
  const north = corner.startsWith("n");
  const anchorX = west ? current.x + current.size : current.x;
  const anchorY = north ? current.y + current.size : current.y;
  const change = Math.abs(dx) >= Math.abs(dy) ? dx * (west ? -1 : 1) : dy * (north ? -1 : 1);
  const maxSize = Math.min(west ? anchorX : width - anchorX, north ? anchorY : height - anchorY);
  const size = clamp(current.size + change, 1, maxSize);
  return { x: west ? anchorX - size : anchorX, y: north ? anchorY - size : anchorY, size };
}

export function maximizeCrop(crop: SquareCrop, width: number, height: number): SquareCrop {
  const current = clampCrop(crop, width, height);
  const size = dimensions(width, height);
  return {
    x: clamp(current.x + current.size / 2 - size / 2, 0, width - size),
    y: clamp(current.y + current.size / 2 - size / 2, 0, height - size),
    size
  };
}
