import type { MusicRegion, TrackRecord } from "./types.ts";
import { enrichTrackMetadata } from "./metadata.ts";
import { recordingIdentityKey } from "./identity.ts";

const STOP = new Set(["the", "and", "with", "from", "music", "audio", "unknown", "artist", "track", "official", "version"]);
function tokens(value: string): string[] {
  return value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter((token) => token.length > 1 && !STOP.has(token));
}

export type RecommendationPreferences = {
  preferredRegions?: MusicRegion[];
  preferredLanguages?: string[];
  preferVocal?: boolean;
  preferFullTracks?: boolean;
  maxPerArtist?: number;
  maxPerIdentity?: number;
};

export function buildDiscoverySeeds(library: TrackRecord[], favoriteIds: string[], history: TrackRecord[]): string[] {
  const favorites = favoriteIds.map((id) => library.find((track) => track.id === id)).filter((track): track is TrackRecord => Boolean(track));
  const artistCounts = new Map<string, number>();
  [...favorites, ...history.slice(0, 12)].forEach((track) => {
    const artist = track.artist?.trim();
    if (artist && artist.toLowerCase() !== "unknown creator") artistCounts.set(artist, (artistCounts.get(artist) || 0) + (favorites.some((item) => item.id === track.id) ? 3 : 1));
  });
  const topArtist = [...artistCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const recentArtist = history.find((track) => track.artist?.trim())?.artist;
  const seeds = [topArtist, recentArtist, "Mandopop", "K-pop", "J-pop", "Southeast Asian pop", "Western pop"].filter((value): value is string => Boolean(value));
  return [...new Set(seeds)].slice(0, 5);
}

export function scoreRecommendation(trackInput: TrackRecord, library: TrackRecord[], favoriteIds: string[], history: TrackRecord[], preferences: RecommendationPreferences = {}): number {
  const track = enrichTrackMetadata(trackInput);
  const favoriteTracks = favoriteIds.map((id) => library.find((item) => item.id === id)).filter((item): item is TrackRecord => Boolean(item));
  const taste = [...favoriteTracks, ...history.slice(0, 20)];
  const artistWeights = new Map<string, number>();
  const tokenWeights = new Map<string, number>();
  taste.forEach((item, index) => {
    const weight = favoriteTracks.some((favorite) => favorite.id === item.id) ? 3 : Math.max(0.5, 2 - index * 0.06);
    if (item.artist) artistWeights.set(item.artist.toLowerCase(), (artistWeights.get(item.artist.toLowerCase()) || 0) + weight);
    tokens(`${item.title} ${item.artist || ""}`).forEach((token) => tokenWeights.set(token, (tokenWeights.get(token) || 0) + weight));
  });
  let score = 0;
  const artist = track.artist?.toLowerCase();
  if (artist && artistWeights.has(artist)) score += Math.min(8, artistWeights.get(artist) || 0);
  tokens(`${track.title} ${track.artist || ""}`).forEach((token) => { score += Math.min(2, tokenWeights.get(token) || 0) * 0.35; });
  if (!history.slice(0, 12).some((item) => item.id === track.id)) score += 0.8;
  if (track.licenseUrl) score += 0.5;
  if ((preferences.preferVocal ?? true) && track.vocalType === "vocal") score += 2.5;
  if ((preferences.preferVocal ?? true) && track.vocalType === "instrumental") score -= 2.0;
  if ((preferences.preferFullTracks ?? true) && track.duration && track.duration >= 180) score += 0.8;
  if (track.duration && track.duration < 120) score -= 5;
  if (track.playCount) score += Math.min(1.5, Math.log10(track.playCount + 1) / 5);
  if (preferences.preferredRegions?.includes(track.region || "UNKNOWN")) score += 3;
  if (preferences.preferredLanguages?.includes(track.language || "unknown")) score += 2;
  if (["live", "cover", "remix", "karaoke", "instrumental"].includes(track.versionKind || "unknown")) score -= 0.35;
  return score;
}

export function rankRecommendations(candidates: TrackRecord[], library: TrackRecord[], favoriteIds: string[], history: TrackRecord[], preferences: RecommendationPreferences = {}): TrackRecord[] {
  const maxPerArtist = preferences.maxPerArtist ?? 3;
  const maxPerIdentity = preferences.maxPerIdentity ?? 1;
  const scored = candidates.map((raw, index) => {
    const track = enrichTrackMetadata(raw);
    return { track, score: scoreRecommendation(track, library, favoriteIds, history, preferences), index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const artistCounts = new Map<string, number>();
  const identityCounts = new Map<string, number>();
  const output: TrackRecord[] = [];
  for (const item of scored) {
    const artist = (item.track.artist || "unknown").toLocaleLowerCase();
    const identity = recordingIdentityKey(item.track);
    if ((artistCounts.get(artist) || 0) >= maxPerArtist) continue;
    if ((identityCounts.get(identity) || 0) >= maxPerIdentity) continue;
    artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1);
    output.push(item.track);
  }
  return output;
}

export function groupByArtist(tracks: TrackRecord[]): Array<{ artist: string; count: number; tracks: TrackRecord[] }> {
  const groups = new Map<string, TrackRecord[]>();
  tracks.forEach((track) => {
    const artist = track.artist?.trim() || "未知创作者";
    const items = groups.get(artist) || [];
    items.push(track); groups.set(artist, items);
  });
  return [...groups.entries()].map(([artist, items]) => ({ artist, count: items.length, tracks: items })).sort((a, b) => b.count - a.count);
}

export function groupByRegion(tracks: TrackRecord[]): Array<{ region: MusicRegion; count: number; tracks: TrackRecord[] }> {
  const groups = new Map<MusicRegion, TrackRecord[]>();
  tracks.forEach((raw) => {
    const track = enrichTrackMetadata(raw);
    const region = track.region || "UNKNOWN";
    const rows = groups.get(region) || [];
    rows.push(track); groups.set(region, rows);
  });
  return [...groups.entries()].map(([region, rows]) => ({ region, count: rows.length, tracks: rows })).sort((a, b) => b.count - a.count);
}
