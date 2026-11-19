import { fetchJsonWithRetry } from "./http.mjs";

const API_BASE = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeVideoId(input) {
  let url;
  try { url = new URL(String(input || "").trim()); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;
  let id = "";
  if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
  else if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
  else {
    const match = url.pathname.match(/^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
    id = match?.[1] || "";
  }
  return VIDEO_ID.test(id) ? id : null;
}

export function parseMediaStartSeconds(input) {
  let url;
  try { url = new URL(String(input || "")); } catch { return 0; }
  const raw = url.searchParams.get("t") || url.searchParams.get("start") || "0";
  if (/^\d+$/.test(raw)) return Math.max(0, Number(raw));
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match) return 0;
  return Math.max(0, Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0));
}

export function parseIsoDuration(value) {
  if (typeof value !== "string") return 0;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function thumbnail(snippet = {}) {
  return snippet.thumbnails?.maxres?.url || snippet.thumbnails?.standard?.url ||
    snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || undefined;
}

function toResult(item, details) {
  const id = item?.id?.videoId;
  const snippet = details?.snippet || item?.snippet || {};
  if (!VIDEO_ID.test(id || "")) return null;
  const durationSeconds = parseIsoDuration(details?.contentDetails?.duration);
  if (durationSeconds < 120 || details?.status?.embeddable !== true) return null;
  return {
    id: `youtube:${id}`,
    videoId: id,
    platform: "youtube",
    title: String(snippet.title || "YouTube video"),
    creator: String(snippet.channelTitle || "Unknown channel"),
    durationSeconds,
    thumbnailUrl: thumbnail(snippet),
    watchUrl: `https://www.youtube.com/watch?v=${id}`,
    publishedAt: snippet.publishedAt || undefined,
    viewCount: Number.isFinite(Number(details?.statistics?.viewCount)) ? Number(details.statistics.viewCount) : undefined,
    liveBroadcastContent: snippet.liveBroadcastContent || "none",
    embed: { kind: "official-embed", url: `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0` },
    metadataAvailable: true,
  };
}

export async function searchYouTubeVideos(query, {
  apiKey,
  region = "SG",
  limit = 10,
  order = "relevance",
  signal,
  fetchImpl = fetch,
} = {}) {
  const term = String(query || "").trim();
  if (!term) throw new Error("请输入视频或音乐关键词。");
  if (term.length > 120) throw new Error("搜索关键词不能超过 120 个字符。");
  if (!apiKey) throw new Error("尚未配置 YouTube Data API Key；可直接使用官方搜索页并粘贴视频链接，无需 API Key。");
  const safeRegion = /^[A-Z]{2}$/.test(String(region).toUpperCase()) ? String(region).toUpperCase() : "SG";
  const maxResults = Math.min(Math.max(Number(limit) || 10, 1), 10);
  const safeOrder = ["relevance", "date", "viewCount", "rating"].includes(order) ? order : "relevance";

  const searchUrl = new URL(`${API_BASE}/search`);
  Object.entries({ part: "snippet", q: term, type: "video", videoEmbeddable: "true", regionCode: safeRegion,
    relevanceLanguage: "zh-Hans", safeSearch: "moderate", order: safeOrder, maxResults, key: apiKey }).forEach(([k, v]) => searchUrl.searchParams.set(k, String(v)));
  const searchPayload = await fetchJsonWithRetry(searchUrl, { signal, timeoutMs: 12_000, retries: 1, fetchImpl });
  const candidates = (searchPayload.items || []).filter((item) => item?.id?.kind === "youtube#video" && VIDEO_ID.test(item?.id?.videoId || ""));
  const ids = [...new Set(candidates.map((item) => item.id.videoId))];
  if (!ids.length) return [];

  const detailsUrl = new URL(`${API_BASE}/videos`);
  Object.entries({ part: "snippet,contentDetails,statistics,status", id: ids.join(","), key: apiKey }).forEach(([k, v]) => detailsUrl.searchParams.set(k, String(v)));
  const detailsPayload = await fetchJsonWithRetry(detailsUrl, { signal, timeoutMs: 12_000, retries: 1, fetchImpl });
  const detailById = new Map((detailsPayload.items || []).map((item) => [item.id, item]));
  return candidates.flatMap((item) => {
    const result = toResult(item, detailById.get(item.id.videoId));
    return result ? [result] : [];
  });
}

export async function fetchYouTubeTrendingMusic({ apiKey, region = "SG", limit = 20, signal, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("YouTube Data API Key 未配置。");
  const url = new URL(`${API_BASE}/videos`);
  Object.entries({ part: "snippet,contentDetails,statistics,status", chart: "mostPopular", regionCode: region,
    videoCategoryId: "10", maxResults: Math.min(Math.max(Number(limit) || 20, 1), 50), key: apiKey }).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const payload = await fetchJsonWithRetry(url, { signal, timeoutMs: 12_000, retries: 1, fetchImpl });
  return (payload.items || []).flatMap((detail) => {
    const item = { id: { videoId: detail.id }, snippet: detail.snippet };
    const result = toResult(item, detail);
    return result ? [result] : [];
  });
}

export async function resolveYouTubeVideoUrl(input, { signal, fetchImpl = fetch } = {}) {
  const videoId = parseYouTubeVideoId(input);
  if (!videoId) throw new Error("请输入有效的 YouTube 视频链接（watch、youtu.be、shorts、live 或 embed）。");
  const startSeconds = parseMediaStartSeconds(input);
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const oembedUrl = new URL("https://www.youtube.com/oembed");
  oembedUrl.searchParams.set("url", canonicalUrl);
  oembedUrl.searchParams.set("format", "json");
  const metadata = await fetchJsonWithRetry(oembedUrl, { signal, timeoutMs: 10_000, retries: 1, fetchImpl });
  return {
    id: `youtube:${videoId}`,
    videoId,
    platform: "youtube",
    title: String(metadata.title || "YouTube video"),
    creator: String(metadata.author_name || "Unknown channel"),
    thumbnailUrl: String(metadata.thumbnail_url || "") || undefined,
    watchUrl: canonicalUrl,
    embed: { kind: "official-embed", url: `https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1&rel=0${startSeconds ? `&start=${startSeconds}` : ""}`, startSeconds },
    metadataAvailable: true,
  };
}
