import type { SquareCrop } from "./crop.js";
import type { Job } from "./jobs.js";

export type JobThumbnail = Readonly<{ width: number; height: number; crop: Readonly<SquareCrop>;
  jpegBytes: number; jpegSha256: string }>;
export type ThumbnailSnapshot = Readonly<{ source: File; jpeg: Blob; metadata: JobThumbnail }>;

export function validateJobThumbnail(raw: unknown): JobThumbnail | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("画像情報が正しくありません");
  const data = raw as Record<string, unknown>, crop = data.crop as Record<string, unknown> | undefined;
  const width = data.width as number, height = data.height as number;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 8192 || height > 8192 || !crop || typeof crop !== "object" || Array.isArray(crop)
    || ![crop.x, crop.y, crop.size].every((value) => typeof value === "number" && Number.isFinite(value))
    || (crop.x as number) < 0 || (crop.y as number) < 0 || (crop.size as number) < 1
    || (crop.x as number) + (crop.size as number) > width + 1e-8
    || (crop.y as number) + (crop.size as number) > height + 1e-8
    || !Number.isInteger(data.jpegBytes) || (data.jpegBytes as number) < 1 || (data.jpegBytes as number) > 20_000_000
    || typeof data.jpegSha256 !== "string" || !/^[a-f0-9]{64}$/.test(data.jpegSha256)) {
    throw new Error("画像情報が正しくありません");
  }
  return Object.freeze({ width, height, crop: Object.freeze({ x: crop.x as number,
    y: crop.y as number, size: crop.size as number }), jpegBytes: data.jpegBytes as number,
    jpegSha256: data.jpegSha256 });
}

// Blob/Fileは不変。URLを保持せず、登録時の画像を候補編集から独立させる。
export class JobImages {
  private readonly entries = new Map<string, { image: ThumbnailSnapshot; registered: boolean;
    timer?: ReturnType<typeof setTimeout> }>();
  private disposed = false;
  private readonly onRelease?: (id: string) => void;
  constructor(onRelease?: (id: string) => void) { this.onRelease = onRelease; }

  has(id: string): boolean { return this.entries.has(id); }
  ids(): string[] { return [...this.entries.keys()]; }

  reserve(id: string, snapshot: ThumbnailSnapshot): void {
    if (this.disposed || !id || this.entries.has(id)) throw new Error("画像の登録状態が正しくありません");
    const metadata = validateJobThumbnail(snapshot.metadata)!;
    if (!(snapshot.source instanceof File) || !(snapshot.jpeg instanceof Blob)
      || snapshot.jpeg.type !== "image/jpeg" || snapshot.jpeg.size !== metadata.jpegBytes) {
      throw new Error("登録する画像が正しくありません");
    }
    const entry = { image: Object.freeze({ source: snapshot.source, jpeg: snapshot.jpeg, metadata }),
      registered: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    // Service Workerが登録途中で停止した場合も仮予約を残し続けない。
    entry.timer = setTimeout(() => this.release(id), 30_000);
    this.entries.set(id, entry);
  }

  commit(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.registered = true;
    clearTimeout(entry.timer); entry.timer = undefined;
    return true;
  }

  get(id: string): ThumbnailSnapshot | undefined {
    const entry = this.entries.get(id);
    return entry?.registered ? entry.image : undefined;
  }

  sync(jobs: Pick<Job, "id" | "status">[]): void {
    const byId = new Map(jobs.map((job) => [job.id, job]));
    for (const [id, entry] of this.entries) {
      const job = byId.get(id);
      if (job) {
        this.commit(id);
        if (job.status === "complete" || job.status === "warning") this.release(id);
      } else if (entry.registered) this.release(id);
    }
  }

  release(id: string): void {
    const entry = this.entries.get(id);
    if (entry) clearTimeout(entry.timer);
    this.entries.delete(id);
    if (entry) this.onRelease?.(id);
  }

  dispose(): void {
    this.disposed = true;
    // pagehideは再読み込みでも発生する。永続キャッシュの消去はウィンドウ終了側で行う。
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    this.entries.clear();
  }
}
