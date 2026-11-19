import type { VideoPlatformProvider, VideoSearchResult } from "./types";

export const bilibiliProvider: VideoPlatformProvider = {
  id: "bilibili",
  name: "Bilibili",
  searchMode: "external",
  requiresCredential: false,
  async resolveUrl(input, options = {}) {
    const params = new URLSearchParams({ url: input });
    const response = await fetch(`/api/local/video/bilibili/resolve?${params.toString()}`, { signal: options.signal, cache: "no-store" });
    const payload = await response.json() as { item?: VideoSearchResult; error?: string; message?: string };
    if (!response.ok) throw new Error(payload.message || payload.error || "无法识别 Bilibili 视频链接。");
    return payload.item || null;
  },
  buildSearchUrl(query) { return `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`; },
  buildEmbed(video, startSeconds = 0) {
    const url = new URL("https://player.bilibili.com/player.html");
    url.searchParams.set("bvid", video.videoId);
    url.searchParams.set("autoplay", "0");
    url.searchParams.set("danmaku", "0");
    if (startSeconds > 0) url.searchParams.set("t", String(Math.floor(startSeconds)));
    return url.toString();
  },
};
