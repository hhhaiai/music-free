import type { TrackRecord } from "../../domain/music/types.ts";
import type { CatalogTrackRecord } from "../../domain/music/types.ts";
import { matchesCatalogIdentity } from "../../domain/music/identity.ts";
import { rankSourceCandidates, type SourceHealthSnapshot } from "../../domain/music/sourceRanking.ts";

export type SearchMusicFunction = (query: string, signal?: AbortSignal) => Promise<{ tracks: TrackRecord[]; warnings: string[] }>;
export type CatalogResolution = { matched?: TrackRecord; candidates: TrackRecord[]; warnings: string[]; matchedLocally: boolean; sourceScores?: Array<{ trackId: string; score: number; reasons: string[] }> };

/** Resolve a catalog item without substituting an unrelated same-title recording. */
export async function resolveCatalogAudio(
  catalog: CatalogTrackRecord,
  localTracks: TrackRecord[],
  searchMusic: SearchMusicFunction,
  signal?: AbortSignal,
  healthById: Map<string, SourceHealthSnapshot> = new Map(),
): Promise<CatalogResolution> {
  const local = localTracks.find((candidate) => candidate.kind !== "remote-audio" && matchesCatalogIdentity(catalog, candidate));
  if (local) return { matched: local, candidates: [local], warnings: [], matchedLocally: true };
  const queries = [...new Set([`${catalog.title} ${catalog.artist}`, `${catalog.artist} ${catalog.title}`, catalog.title])];
  const collected = new Map<string, TrackRecord>();
  const warnings: string[] = [];
  for (const term of queries) {
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
    const result = await searchMusic(term, signal);
    result.tracks.forEach((track) => collected.set(track.id, track));
    warnings.push(...result.warnings);
    if (rankSourceCandidates(catalog, [...collected.values()], healthById).length) break;
  }
  const ranked = rankSourceCandidates(catalog, [...collected.values()], healthById);
  return {
    matched: ranked[0]?.track,
    candidates: ranked.map((item) => item.track),
    warnings: [...new Set(warnings)],
    matchedLocally: false,
    sourceScores: ranked.map((item) => ({ trackId: item.track.id, score: item.score, reasons: item.breakdown.reasons })),
  };
}
