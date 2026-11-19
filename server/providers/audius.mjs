import { fetchJsonWithRetry } from "./http.mjs";

const BASES = ["https://discoveryprovider.audius.co/v1", "https://api.audius.co/v1"];

function text(value) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

export function normalizeAudiusItem(item, base = BASES[0]) {
  const id = text(item?.id);
  const title = text(item?.title);
  if (!id || !title || item?.is_stream_gated === true || item?.isStreamGated === true ||
      item?.is_streamable === false || item?.is_streamable === "false" ||
      item?.isStreamable === false || item?.isStreamable === "false") return null;
  const duration = Number(item.duration);
  if (Number.isFinite(duration) && duration > 0 && duration < 120) return null;
  const artist = text(item.user?.name) || text(item.user?.handle) || "";
  if (!artist) return null;
  const artwork = item.artwork || {};
  const coverUrl = text(artwork["480x480"]) || text(artwork._480x480) || text(artwork["150x150"]);
  const permalink = text(item.permalink);
  return {
    id: `audius:${id}`, title, artist, kind: "remote-audio", provider: "audius",
    remoteUrl: `${base}/tracks/${encodeURIComponent(id)}/stream`,
    sourceUrl: permalink.startsWith("https://") ? permalink : "https://audius.co",
    coverUrl: coverUrl || undefined,
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    playCount: Number.isFinite(Number(item.play_count)) ? Number(item.play_count) : undefined,
    genre: text(item.genre) || undefined,
    license: text(item.license) || "Audius 公开流媒体；请核对上传者权利声明",
    addedAt: Date.now(),
  };
}

async function requestFromBases(path, params, { timeoutMs = 12_000, signal } = {}) {
  let lastError;
  for (const base of BASES) {
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, String(value));
    try {
      const payload = await fetchJsonWithRetry(url, { timeoutMs, retries: 1, signal });
      const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.data?.data) ? payload.data.data : [];
      return items.map((item) => normalizeAudiusItem(item, base)).filter(Boolean);
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error("Audius 暂时不可用");
}

export async function fetchAudiusTrending({ timeoutMs = 12_000, signal } = {}) {
  return requestFromBases("/tracks/trending", { time: "week", limit: 40 }, { timeoutMs, signal });
}

export async function fetchAudiusSearch(query, { limit = 20, timeoutMs = 12_000, signal } = {}) {
  const term = String(query || "").trim();
  if (!term) return [];
  return requestFromBases("/tracks/search", { query: term, limit: Math.min(Math.max(limit, 1), 30) }, { timeoutMs, signal });
}
