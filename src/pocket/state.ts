import type { WatchSourceBinding } from "./watch-source-binding.js";

export interface VideoDraft {
  videoId: string;
  sourceUrl: string;
  title: string;
  addedAt: number;
  quality: Settings["defaultQuality"];
  saveAac: boolean;
  saveJpeg: boolean;
  sourceTab?: WatchSourceBinding;
}

export interface Settings {
  defaultTheme: "light" | "dark";
  defaultQuality: "best" | "limit160" | "limit128";
  detectThumbnail: boolean;
  saveAac: boolean;
  saveJpeg: boolean;
  concurrency: number;
  compressionRetries: number;
  warningSeconds: 5 | 10;
}

export const defaultSettings: Settings = {
  defaultTheme: "light",
  defaultQuality: "best",
  detectThumbnail: true,
  saveAac: false,
  saveJpeg: false,
  concurrency: 10,
  compressionRetries: 3,
  warningSeconds: 5
};

const settingKeys = Object.keys(defaultSettings) as (keyof Settings)[];

function validSettingValue(key: string, value: unknown): boolean {
  return key === "defaultTheme" ? value === "light" || value === "dark"
    : key === "defaultQuality" ? ["best", "limit160", "limit128"].includes(value as string)
    : ["detectThumbnail", "saveAac", "saveJpeg"].includes(key) ? typeof value === "boolean"
    : key === "concurrency" ? Number.isInteger(value) && Number(value) >= 10 && Number(value) <= 50
    : key === "compressionRetries" ? Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5
    : key === "warningSeconds" ? value === 5 || value === 10
    : false;
}

export function restoreSettings(raw: unknown): { settings: Settings; repaired: boolean } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { settings: { ...defaultSettings }, repaired: true };
  }
  const stored = raw as Record<string, unknown>;
  const settings: Settings = { ...defaultSettings };
  for (const key of settingKeys) {
    if (validSettingValue(key, stored[key])) Object.assign(settings, { [key]: stored[key] });
  }
  const repaired = Object.keys(stored).some((key) => !settingKeys.includes(key as keyof Settings))
    || settingKeys.some((key) => stored[key] !== settings[key]);
  return { settings, repaired };
}

export function validateSettingsPatch(raw: unknown): Partial<Settings> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("設定の形式が正しくありません");
  }
  const patch = raw as Record<string, unknown>;
  if (Object.keys(patch).some((key) => !settingKeys.includes(key as keyof Settings))) {
    throw new Error("不明な設定項目があります");
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!validSettingValue(key, value)) throw new Error(`設定値が範囲外です: ${key}`);
  }
  return patch as Partial<Settings>;
}

export function draftFromWatchUrl(rawUrl: string, title: string,
  settings: Settings = defaultSettings): VideoDraft | undefined {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return undefined; }
  if (url.protocol !== "https:" || url.hostname !== "www.nicovideo.jp") return undefined;
  const match = /^\/watch\/([a-zA-Z0-9]+)\/?$/.exec(url.pathname);
  if (!match) return undefined;
  const videoId = match[1];
  return {
    videoId,
    sourceUrl: `https://www.nicovideo.jp/watch/${videoId}`,
    title: title.trim().slice(0, 500) || videoId,
    addedAt: Date.now(),
    quality: settings.defaultQuality,
    saveAac: settings.saveAac,
    saveJpeg: settings.saveJpeg
  };
}

export function appendDraft(drafts: VideoDraft[], candidate: VideoDraft): VideoDraft[] {
  return drafts.some((draft) => draft.videoId === candidate.videoId) ? drafts : [...drafts, candidate];
}
