import { initialCrop, type SquareCrop } from "./crop.js";

export type Detection = { box: { originX: number; originY: number; width: number; height: number };
  score: number; category: string };
export type CropSuggestion = { crop: SquareCrop; source: "center" | "detector" };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

// POC-3 で試した暫定評価式。対象画像群での品質評価を終えるまでは最終採用しない。
export function suggestCrop(width: number, height: number, detections: Detection[], enabled = true): CropSuggestion {
  const center = initialCrop(width, height);
  if (!enabled) return { crop: center, source: "center" };
  const valid = detections.filter(({ box, score }) => Number.isFinite(score) && score >= 0.5
    && [box.originX, box.originY, box.width, box.height].every(Number.isFinite)
    && box.width > 0 && box.height > 0 && box.originX >= 0 && box.originY >= 0
    && box.originX + box.width <= width && box.originY + box.height <= height);
  if (!valid.length) return { crop: center, source: "center" };

  const coverage = (crop: SquareCrop, box: Detection["box"]): number => {
    const overlapX = Math.max(0, Math.min(crop.x + crop.size, box.originX + box.width)
      - Math.max(crop.x, box.originX));
    const overlapY = Math.max(0, Math.min(crop.y + crop.size, box.originY + box.height)
      - Math.max(crop.y, box.originY));
    return overlapX * overlapY / (box.width * box.height);
  };
  const scoreCrop = (crop: SquareCrop) => valid.reduce((sum, detection) =>
    sum + detection.score * coverage(crop, detection.box), 0);
  let best: CropSuggestion = { crop: center, source: "center" };
  let bestScore = scoreCrop(center);
  for (const detection of valid) {
    const candidate: SquareCrop = {
      x: clamp(detection.box.originX + detection.box.width / 2 - center.size / 2, 0, width - center.size),
      y: clamp(detection.box.originY + detection.box.height / 2 - center.size / 2, 0, height - center.size),
      size: center.size
    };
    const value = scoreCrop(candidate);
    if (value > bestScore + 0.05 && coverage(candidate, detection.box) >= 0.75) {
      best = { crop: candidate, source: "detector" };
      bestScore = value;
    }
  }
  return best;
}
