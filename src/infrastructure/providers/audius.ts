import type { TrackRecord } from "../../domain/music/types";

// Audius documents read-only search/trending/stream endpoints without credentials;
// an API key raises rate limits but is not required for basic read-only use.
const BASES = ["https://discoveryprovider.audius.co/v1", "https://api.audius.co/v1"];
const MIN_FULL_TRACK_SECONDS = 120;

type AudiusTrack = {
  id?: string | number;
  title?: string;
  duration?: number;
  genre?: string;
  mood?: string;
  tags?: string | string[];
  description?: string;
  permalink?: string;
  release_date?: string;
  releaseDate?: string;
  play_count?: number;
  playCount?: number;
  favorite_count?: number;
  is_streamable?: boolean | string;
  isStreamable?: boolean | string;
  is_stream_gated?: boolean;
  isStreamGated?: boolean;
  license?: string;
  artwork?: Record<string, string>;
  user?: { name?: string; handle?: string; id?: string | number };
};

type AudiusResponse = { data?: AudiusTrack[] | { data?: AudiusTrack[] } };

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function asTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function classifyVocal(track: AudiusTrack): "vocal" | "instrumental" | "unknown" {
  const text = [track.title, track.genre, track.mood, track.description, ...asTags(track.tags)]
    .filter(Boolean).join(" ").toLowerCase();
  const instrumental = /\b(instrumental|karaoke|backing track|piano solo|solo piano|ambient|soundscape|white noise|nature sounds|meditation|study beats|no vocals|beat tape)\b|纯音乐|伴奏|无人声|钢琴独奏|白噪音|自然音效/.test(text);
  if (instrumental) return "instrumental";
  const vocal = /\b(vocal|singer|lyrics|pop|rock|hip-hop|rap|r&b|soul|country|folk|k-pop|j-pop|mandopop|cantopop|t-pop|opm|ballad)\b|人声|流行|歌曲|演唱|华语|粤语|日语|韩语|马来语|泰语|印尼语|越南语|菲律宾/.test(text);
  return vocal ? "vocal" : "unknown";
}

async function request<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<{ payload: T; base: string }> {
  let lastError: Error | null = null;
  for (const base of BASES) {
    const url = new URL(`${base}${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    try {
      const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Audius 请求失败（${response.status}）`);
      return { payload: await response.json() as T, base };
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error instanceof Error ? error : new Error("Audius 暂时不可用");
    }
  }
  throw lastError || new Error("Audius 暂时不可用");
}

function normalizeTrack(item: AudiusTrack, base: string): TrackRecord | null {
  const id = asText(item.id);
  const duration = Number(item.duration);
  const streamableFlag = item.is_streamable ?? item.isStreamable;
  const explicitlyNotStreamable = streamableFlag === false || streamableFlag === "false";
  const gated = isTrue(item.is_stream_gated ?? item.isStreamGated);
  // Reject explicit unavailable/gated tracks and known short clips. Missing streamability
  // or duration metadata is not enough to discard a search result; the player verifies it.
  if (!id || explicitlyNotStreamable || gated || (Number.isFinite(duration) && duration > 0 && duration < MIN_FULL_TRACK_SECONDS)) return null;

  const title = asText(item.title) || "未命名歌曲";
  const artist = asText(item.user?.name) || asText(item.user?.handle) || "Audius 创作者";
  const permalink = asText(item.permalink);
  const sourceUrl = permalink.startsWith("https://")
    ? permalink
    : permalink.startsWith("/") ? `https://audius.co${permalink}` : `https://audius.co`;
  const artwork = item.artwork || {};
  const coverUrl = artwork["480x480"] || artwork._480x480 || artwork["150x150"] || artwork._150x150;
  const tags = asTags(item.tags);
  const genre = asText(item.genre);
  const releaseDate = asText(item.release_date) || asText(item.releaseDate);
  const playCount = Number(item.play_count ?? item.playCount ?? 0);
  const vocalType = classifyVocal(item);

  return {
    id: `audius:${id}`,
    title,
    artist,
    kind: "remote-audio",
    provider: "audius",
    remoteUrl: `${base}/tracks/${encodeURIComponent(id)}/stream`,
    sourceUrl,
    coverUrl,
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    genre: genre || undefined,
    tags,
    playCount: Number.isFinite(playCount) ? playCount : undefined,
    releaseDate: releaseDate || undefined,
    vocalType,
    license: asText(item.license) || "Audius 平台公开流媒体；上传者权利声明需以原页面为准",
    attribution: artist,
    addedAt: Date.now(),
  };
}

function extractData(payload: AudiusResponse): AudiusTrack[] {
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && Array.isArray(payload.data.data)) return payload.data.data;
  return [];
}

export async function searchAudius(query: string, limit = 18, signal?: AbortSignal): Promise<TrackRecord[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const { payload, base } = await request<AudiusResponse>("/tracks/search", {
    query: normalized,
    limit: String(Math.min(Math.max(limit, 1), 30)),
    sort_method: "popular",
  }, signal);
  return extractData(payload).map((item) => normalizeTrack(item, base)).filter((item): item is TrackRecord => Boolean(item));
}

export async function getAudiusTrending(limit = 30, signal?: AbortSignal): Promise<TrackRecord[]> {
  const { payload, base } = await request<AudiusResponse>("/tracks/trending", {
    time: "week",
    limit: String(Math.min(Math.max(limit, 1), 50)),
  }, signal);
  return extractData(payload).map((item) => normalizeTrack(item, base)).filter((item): item is TrackRecord => Boolean(item));
}
