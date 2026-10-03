import { validateJobThumbnail, type ThumbnailSnapshot } from "./job-images.js";

const databaseName = "nicopocket-job-images";
const storeName = "images";
type StoredImage = { id: string; source: Blob; jpeg: Blob; metadata: unknown };

// 独立ウィンドウの生存期間だけ使うキャッシュ。ローカルファイル名は保存しない。
export class JobImageDatabase {
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      let failed = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "id" });
      };
      request.onsuccess = () => { if (failed) request.result.close(); else resolve(request.result); };
      request.onerror = () => { failed = true; reject(request.error ?? new Error("画像キャッシュを開けません")); };
      request.onblocked = () => { failed = true; reject(new Error("画像キャッシュが別の処理で使用されています")); };
    });
  }

  private async request<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const request = action(transaction.objectStore(storeName));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = transaction.onerror = () => reject(transaction.error ?? request.error
          ?? new Error("画像キャッシュの操作に失敗しました"));
      });
    } finally { database.close(); }
  }

  async put(id: string, image: ThumbnailSnapshot): Promise<void> {
    if (!id) throw new Error("画像の識別子がありません");
    const metadata = validateJobThumbnail(image.metadata)!;
    await this.request("readwrite", (store) => store.put({ id, metadata, jpeg: image.jpeg,
      source: image.source.slice(0, image.source.size, image.source.type) } satisfies StoredImage));
  }

  async get(id: string): Promise<ThumbnailSnapshot | undefined> {
    const raw: unknown = await this.request("readonly", (store) => store.get(id));
    if (raw === undefined) return undefined;
    const record = raw as StoredImage;
    const metadata = validateJobThumbnail(record.metadata);
    if (!metadata || !(record.source instanceof Blob) || record.source.size < 1 || record.source.size > 20_000_000
      || !["image/jpeg", "image/png", "image/webp"].includes(record.source.type)
      || !(record.jpeg instanceof Blob) || record.jpeg.type !== "image/jpeg" || record.jpeg.size !== metadata.jpegBytes) {
      throw new Error("登録画像のキャッシュが正しくありません");
    }
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await record.jpeg.arrayBuffer()))]
      .map((value) => value.toString(16).padStart(2, "0")).join("");
    if (digest !== metadata.jpegSha256) throw new Error("登録画像のハッシュが一致しません");
    return Object.freeze({ source: new File([record.source], "thumbnail", { type: record.source.type }),
      jpeg: record.jpeg, metadata });
  }

  async remove(id: string): Promise<void> { await this.request("readwrite", (store) => store.delete(id)); }
  async clear(): Promise<void> { await this.request("readwrite", (store) => store.clear()); }

  async prune(keep: Set<string>): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        const cursor = transaction.objectStore(storeName).openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          if (!keep.has(String(entry.key))) entry.delete();
          entry.continue();
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(transaction.error ?? cursor.error
          ?? new Error("画像キャッシュを整理できません"));
      });
    } finally { database.close(); }
  }
}
