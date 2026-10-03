import type { WatchLogSummary } from "./watch-system-log.js";

type Source = Readonly<{ videoId: string | undefined; epoch: string }>;
type Log = { playlist?: URL; summary: WatchLogSummary };
export type ResolvedWatchPlaylist = Log & { playlistFrom: "live" | "entry" | "missing";
  entryLog?: WatchLogSummary; currentLog: WatchLogSummary };

// 追加操作の前後でプレイヤーのパネルが消えても、確認済みの取得元だけを短時間引き継ぐ。
// Content Script内のメモリ専用。storage・メッセージ・ログへURLを渡さない。
export class WatchPlaylistSnapshot {
  private entry?: { source: Source; log: Log; capturedAt: number };
  private readonly now: () => number;
  private readonly maxAgeMs: number;
  constructor(now: () => number = () => performance.now(), maxAgeMs = 60_000) {
    this.now = now; this.maxAgeMs = maxAgeMs;
  }

  capture(source: Source, log: Log): void {
    this.clear();
    if (!source.videoId) return;
    this.entry = { source: { ...source }, capturedAt: this.now(),
      log: { playlist: log.playlist ? new URL(log.playlist.href) : undefined, summary: { ...log.summary } } };
  }

  resolve(source: Source, live: Log): ResolvedWatchPlaylist {
    this.expire();
    if (this.entry && (this.entry.source.videoId !== source.videoId || this.entry.source.epoch !== source.epoch)) this.clear();
    const entryLog = this.entry ? { ...this.entry.log.summary } : undefined;
    // 現在のログが存在する場合は最新の状態だけを使う。再初期化・破損を古いURLで補わない。
    if (live.summary.messages > 0) {
      if (live.playlist && this.entry) this.entry.log = {
        playlist: new URL(live.playlist.href), summary: { ...live.summary }
      };
      else this.clear();
      return { ...live, playlistFrom: live.playlist ? "live" : "missing", entryLog, currentLog: live.summary };
    }
    const captured = this.entry?.log;
    if (captured?.playlist) return { playlist: new URL(captured.playlist.href), summary: { ...captured.summary },
      playlistFrom: "entry", entryLog, currentLog: live.summary };
    return { ...live, playlistFrom: "missing", entryLog, currentLog: live.summary };
  }

  expire(): void {
    if (this.entry && (this.now() - this.entry.capturedAt < 0 || this.now() - this.entry.capturedAt >= this.maxAgeMs)) this.clear();
  }
  clear(): void { this.entry = undefined; }
}
