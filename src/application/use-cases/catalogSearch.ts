import type { CatalogTrackRecord } from "../../domain/music/types.ts";
import { parseMusicSearchIntent, type MusicSearchIntent } from "../../domain/music/searchIntent.ts";
import { verifiedCatalogTracks } from "../../domain/music/verifiedCatalog.ts";
import { artistNamesMatch, normalizeMusicTitle, normalizeMusicText } from "../../domain/music/identity.ts";

/**
 * Normalize and rank both independently-sourced reference metadata and live catalogs.
 * Never infer that a metadata hit has a playable independent full-track stream.
 */
export function catalogMatchesIntent(track: CatalogTrackRecord, intent: MusicSearchIntent): boolean {
  if (intent.kind === "artist" && intent.artist) return artistNamesMatch(intent.artist, track.artist);
  if (intent.kind === "song" && intent.title) {
    const expectedTitle = normalizeMusicTitle(intent.title);
    const actualTitle = normalizeMusicTitle(track.title);
    // Include explicit alternate versions bearing a parenthesized suffix.
    const titleMatches = actualTitle === expectedTitle || actualTitle.startsWith(`${expectedTitle}live`) ||
      actualTitle.startsWith(`${expectedTitle}remix`) || actualTitle.startsWith(`${expectedTitle}cover`);
    if (!titleMatches) return false;
    return !intent.artist || artistNamesMatch(intent.artist, track.artist);
  }
  const key = normalizeMusicText(intent.normalizedQuery);
  return Boolean(key && (normalizeMusicText(track.title).includes(key) || normalizeMusicText(track.artist).includes(key)));
}

export function mergeAndRankCatalog(query: string, liveTracks: CatalogTrackRecord[], limit = 30): CatalogTrackRecord[] {
  const intent = parseMusicSearchIntent(query);
  const verified = verifiedCatalogTracks(query);
  const allowed = [...verified, ...liveTracks].filter((track) => catalogMatchesIntent(track, intent));
  const deduped = new Map<string, CatalogTrackRecord>();
  for (const track of allowed) {
    const title = normalizeMusicTitle(track.title);
    const artist = normalizeMusicText(track.artist);
    // Separate variants by version and album, but don't duplicate the same studio recording across stores.
    const version = track.versionKind || "unknown";
    const key = `${title}:${artist}:${version === "unknown" ? "studio" : version}`;
    const existing = deduped.get(key);
    if (!existing || (track.catalogSource === "verified-reference" && existing.catalogSource !== "verified-reference")) deduped.set(key, track);
  }
  return [...deduped.values()].sort((a, b) => {
    const confidence = (b.catalogSource === "verified-reference" ? 10000 : 0) - (a.catalogSource === "verified-reference" ? 10000 : 0);
    if (confidence) return confidence;
    const q = intent.title ? normalizeMusicTitle(intent.title) : "";
    const exact = (Number(Boolean(q && normalizeMusicTitle(b.title) === q)) - Number(Boolean(q && normalizeMusicTitle(a.title) === q))) * 500;
    if (exact) return exact;
    const isStudio = (track: CatalogTrackRecord) => Number(!["live", "cover", "remix", "karaoke", "instrumental"].includes(track.versionKind || "unknown"));
    const studio = isStudio(b) - isStudio(a);
    if (studio) return studio;
    return (b.originalityConfidence || 0) - (a.originalityConfidence || 0);
  }).slice(0, limit);
}
