import type { TrackRecord } from "../../domain/music/types.ts";
import { enrichTrackMetadata } from "../../domain/music/metadata.ts";
import { MUSIC_REGIONS } from "../../domain/music/regions.ts";
import type { MusicProviderPort, MusicSearchResult } from "../ports/musicProvider.ts";

const CATEGORY_QUERIES: Record<string, string[]> = {
  "华语流行": ["Mandopop", "Chinese pop", "华语流行"],
  "粤语金曲": ["Cantopop", "Cantonese pop"],
  "欧美流行": ["Western pop", "pop rock", "R&B soul"],
  "k-pop": ["K-pop", "Korean pop"], "j-pop": ["J-pop", "Japanese pop"],
  "新马音乐": ["Singapore pop", "Malaysian pop", "Mandopop Malaysia"],
  "新加坡音乐": ["Singapore pop", "Singaporean music", "Mandopop Singapore"],
  "马来西亚音乐": ["Malaysian pop", "Mandopop Malaysia", "Malay pop"],
  "泰国流行": ["Thai pop", "T-pop"], "印尼流行": ["Indonesian pop", "Indo pop"],
  "越南流行": ["Vietnamese pop", "V-pop"], "菲律宾流行": ["Filipino pop", "OPM"],
  "抖音热歌": ["Douyin viral song", "Chinese viral pop", "Mandopop"],
  "tiktok 热歌": ["TikTok viral song", "viral pop"],
  "b站鬼畜": ["Chinese meme remix", "鬼畜 remix", "Chinese remix"],
  "鬼畜/remix": ["Chinese meme remix", "鬼畜 remix", "Chinese remix"],
  "短视频热歌": ["viral pop", "Douyin viral song", "TikTok viral song"],
  "dj remix": ["DJ remix", "dance remix"], "纯音乐": ["instrumental", "ambient instrumental", "piano solo"],
};

function expandQuery(query: string): string[] {
  const key = query.trim().toLowerCase();
  const category = CATEGORY_QUERIES[key] || CATEGORY_QUERIES[query.trim()];
  if (category) return category;
  const region = MUSIC_REGIONS.find((item) => item.label.toLowerCase() === key || item.id.toLowerCase() === key);
  return region?.queries || [query.trim()];
}

function dedupeProviderRows(tracks: TrackRecord[]): TrackRecord[] {
  const unique = new Map<string, TrackRecord>();
  for (const raw of tracks) {
    const track = enrichTrackMetadata(raw);
    // Keep distinct providers as separate playable source candidates; only remove repeated rows from the same provider.
    const key = `${track.id}::${track.provider || "unknown"}`;
    if (!unique.has(key)) unique.set(key, track);
  }
  return [...unique.values()];
}

export function createMusicDiscoveryUseCases(providers: MusicProviderPort[]) {
  const searchMusic = async (query: string, signal?: AbortSignal): Promise<MusicSearchResult> => {
    const normalized = query.trim();
    if (!normalized) return { tracks: [], warnings: ["请输入歌曲名、歌手或音乐关键词。"] };
    if (signal?.aborted) throw new DOMException("搜索已取消", "AbortError");
    const terms = [...new Set(expandQuery(normalized))].slice(0, 3);
    const warnings: string[] = [];
    const searchable = providers.filter((provider) => provider.capabilities.search);
    const settled = await Promise.all(searchable.map(async (provider) => {
      const providerTerms = provider.id === "audius" ? terms : [normalized];
      const results = await Promise.allSettled(providerTerms.map((term) => provider.search(term, provider.id === "openverse" ? 12 : 18, signal)));
      const fulfilled = results.filter((result): result is PromiseFulfilledResult<TrackRecord[]> => result.status === "fulfilled");
      const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (!fulfilled.length && failed.length) {
        return { provider, tracks: [] as TrackRecord[], error: failed[0].reason, partialFailures: failed.length };
      }
      return { provider, tracks: fulfilled.flatMap((result) => result.value), partialFailures: failed.length };
    }));
    const all: TrackRecord[] = [];
    for (const result of settled) {
      all.push(...result.tracks);
      if ("error" in result) warnings.push(`${result.provider.name}：${result.error instanceof Error ? result.error.message : "暂时不可用"}`);
      else if (result.partialFailures) warnings.push(`${result.provider.name}：部分搜索词暂时不可用。`);
    }
    return { tracks: dedupeProviderRows(all), warnings: [...new Set(warnings)] };
  };

  const discoverMusic = async (preferredSeeds: string[] = [], signal?: AbortSignal): Promise<MusicSearchResult> => {
    const providersWithTrending = providers.filter((provider) => provider.capabilities.trending && provider.trending);
    const defaults = ["Mandopop", "K-pop", "J-pop", "Southeast Asian pop", "Western pop"];
    const seeds = [...new Set([...preferredSeeds.slice(0, 2), ...defaults])].slice(0, 5);
    const warnings: string[] = [];
    const jobs: Promise<TrackRecord[]>[] = providersWithTrending.map((provider) => provider.trending!(40, signal).catch((error) => {
      warnings.push(`${provider.name} 热门：${error instanceof Error ? error.message : "暂时不可用"}`);
      return [];
    }));
    const audius = providers.find((provider) => provider.id === "audius" && provider.capabilities.search);
    if (audius) for (const seed of seeds) jobs.push(audius.search(seed, 12, signal).catch((error) => {
      warnings.push(`${seed}：${error instanceof Error ? error.message : "搜索暂时不可用"}`);
      return [];
    }));
    const all = (await Promise.all(jobs)).flat();
    const filtered = dedupeProviderRows(all).filter((track) => track.duration && track.duration >= 120 && track.vocalType !== "instrumental");
    return { tracks: filtered, warnings: [...new Set(warnings)] };
  };

  return { searchMusic, discoverMusic };
}
