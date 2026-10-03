const initialization = /^動画の初期化処理が完了しました\s*\(([^\r\n]+)\)$/u;
const maxMessageLength = 8192;

// 呼び出し側が現在の動画に属するプレイヤー内メッセージと確認した文字列だけを渡す。
// DOM選択・動画との結び付け・ゲスト視聴の判定・通信は別途実測が必要。
// 返すURLは署名情報を含み得るため、ログ・storage・ジョブ状態へ保存しない。
export function playlistFromPlayerMessages(messages: readonly string[]): URL | undefined {
  if (!Array.isArray(messages) || messages.length > 100) return;
  let candidate: URL | undefined;
  for (const message of messages) {
    if (typeof message !== "string" || message.length > maxMessageLength) return;
    const text = message.trim();
    if (!text.startsWith("動画の初期化処理が完了しました")) continue;
    const match = initialization.exec(text);
    if (!match || /[\u0000-\u0020\u007f\\]/u.test(match[1])) return;
    let url: URL;
    try { url = new URL(match[1]); } catch { return; }
    if (url.protocol !== "https:" || url.hostname !== "delivery.domand.nicovideo.jp"
      || url.port || url.username || url.password || url.hash
      || !url.pathname.toLowerCase().endsWith(".m3u8")) return;
    // 矛盾する複数URLを見つけた場合に、古い動画のURLを勝手に選ばない。
    if (candidate && candidate.href !== url.href) return;
    candidate = url;
  }
  return candidate;
}

// 現在のプレイヤーのシステムログ内で、最新のページ表示・初期化の組を照合する。
// 日時付きの表示形式は旧プロジェクトで検証。DOMの選択は別途確認する。
export function playlistFromSystemLog(lines: readonly string[], videoId: string): URL | undefined {
  if (!/^[a-zA-Z0-9]{1,128}$/u.test(videoId) || !Array.isArray(lines) || lines.length > 1000) return;
  let currentVideo: string | undefined;
  let initializing = false;
  let messages: string[] = [];
  for (const line of lines) {
    if (typeof line !== "string" || line.length > maxMessageLength || /[\r\n]/u.test(line)) return;
    const text = line.trim().replace(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\s*:\s*/u, "");
    const page = /^([a-zA-Z0-9]{1,128}) のページを表示します(?: \([^\r\n()]+\))?$/u.exec(text);
    if (page) {
      currentVideo = page[1]; initializing = false; messages = [];
    } else if (text.includes(" のページを表示します")) {
      currentVideo = undefined; initializing = false; messages = [];
    } else if (text === "動画の初期化処理を開始します") {
      initializing = currentVideo === videoId; messages = [];
    } else if (text.startsWith("動画の初期化処理が完了しました") && initializing) {
      messages.push(text);
    }
  }
  return currentVideo === videoId && initializing ? playlistFromPlayerMessages(messages) : undefined;
}
