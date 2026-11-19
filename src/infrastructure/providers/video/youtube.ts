import type { VideoPlatformProvider, VideoSearchResult } from "./types";

export const youtubeProvider: VideoPlatformProvider = {
  id: "youtube",
  name: "YouTube",
  searchMode: "api",
  requiresCredential: true,
  async search(query, options = {}) {
    const params = new URLSearchParams({ q: query, region: options.region || "SG", limit: String(options.limit || 10), order: options.order || "relevance" });
    const response = await fetch(`/api/local/video/youtube/search?${params.toString()}`, { signal: options.signal, cache: "no-store" });
    const payload = await response.json() as { items?: VideoSearchResult[]; error?: string; message?: string };
    if (!response.ok) throw new Error(payload.message || payload.error || "YouTube 搜索失败。");
    return payload.items || [];
  },
  async resolveUrl(input, options = {}) {
    const params = new URLSearchParams({ url: input });
    const response = await fetch(`/api/local/video/youtube/resolve?${params.toString()}`, { signal: options.signal, cache: "no-store" });
    const payload = await response.json() as { item?: VideoSearchResult; error?: string; message?: string };
    if (!response.ok) throw new Error(payload.message || payload.error || "无法读取 YouTube 视频资料。");
    return payload.item || null;
  },
  buildSearchUrl(query) { return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`; },
  buildEmbed(video, startSeconds = 0) {
    const url = new URL(`https://www.youtube-nocookie.com/embed/${video.videoId}`);
    url.searchParams.set("playsinline", "1");
    url.searchParams.set("rel", "0");
    if (startSeconds > 0) url.searchParams.set("start", String(Math.floor(startSeconds)));
    return url.toString();
  },
};
