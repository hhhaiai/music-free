import { fetchAudiusSearch, fetchAudiusTrending } from "../providers/audius.mjs";
import { fetchOpenverseAudio } from "../providers/openverse.mjs";
import { fetchInternetArchiveAudio } from "../providers/internet-archive.mjs";
import { fetchYouTubeTrendingMusic } from "../providers/youtube.mjs";

const HOUR = 60 * 60 * 1000;
function unique(tracks) {
  const map = new Map();
  for (const track of tracks) if (track?.id) map.set(track.id, track);
  return [...map.values()];
}
async function querySeeds(search, seeds, signal) {
  const batches = await Promise.allSettled(seeds.map((q) => search(q, { limit: 12, signal })));
  return {
    tracks: unique(batches.flatMap((r) => r.status === "fulfilled" ? r.value : [])),
    warnings: batches.filter((r) => r.status === "rejected").map((r) => r.reason instanceof Error ? r.reason.message : "部分关键词搜索失败"),
  };
}

export function createDiscoveryTasks({ youtubeApiKey = "" } = {}) {
  const tasks = [
    {
      id: "audius-trending", provider: "audius", intervalMs: 6 * HOUR, initialDelayMs: 0,
      run: async ({ signal }) => ({ tracks: await fetchAudiusTrending({ signal }) }),
    },
    {
      id: "audius-regional-seeds", provider: "audius", intervalMs: 12 * HOUR, initialDelayMs: 5_000,
      run: async ({ signal }) => querySeeds(fetchAudiusSearch, ["Mandopop", "K-pop", "J-pop", "Singapore pop", "Thai pop"], signal),
    },
    {
      id: "openverse-seeds", provider: "openverse", intervalMs: 24 * HOUR, initialDelayMs: 10_000,
      run: async ({ signal }) => querySeeds(fetchOpenverseAudio, ["pop vocal music", "live music performance", "Mandopop"], signal),
    },
    {
      id: "archive-open-audio", provider: "internet-archive", intervalMs: 24 * HOUR, initialDelayMs: 15_000,
      run: async ({ signal }) => querySeeds(fetchInternetArchiveAudio, ["public domain vocal music", "live concert recording"], signal),
    },
  ];
  if (youtubeApiKey) tasks.push({
    id: "youtube-music-trending", provider: "youtube", intervalMs: 12 * HOUR, initialDelayMs: 20_000, timeoutMs: 30_000,
    run: async ({ signal }) => ({ tracks: await fetchYouTubeTrendingMusic({ apiKey: youtubeApiKey, region: "SG", limit: 20, signal }) }),
  });
  return tasks;
}
