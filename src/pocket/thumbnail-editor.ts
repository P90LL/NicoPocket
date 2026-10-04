import { centerCrop, initialCrop, maximizeCrop, moveCrop, resizeCropFromCorner,
  type Corner, type SquareCrop } from "./crop.js";
import { suggestCrop, type Detection } from "./detection-crop.js";
import type { ThumbnailSnapshot } from "./job-images.js";

type ImageState = { file: File; sourceUrl: string; width: number; height: number;
  crop: SquareCrop; previewUrl?: string; previewBlob?: Blob; analysis?: string };
type WorkerReply = { kind: "encoded"; id: string; bytes: ArrayBuffer; width: number; height: number }
  | { kind: "error"; id: string; error: string };
type DetectionReply = { kind: "result"; id: string; detections: Detection[] }
  | { kind: "error"; id: string; error: string };
type PointerDrag = { pointerId: number; x: number; y: number; crop: SquareCrop; corner?: Corner };

export class ThumbnailEditor {
  private readonly fileInput: HTMLInputElement;
  private readonly target: HTMLElement;
  private readonly status: HTMLElement;
  private readonly workspace: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly preview: HTMLImageElement;
  private readonly box: HTMLElement;
  private readonly coordinates: HTMLElement;
  private readonly autoButton: HTMLButtonElement;
  private readonly images = new Map<string, ImageState>();
  private selectedId?: string;
  private drag?: PointerDrag;
  private generation = 0;
  private loadGeneration = 0;
  private loading?: { videoId: string; generation: number };
  private stopTask?: () => void;
  private recognitionEnabled = true;
  // Image model integration is separate from FFmpeg's Wasm permission.
  private readonly recognitionAvailable = false;

  constructor(private readonly onChange: () => void) {
    const get = <T extends HTMLElement>(selector: string): T => {
      const element = document.querySelector<T>(selector);
      if (!element) throw new Error(`Thumbnail editor element is missing: ${selector}`);
      return element;
    };
    this.fileInput = get<HTMLInputElement>("#thumbnail-file");
    this.target = get("#thumbnail-target");
    this.status = get("#thumbnail-status");
    this.workspace = get("#thumbnail-workspace");
    this.image = get<HTMLImageElement>("#thumbnail-image");
    this.preview = get<HTMLImageElement>("#thumbnail-preview");
    this.box = get("#crop-box");
    this.coordinates = get("#thumbnail-coordinates");
    this.autoButton = get<HTMLButtonElement>("#crop-auto");

    this.fileInput.addEventListener("change", () => { void this.loadFile(); });
    get<HTMLButtonElement>("#crop-center").addEventListener("click", () => this.changeCrop("center"));
    get<HTMLButtonElement>("#crop-max").addEventListener("click", () => this.changeCrop("max"));
    this.autoButton.addEventListener("click", () => {
      const image = this.current();
      if (image && this.selectedId && this.recognitionEnabled) void this.analyze(this.selectedId, image);
    });
    this.box.addEventListener("pointerdown", (event) => this.startDrag(event));
    this.box.addEventListener("pointermove", (event) => this.moveDrag(event));
    this.box.addEventListener("pointerup", (event) => this.endDrag(event));
    this.box.addEventListener("pointercancel", (event) => this.endDrag(event));
    this.box.addEventListener("keydown", (event) => this.moveWithKeyboard(event));
    window.addEventListener("pagehide", () => this.dispose());
  }

  hasPreview(videoId?: string): boolean {
    return Boolean(videoId && this.images.get(videoId)?.previewUrl);
  }

  async snapshot(videoId: string): Promise<ThumbnailSnapshot | undefined> {
    if (this.loading?.videoId === videoId) throw new Error("画像の読み込みとプレビュー生成の完了後に登録してください。");
    const image = this.images.get(videoId);
    if (!image) return undefined;
    if (!image.previewBlob) throw new Error("JPEGプレビューの生成完了後に登録してください。");
    // awaitより前に値を捕まえ、後の編集・URL破棄から切り離す。
    const source = image.file, jpeg = image.previewBlob;
    const crop = Object.freeze({ ...image.crop }), width = image.width, height = image.height;
    const bytes = await jpeg.arrayBuffer();
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((value) => value.toString(16).padStart(2, "0")).join("");
    return Object.freeze({ source, jpeg, metadata: Object.freeze({ width, height, crop,
      jpegBytes: jpeg.size, jpegSha256: sha256 }) });
  }

  setRecognitionEnabled(enabled: boolean): void {
    this.recognitionEnabled = enabled && this.recognitionAvailable;
    this.autoButton.disabled = !this.recognitionEnabled || !this.current();
  }

  select(videoId?: string): void {
    const changed = videoId !== this.selectedId;
    if (changed) {
      this.stopProcessing();
      this.loadGeneration++;
      this.loading = undefined;
      this.drag = undefined;
      this.selectedId = videoId;
      this.fileInput.value = "";
    }
    this.fileInput.disabled = !videoId;
    this.target.textContent = videoId ? `選択中: ${videoId}` : "対象動画なし";
    this.render();
    const image = this.current();
    if (changed && videoId && image && !image.previewUrl) void this.encodePreview(videoId, image);
  }

  retain(videoIds: Set<string>): void {
    for (const [videoId, image] of this.images) {
      if (videoIds.has(videoId)) continue;
      if (videoId === this.selectedId) { this.stopProcessing(); this.loadGeneration++; this.loading = undefined; }
      URL.revokeObjectURL(image.sourceUrl);
      if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
      this.images.delete(videoId);
    }
  }

  render(): void {
    const image = this.current();
    this.workspace.hidden = !image;
    this.autoButton.disabled = !this.recognitionEnabled || !image;
    if (!image) {
      this.image.removeAttribute("src");
      this.preview.removeAttribute("src");
      this.preview.hidden = true;
      this.status.textContent = this.selectedId ? "画像を選択してください。" : "候補を選択してください。";
      this.coordinates.textContent = "";
      return;
    }
    if (this.image.src !== image.sourceUrl) this.image.src = image.sourceUrl;
    if (image.previewUrl) {
      this.preview.src = image.previewUrl;
      this.preview.hidden = false;
      this.status.textContent = `${image.analysis ? `${image.analysis} ` : ""}JPEGプレビューを生成しました。保存開始時にこの範囲を使用します。`;
    } else {
      this.preview.removeAttribute("src");
      this.preview.hidden = true;
    }
    this.box.style.left = `${image.crop.x / image.width * 100}%`;
    this.box.style.top = `${image.crop.y / image.height * 100}%`;
    this.box.style.width = `${image.crop.size / image.width * 100}%`;
    this.box.style.height = `${image.crop.size / image.height * 100}%`;
    this.coordinates.textContent = `x ${Math.round(image.crop.x)} · y ${Math.round(image.crop.y)} · ${Math.round(image.crop.size)} × ${Math.round(image.crop.size)} px`;
  }

  private current(): ImageState | undefined {
    return this.selectedId ? this.images.get(this.selectedId) : undefined;
  }

  private async loadFile(): Promise<void> {
    const loadGeneration = ++this.loadGeneration;
    this.loading = undefined;
    this.stopProcessing();
    const file = this.fileInput.files?.[0];
    const videoId = this.selectedId;
    if (!file || !videoId) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 20_000_000 || file.size < 1) {
      this.status.textContent = "JPEG・PNG・WebP の20 MB以下の画像を選択してください。";
      this.fileInput.value = "";
      return;
    }
    this.status.textContent = "画像を読み込み中…";
    this.loading = { videoId, generation: loadGeneration };
    try {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close();
      if (loadGeneration !== this.loadGeneration || videoId !== this.selectedId) return;
      if (width < 1 || height < 1 || width > 8192 || height > 8192) {
        throw new Error("画像の縦横は8192 px以下にしてください");
      }
      const old = this.images.get(videoId);
      if (old) {
        URL.revokeObjectURL(old.sourceUrl);
        if (old.previewUrl) URL.revokeObjectURL(old.previewUrl);
      }
      const fallback = !this.recognitionAvailable ? "画像認識は未接続のため中央クロップです。"
        : "画像認識OFFのため中央クロップです。";
      const image: ImageState = { file, sourceUrl: URL.createObjectURL(file), width, height,
        crop: initialCrop(width, height), analysis: this.recognitionEnabled ? undefined : fallback };
      this.images.set(videoId, image);
      this.render();
      const loadedCrop = image.crop;
      await this.encodePreview(videoId, image);
      if (this.recognitionEnabled && loadGeneration === this.loadGeneration
        && image.crop === loadedCrop && videoId === this.selectedId && image === this.images.get(videoId)) {
        await this.analyze(videoId, image);
      }
    } catch (error) {
      if (loadGeneration === this.loadGeneration && videoId === this.selectedId) {
        this.status.textContent = `画像を処理できません: ${String(error)}`;
      }
    } finally {
      if (this.loading?.generation === loadGeneration) this.loading = undefined;
    }
  }

  private changeCrop(action: "center" | "max"): void {
    const image = this.current();
    if (!image || !this.selectedId) return;
    image.crop = action === "center" ? centerCrop(image.crop, image.width, image.height)
      : maximizeCrop(image.crop, image.width, image.height);
    image.analysis = "手動で範囲を変更しました。";
    this.invalidatePreview(image);
    this.render();
    void this.encodePreview(this.selectedId, image);
  }

  private startDrag(event: PointerEvent): void {
    const image = this.current();
    if (!image || event.button !== 0) return;
    const corner = (event.target as Element).closest<HTMLElement>("[data-corner]")?.dataset.corner as Corner | undefined;
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      crop: { ...image.crop }, corner };
    this.box.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  private moveDrag(event: PointerEvent): void {
    const image = this.current();
    const drag = this.drag;
    if (!image || !drag || drag.pointerId !== event.pointerId) return;
    const bounds = this.image.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;
    const dx = (event.clientX - drag.x) * image.width / bounds.width;
    const dy = (event.clientY - drag.y) * image.height / bounds.height;
    image.crop = drag.corner
      ? resizeCropFromCorner(drag.crop, drag.corner, dx, dy, image.width, image.height)
      : moveCrop(drag.crop, dx, dy, image.width, image.height);
    image.analysis = "手動で範囲を変更しました。";
    this.invalidatePreview(image);
    this.render();
  }

  private endDrag(event: PointerEvent): void {
    if (this.drag?.pointerId !== event.pointerId) return;
    this.drag = undefined;
    if (this.box.hasPointerCapture(event.pointerId)) this.box.releasePointerCapture(event.pointerId);
    const image = this.current();
    if (image && this.selectedId) void this.encodePreview(this.selectedId, image);
  }

  private moveWithKeyboard(event: KeyboardEvent): void {
    const image = this.current();
    if (!image || !this.selectedId) return;
    const direction: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
    };
    const delta = direction[event.key];
    if (!delta) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const dx = delta[0] * step;
    const dy = delta[1] * step;
    const corner = (event.target as Element).closest<HTMLElement>("[data-corner]")?.dataset.corner as Corner | undefined;
    image.crop = corner
      ? resizeCropFromCorner(image.crop, corner, dx, dy, image.width, image.height)
      : moveCrop(image.crop, dx, dy, image.width, image.height);
    image.analysis = "手動で範囲を変更しました。";
    this.invalidatePreview(image);
    this.render();
    void this.encodePreview(this.selectedId, image);
  }

  private async encodePreview(videoId: string, image: ImageState): Promise<void> {
    const generation = this.stopProcessing();
    this.status.textContent = "JPEGプレビューを生成中…";
    try {
      const bitmap = await createImageBitmap(image.file);
      if (videoId !== this.selectedId || image !== this.images.get(videoId) || generation !== this.generation) {
        bitmap.close();
        return;
      }
      const response = await this.runWorker<WorkerReply>("imageWorker.js", bitmap, {
        kind: "encode-jpeg", id: `${generation}`, crop: image.crop, outputSize: 512, quality: 0.9
      }, 15_000);
      if (response.kind === "error") throw new Error(response.error);
      if (videoId !== this.selectedId || image !== this.images.get(videoId) || generation !== this.generation) return;
      const blob = new Blob([response.bytes], { type: "image/jpeg" });
      if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
      image.previewUrl = URL.createObjectURL(blob);
      image.previewBlob = blob;
      this.render();
      this.onChange();
    } catch (error) {
      if (videoId === this.selectedId && generation === this.generation) {
        this.status.textContent = `JPEGプレビューに失敗しました: ${String(error)}`;
      }
    }
  }

  private async analyze(videoId: string, image: ImageState): Promise<void> {
    if (!this.recognitionEnabled) return;
    const generation = this.stopProcessing();
    this.status.textContent = "ローカルモデルで画像を解析中…";
    let reply: DetectionReply;
    try {
      const bitmap = await createImageBitmap(image.file);
      if (videoId !== this.selectedId || image !== this.images.get(videoId) || generation !== this.generation) {
        bitmap.close();
        return;
      }
      reply = await this.runWorker<DetectionReply>("detectionWorker.js", bitmap, {
        kind: "analyze", id: `${generation}`,
        wasmRoot: chrome.runtime.getURL("vendor/mediapipe/wasm"),
        modelUrl: chrome.runtime.getURL("models/efficientdet_lite0.tflite")
      }, 30_000);
    } catch (error) {
      reply = { kind: "error", id: `${generation}`, error: String(error) };
    }
    if (videoId !== this.selectedId || image !== this.images.get(videoId) || generation !== this.generation) return;
    if (reply.kind === "error") console.warn("NicoPocket image analysis:", reply.error);
    const suggestion = suggestCrop(image.width, image.height, reply.kind === "result" ? reply.detections : []);
    image.crop = suggestion.crop;
    image.analysis = reply.kind === "error" ? "解析に失敗したため中央クロップです。"
      : suggestion.source === "detector" ? "対象を検出しました。" : "検出できなかったため中央クロップです。";
    this.invalidatePreview(image);
    this.render();
    await this.encodePreview(videoId, image);
  }

  private invalidatePreview(image: ImageState): void {
    this.stopProcessing();
    if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
    image.previewUrl = undefined;
    image.previewBlob = undefined;
    this.status.textContent = "範囲を変更中…";
    this.onChange();
  }

  private stopProcessing(): number {
    this.generation++;
    this.stopTask?.();
    this.stopTask = undefined;
    return this.generation;
  }

  private async runWorker<T extends { id: string }>(name: string, bitmap: ImageBitmap,
    message: Record<string, unknown> & { id: string }, timeoutMs: number): Promise<T> {
    let worker: Worker;
    try { worker = new Worker(chrome.runtime.getURL(`pocket/assets/${name}`), { type: "module" }); }
    catch (error) { bitmap.close(); throw error; }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (value?: T, error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
        if (this.stopTask === stop) this.stopTask = undefined;
        if (error !== undefined) reject(error);
        else resolve(value!);
      };
      const stop = () => finish(undefined, new DOMException("画像処理を中断しました", "AbortError"));
      const timer = window.setTimeout(() => finish(undefined, new Error("画像処理がタイムアウトしました")), timeoutMs);
      this.stopTask = stop;
      worker.onmessage = ({ data }: MessageEvent<T>) => {
        if (data.id === message.id) finish(data);
      };
      worker.onerror = (event) => finish(undefined, new Error(event.message));
      worker.onmessageerror = () => finish(undefined, new Error("画像処理の結果を読み取れません"));
      try { worker.postMessage({ ...message, bitmap }, [bitmap]); }
      catch (error) { bitmap.close(); finish(undefined, error); }
    });
  }

  private dispose(): void {
    this.stopProcessing();
    this.loadGeneration++;
    this.loading = undefined;
    this.selectedId = undefined;
    this.drag = undefined;
    this.image.removeAttribute("src");
    this.preview.removeAttribute("src");
    for (const image of this.images.values()) {
      URL.revokeObjectURL(image.sourceUrl);
      if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
    }
    this.images.clear();
    this.fileInput.value = "";
    this.fileInput.disabled = true;
    this.render();
  }
}
