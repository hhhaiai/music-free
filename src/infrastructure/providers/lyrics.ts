import type { LyricLine } from "../../domain/music/types";

export type LyricsResult = {
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  instrumental?: boolean;
  trackName?: string;
  artistName?: string;
};

const headers = {
  Accept: "application/json",
  "X-User-Agent": "Music Free/3.0 (local personal music player)",
};

export async function findLyrics(title: string, artist?: string, signal?: AbortSignal): Promise<LyricsResult | null> {
  if (artist) {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const exact = await fetch(`https://lrclib.net/api/get?${params.toString()}`, { headers, signal });
    if (exact.ok) return exact.json() as Promise<LyricsResult>;
    if (exact.status === 429) {
      const retry = exact.headers.get("Retry-After");
      throw new Error(`歌词服务请求过于频繁，请${retry ? `${retry} 秒后` : "稍后"}重试。`);
    }
    if (exact.status !== 404) throw new Error(`歌词服务暂时不可用（${exact.status}）。`);
  }

  const search = new URLSearchParams({ q: `${title} ${artist || ""}`.trim() });
  const response = await fetch(`https://lrclib.net/api/search?${search.toString()}`, { headers, signal });
  if (!response.ok) {
    if (response.status === 429) throw new Error("歌词服务请求过于频繁，请稍后重试。");
    return null;
  }
  const results = await response.json() as LyricsResult[];
  if (!results.length) return null;
  const targetTitle = title.toLowerCase();
  const targetArtist = (artist || "").toLowerCase();
  return results.find((item) => item.trackName?.toLowerCase() === targetTitle && (!targetArtist || item.artistName?.toLowerCase().includes(targetArtist))) || results[0];
}

export function parseLrc(source: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const line of source.split(/\r?\n/)) {
    const matches = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    const text = line.replace(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g, "").trim();
    if (!text) continue;
    for (const match of matches) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = Number(`0.${(match[3] || "0").padEnd(3, "0")}`);
      lines.push({ time: minutes * 60 + seconds + fraction, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}
