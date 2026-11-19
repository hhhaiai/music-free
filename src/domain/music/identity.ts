import type { CatalogTrackRecord, TrackRecord, TrackVersionKind } from "./types.ts";
import { classifyTrackVersion as classifyVersion } from "./metadata.ts";

const TITLE_ALIAS_GROUPS: string[][] = [
  ["黄昏", "黃昏", "Huang Hun"],
  ["星星", "Звезда", "Zvezda"],
  ["庙堂之外", "廟堂之外"],
  ["雪落下的声音", "雪落下的聲音"],
];

const ARTIST_ALIAS_GROUPS: string[][] = [
  ["周传雄", "周傳雄", "Zhou Chuanxiong", "Steve Chou", "Xiao Gang", "小刚"],
  ["陈升", "陳升", "Bobby Chen", "Chen Sheng"],
  ["陈楚生", "陳楚生", "Chen Chusheng"],
  ["维塔斯", "維塔斯", "Vitas", "Витас"],
  ["陆虎", "陸虎", "路虎", "Lu Hu", "Tiger Lu"],
];

export function normalizeMusicText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function normalizeMusicTitle(value: string): string {
  const normalized = normalizeMusicText(value);
  const aliases = TITLE_ALIAS_GROUPS.find((group) => group.some((item) => normalizeMusicText(item) === normalized));
  return aliases ? normalizeMusicText(aliases[0]) : normalized;
}

function artistParts(value: string): string[] {
  return value.split(/\s*(?:,|，|、|&|\/|;|\bfeat\.?\b|\bft\.?\b|\bwith\b)\s*/i)
    .map(normalizeMusicText).filter(Boolean);
}

function aliasesFor(value: string): Set<string> {
  const normalized = normalizeMusicText(value);
  const group = ARTIST_ALIAS_GROUPS.find((items) => items.some((item) => normalizeMusicText(item) === normalized));
  return new Set([normalized, ...(group || []).map(normalizeMusicText)]);
}

export function canonicalArtistKey(value: string): string {
  const normalized = normalizeMusicText(value);
  const group = ARTIST_ALIAS_GROUPS.find((items) => items.some((item) => normalizeMusicText(item) === normalized));
  return normalizeMusicText(group?.[0] || value);
}

export function artistAliases(value: string): string[] {
  const normalized = normalizeMusicText(value);
  const group = ARTIST_ALIAS_GROUPS.find((items) => items.some((item) => normalizeMusicText(item) === normalized));
  return group ? [...group] : [value];
}

/** Strict artist match: exact normalized credit or a curated alias; no substring guesses. */
export function artistNamesMatch(expected: string, actual: string): boolean {
  const expectedParts = artistParts(expected);
  const actualParts = artistParts(actual);
  if (!expectedParts.length || !actualParts.length) return false;
  return expectedParts.some((part) => {
    const aliases = aliasesFor(part);
    return actualParts.some((candidate) => aliases.has(candidate) || aliasesFor(candidate).has(part));
  });
}

export function classifyTrackVersion(track: Pick<TrackRecord, "title" | "album" | "versionKind" | "tags">): TrackVersionKind {
  return classifyVersion(track).kind;
}

export function recordingIdentityKey(track: Pick<TrackRecord, "recordingId" | "title" | "artist" | "versionKind" | "album" | "tags">): string {
  if (track.recordingId) return `recording:${track.recordingId.toLowerCase()}`;
  const version = classifyTrackVersion(track);
  return `${normalizeMusicTitle(track.title)}::${canonicalArtistKey(track.artist || "") }::${version}`;
}

export function sameTrackIdentity(left: TrackRecord, right: TrackRecord): boolean {
  if (left.recordingId || right.recordingId) return Boolean(left.recordingId && right.recordingId && left.recordingId === right.recordingId);
  if (normalizeMusicTitle(left.title) !== normalizeMusicTitle(right.title)) return false;
  if (!left.artist || !right.artist || !artistNamesMatch(left.artist, right.artist)) return false;
  return classifyTrackVersion(left) === classifyTrackVersion(right);
}

export function matchesCatalogIdentity(catalog: Pick<CatalogTrackRecord, "title" | "artist" | "duration" | "versionKind">, candidate: TrackRecord): boolean {
  if (normalizeMusicTitle(candidate.title) !== normalizeMusicTitle(catalog.title)) return false;
  if (!candidate.artist || !artistNamesMatch(catalog.artist, candidate.artist)) return false;
  if (catalog.duration && candidate.duration && Math.abs(catalog.duration - candidate.duration) > 90) return false;
  const expectedVersion = catalog.versionKind || "unknown";
  const actualVersion = classifyTrackVersion(candidate);
  // An unrequested remix/live/cover must never silently replace a studio recording.
  if (["live", "cover", "remix", "karaoke", "instrumental"].includes(actualVersion) && actualVersion !== expectedVersion) return false;
  if (["live", "cover", "remix", "karaoke", "instrumental"].includes(expectedVersion) && actualVersion !== expectedVersion) return false;
  return true;
}

const VERSION_ORDER: Record<TrackVersionKind, number> = {
  studio: 0, unknown: 1, live: 2, cover: 3, remix: 4, karaoke: 5, instrumental: 6,
};

export function matchCatalogCandidate(catalog: CatalogTrackRecord, candidates: TrackRecord[]): TrackRecord | undefined {
  return candidates
    .filter((candidate) => candidate.kind === "remote-audio"
      && Boolean(candidate.remoteUrl?.startsWith("https://"))
      && matchesCatalogIdentity(catalog, candidate))
    .sort((a, b) => {
      const version = VERSION_ORDER[classifyTrackVersion(a)] - VERSION_ORDER[classifyTrackVersion(b)];
      if (version !== 0) return version;
      const durationA = catalog.duration && a.duration ? Math.abs(catalog.duration - a.duration) : 9999;
      const durationB = catalog.duration && b.duration ? Math.abs(catalog.duration - b.duration) : 9999;
      return durationA - durationB;
    })[0];
}

export function isCatalogTrackCurrent(catalog: CatalogTrackRecord, current: TrackRecord | null): boolean {
  return Boolean(current && matchesCatalogIdentity(catalog, current));
}
