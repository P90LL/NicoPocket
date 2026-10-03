import { playlistFromSystemLog } from "./watch-source-message.js";

const messageSelector = "span.c_monotone\\.L80";

export const watchLogReasons = ["ready", "no-messages", "too-many-messages", "no-initialization",
  "ambiguous-container", "row-layout", "datetime", "chronology", "page-sequence"] as const;
export type WatchLogSummary = {
  reason: typeof watchLogReasons[number];
  messages: number; initializations: number; containers: number; rows: number; adjacentTimes: number;
};

// 手動確認の結果には固定の理由と件数だけを返し、任意のサイト文字列を転記しない。
export function validateWatchLogSummary(raw: unknown): WatchLogSummary | undefined {
  if (!raw || typeof raw !== "object") return;
  const row = raw as Record<string, unknown>;
  if (!watchLogReasons.includes(row.reason as WatchLogSummary["reason"])) return;
  const counts = ["messages", "initializations", "containers", "rows", "adjacentTimes"] as const;
  if (counts.some(key => typeof row[key] !== "number" || !Number.isSafeInteger(row[key])
    || (row[key] as number) < 0 || (row[key] as number) > 1001)) return;
  return { reason: row.reason as WatchLogSummary["reason"], messages: row.messages as number,
    initializations: row.initializations as number, containers: row.containers as number,
    rows: row.rows as number, adjacentTimes: row.adjacentTimes as number };
}

function logContainer(span: HTMLSpanElement): Element | undefined {
  const fallback = span.parentElement?.parentElement;
  let parent = fallback;
  // 参考実装はメッセージのclassを使い、親の深さを固定していない。
  // 行を囲う装飾要素は許容し、ページ表示・初期化開始が揃う最も近い領域を選ぶ。
  for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
    if (["BODY", "HTML"].includes(parent.tagName)) break;
    const messages = [...parent.querySelectorAll<HTMLSpanElement>(messageSelector)];
    if (messages.length > 1000) break;
    if (messages.some(message => /^[a-zA-Z0-9]{1,128} のページを表示します(?: \([^\r\n()]+\))?$/u
      .test(message.textContent?.trim() ?? ""))
      && messages.some(message => message.textContent?.trim() === "動画の初期化処理を開始します")) return parent;
  }
  // 不完全なログは診断のために元の領域を確認するが、URLの採用条件は緩めない。
  return fallback && !["BODY", "HTML"].includes(fallback.tagName) ? fallback : undefined;
}

// ユーザーが確認したtime + spanのログ行だけを読む。ページ全体の本文やリンクは探索しない。
// ページ表示・初期化開始を含む同じログ領域を要求し、URLは呼出し中のメモリだけに保持する。
export function inspectPlayerSystemLog(document: Document, videoId: string): {
  playlist?: URL; summary: WatchLogSummary;
} {
  const spans = [...document.querySelectorAll<HTMLSpanElement>(messageSelector)];
  const summary: WatchLogSummary = { reason: "no-messages", messages: Math.min(spans.length, 1001),
    initializations: 0, containers: 0, rows: 0, adjacentTimes: 0 };
  const stop = (reason: WatchLogSummary["reason"]) => { summary.reason = reason; return { summary }; };
  if (!spans.length) return stop("no-messages");
  if (spans.length > 1000) return stop("too-many-messages");
  const containers = new Set<Element>();
  for (const span of spans) {
    if (span.textContent?.trim().startsWith("動画の初期化処理が完了しました")) {
      summary.initializations++;
      const container = logContainer(span);
      if (container) containers.add(container);
    }
  }
  summary.containers = containers.size;
  if (!summary.initializations) return stop("no-initialization");
  if (containers.size !== 1) return stop("ambiguous-container");
  const container = [...containers][0]!;
  const messages = [...container.querySelectorAll<HTMLSpanElement>(messageSelector)];
  summary.rows = Math.min(messages.length, 1001);
  if (messages.length > 1000) return stop("too-many-messages");
  summary.adjacentTimes = messages.filter(span => span.previousElementSibling?.tagName === "TIME").length;
  const lines: string[] = [];
  let previousTime = -Infinity;
  for (const span of messages) {
    const time = span.previousElementSibling;
    const row = span.parentElement;
    // 日時とメッセージが同じ1行に属することを要求する。
    if (!row || time?.tagName !== "TIME"
      || row.querySelectorAll("time").length !== 1 || row.querySelectorAll(messageSelector).length !== 1) {
      return stop("row-layout");
    }
    const datetime = time.getAttribute("datetime") ?? "";
    const timestamp = Date.parse(datetime);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(datetime)
      || !Number.isFinite(timestamp)) return stop("datetime");
    if (timestamp < previousTime) return stop("chronology");
    previousTime = timestamp;
    lines.push(span.textContent ?? "");
  }
  const playlist = playlistFromSystemLog(lines, videoId);
  if (!playlist) return stop("page-sequence");
  summary.reason = "ready";
  return { playlist, summary };
}

export function readPlayerSystemPlaylist(document: Document, videoId: string): URL | undefined {
  return inspectPlayerSystemLog(document, videoId).playlist;
}
