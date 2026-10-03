import { retainPendingSaves, restorePendingSaves, type PendingSave } from "./pending-saves.js";
import type { Job } from "./jobs.js";

type StoragePort = {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};
const key = "np:pendingSaves";

// ブラウザー再起動後も停止未確認の識別子だけを保持する。
// 旧sessionの移行・読取り・更新を直列化し、移行と解除の競合で記録を復活させない。
export class PendingSaveStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly local: StoragePort;
  private readonly session: StoragePort;
  constructor(local: StoragePort, session: StoragePort) { this.local = local; this.session = session; }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }

  private async load(): Promise<PendingSave[]> {
    const [persisted, legacy] = await Promise.all([this.local.get(key), this.session.get(key)]);
    const records = restorePendingSaves([
      ...restorePendingSaves(persisted[key]), ...restorePendingSaves(legacy[key])
    ]);
    if (legacy[key] !== undefined) {
      // 永続側の書込みが成功するまで旧記録を削除しない。
      await this.local.set({ [key]: records });
      await this.session.remove(key);
    }
    return records;
  }

  read(): Promise<PendingSave[]> { return this.serialize(() => this.load()); }

  add(record: PendingSave): Promise<void> {
    return this.serialize(async () => {
      const [fixed] = restorePendingSaves([record]);
      const records = await this.load();
      if (records.some(item => item.downloadId === fixed.downloadId && item.videoId !== fixed.videoId)) {
        throw new Error("保存の識別子が別の動画に関連付けられています。");
      }
      await this.local.set({ [key]: restorePendingSaves([...records, fixed]) });
    });
  }

  retain(jobs: Job[]): Promise<void> {
    return this.serialize(async () => {
      const records = retainPendingSaves(await this.load(), jobs);
      await this.local.set({ [key]: records });
    });
  }

  remove(downloadId: number): Promise<void> {
    return this.serialize(async () => {
      if (!Number.isSafeInteger(downloadId) || downloadId < 0) throw new Error("保存の識別子が正しくありません。");
      const records = await this.load();
      await this.local.set({ [key]: records.filter(record => record.downloadId !== downloadId) });
    });
  }
}
