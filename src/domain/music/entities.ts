import type { MusicRegion, TrackRecord } from "./types.ts";
import { enrichTrackMetadata } from "./metadata.ts";
import { recordingIdentityKey, normalizeMusicText, canonicalArtistKey, artistAliases } from "./identity.ts";

export type ArtistEntity = { id: string; name: string; aliases: string[]; trackIds: string[]; trackCount: number; regions: MusicRegion[] };
export type ReleaseEntity = { id: string; title: string; artist: string; coverUrl?: string; releaseDate?: string; trackIds: string[]; trackCount: number };
export type RecordingEntity = { id: string; title: string; artist: string; versionKind: TrackRecord["versionKind"]; trackIds: string[]; sourceCount: number };

export function buildArtistEntities(input: TrackRecord[]): ArtistEntity[] {
  const groups = new Map<string, TrackRecord[]>();
  input.forEach((raw) => {
    const track = enrichTrackMetadata(raw);
    const name = track.artist?.trim() || "未知创作者";
    const id = track.artistId || `artist:${canonicalArtistKey(name)}`;
    const list = groups.get(id) || [];
    list.push(track); groups.set(id, list);
  });
  return [...groups.entries()].map(([id, tracks]) => ({
    id, name: tracks[0].artist?.trim() || "未知创作者",
    aliases: [...new Set([...artistAliases(tracks[0].artist?.trim() || "未知创作者"), ...tracks.flatMap((track) => track.tags || []).filter((tag) => /alias:/i.test(tag)).map((tag) => tag.replace(/^alias:/i, ""))])],
    trackIds: [...new Set(tracks.map((track) => track.id))], trackCount: new Set(tracks.map((track) => track.id)).size,
    regions: [...new Set(tracks.map((track) => track.region || "UNKNOWN"))],
  })).sort((a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name));
}

export function buildReleaseEntities(input: TrackRecord[]): ReleaseEntity[] {
  const groups = new Map<string, TrackRecord[]>();
  input.filter((track) => track.album?.trim()).forEach((raw) => {
    const track = enrichTrackMetadata(raw);
    const id = track.releaseId || `release:${canonicalArtistKey(track.artist || "unknown")}::${normalizeMusicText(track.album || "")}`;
    const list = groups.get(id) || []; list.push(track); groups.set(id, list);
  });
  return [...groups.entries()].map(([id, tracks]) => ({
    id, title: tracks[0].album || "未命名专辑", artist: tracks[0].artist || "未知创作者",
    coverUrl: tracks.find((track) => track.coverUrl)?.coverUrl,
    releaseDate: tracks.find((track) => track.releaseDate)?.releaseDate,
    trackIds: [...new Set(tracks.map((track) => track.id))], trackCount: new Set(tracks.map((track) => track.id)).size,
  })).sort((a, b) => a.title.localeCompare(b.title));
}

export function buildRecordingEntities(input: TrackRecord[]): RecordingEntity[] {
  const groups = new Map<string, TrackRecord[]>();
  input.forEach((track) => {
    const id = recordingIdentityKey(track);
    const list = groups.get(id) || []; list.push(track); groups.set(id, list);
  });
  return [...groups.entries()].map(([id, tracks]) => ({
    id, title: tracks[0].title, artist: tracks[0].artist || "未知创作者", versionKind: tracks[0].versionKind,
    trackIds: [...new Set(tracks.map((track) => track.id))], sourceCount: new Set(tracks.map((track) => track.provider || "local")).size,
  })).sort((a, b) => b.sourceCount - a.sourceCount);
}
