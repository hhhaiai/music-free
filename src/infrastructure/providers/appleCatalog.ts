import type { CatalogTrackRecord, TrackVersionKind } from "../../domain/music/types.ts";
import { classifyTrackVersion } from "../../domain/music/metadata.ts";
import { parseMusicSearchIntent, musicCatalogQueries } from "../../domain/music/searchIntent.ts";
import { mergeAndRankCatalog } from "../../application/use-cases/catalogSearch.ts";
import { verifiedRecordingForCatalog } from "../../domain/music/verifiedCatalog.ts";

export type CatalogTrack = CatalogTrackRecord;

type AppleResult = {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
  primaryGenreName?: string;
  trackViewUrl?: string;
  collectionViewUrl?: string;
};

type AppleResponse = { resultCount?: number; results?: AppleResult[] };
type CacheEntry = { at: number; tracks: CatalogTrack[] };

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 10 * 60 * 1000;
let callbackSequence = 0;

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function storefronts(query: string): string[] {
  // For Chinese titles, search Taiwan/Hong Kong/Mainland first. A single
  // Singapore hit must never short-circuit the other regional catalogs.
  if (/[\uac00-\ud7af]/.test(query)) return ['kr', 'jp', 'sg', 'us'];
  if (/[\u3040-\u30ff]/.test(query)) return ['jp', 'kr', 'sg', 'us'];
  if (/[\u3400-\u9fff]/.test(query)) return ['tw', 'cn', 'hk', 'sg', 'my', 'us'];
  return ['sg', 'my', 'us', 'gb', 'au'];
}

function searchStoreJsonp(url: URL, signal?: AbortSignal): Promise<AppleResponse> {
  return new Promise((resolve, reject) => {
    const callbackName = `__musicFreeAppleSearch_${Date.now()}_${++callbackSequence}`;
    const script = document.createElement('script');
    let settled = false;
    const globalWindow = window as unknown as Record<string, unknown>;
    const cleanup = () => {
      window.clearTimeout(timer);
      script.remove();
      delete globalWindow[callbackName];
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error?: Error, payload?: AppleResponse) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve(payload || { results: [] });
    };
    const onAbort = () => finish(new DOMException('搜索已取消', 'AbortError'));
    const timer = window.setTimeout(() => finish(new Error('Apple 歌曲目录请求超时。')), 12000);
    globalWindow[callbackName] = (payload: unknown) => finish(undefined, payload as AppleResponse);
    url.searchParams.set('callback', callbackName);
    script.async = true;
    script.src = url.toString();
    script.onerror = () => finish(new Error('Apple 歌曲目录跨域请求失败。'));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    document.head.appendChild(script);
  });
}

async function fetchApplePayload(url: URL, signal?: AbortSignal): Promise<AppleResponse> {
  try {
    const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Apple 歌曲目录请求失败（${response.status}）`);
    return await response.json() as AppleResponse;
  } catch (error) {
    if (signal?.aborted) throw error;
    // Apple documents JSONP for cross-site search fields; use it when browser CORS blocks fetch.
    if (error instanceof TypeError) return searchStoreJsonp(new URL(url.toString()), signal);
    throw error;
  }
}

async function searchStore(query: string, country: string, signal?: AbortSignal): Promise<CatalogTrack[]> {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', query);
  url.searchParams.set('country', country);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', '50');
  const payload = await fetchApplePayload(url, signal);
  return (payload.results || []).filter((item) => item.kind === 'song' && item.trackName && item.artistName).map((item) => {
    const durationMs = Number(item.trackTimeMillis);
    const artwork = (item.artworkUrl100 || '').replace(/^http:/, 'https:');
    return {
      id: `apple-catalog:${country}:${item.trackId || normalize(`${item.trackName}:${item.artistName}`)}`,
      title: item.trackName || '未命名歌曲',
      artist: item.artistName || '未知艺术家',
      album: item.collectionName || undefined,
      coverUrl: artwork || undefined,
      duration: Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : undefined,
      releaseDate: item.releaseDate || undefined,
      genre: item.primaryGenreName || undefined,
      sourceUrl: item.trackViewUrl || item.collectionViewUrl || undefined,
      storefront: country.toUpperCase(),
      catalogSource: "apple",
    };
  });
}

const CANONICAL_RECORDINGS: Record<string, { artists: string[]; titles: string[] }> = {
  [normalize('黄昏')]: {
    artists: ['周传雄', '周傳雄', 'Zhou Chuanxiong', 'Steve Chou', 'Xiao Gang', '小刚'],
    titles: ['黄昏', '黃昏'],
  },
  [normalize('黃昏')]: {
    artists: ['周传雄', '周傳雄', 'Zhou Chuanxiong', 'Steve Chou', 'Xiao Gang', '小刚'],
    titles: ['黄昏', '黃昏'],
  },
  [normalize('北京一夜')]: {
    artists: ['陈升', '陳升', 'Bobby Chen', 'Chen Sheng'],
    titles: ['北京一夜'],
  },
};

const STOREFRONT_WEIGHT: Record<string, number> = {
  TW: 8, CN: 7, HK: 6, SG: 4, MY: 3, US: 2, JP: 1, KR: 1, GB: 0, AU: 0,
};

function titleMatches(title: string, query: string): boolean {
  const normalizedTitle = normalize(title);
  const normalizedQuery = normalize(query);
  if (normalizedTitle === normalizedQuery) return true;
  const canonical = CANONICAL_RECORDINGS[normalizedQuery];
  return Boolean(canonical?.titles.some((candidate) => normalize(candidate) === normalizedTitle));
}

function canonicalArtistMatches(track: CatalogTrack, query: string): boolean {
  const canonical = CANONICAL_RECORDINGS[normalize(query)];
  if (!canonical) return false;
  const artist = normalize(track.artist);
  return canonical.artists.some((candidate) => {
    const normalized = normalize(candidate);
    return artist === normalized || artist.includes(normalized);
  });
}

function catalogVersion(track: CatalogTrack): TrackVersionKind {
  return classifyTrackVersion({ title: track.title, album: track.album, versionKind: track.versionKind, tags: [] }).kind;
}

function versionPenalty(track: CatalogTrack): number {
  return ["live", "cover", "remix", "karaoke", "instrumental"].includes(catalogVersion(track)) ? 900 : 0;
}

function releaseTimestamp(track: CatalogTrack): number {
  const value = track.releaseDate ? Date.parse(track.releaseDate) : Number.NaN;
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function score(track: CatalogTrack, query: string, earliestRelease?: number): number {
  const q = normalize(query);
  const title = normalize(track.title);
  const artist = normalize(track.artist);
  let value = 0;

  if (titleMatches(track.title, query)) value += 1800;
  else if (title.startsWith(q)) value += 900;
  else if (title.includes(q)) value += 500;

  // If the user searched an artist name, exact artist matches outrank title coincidences.
  if (artist === q) value += 2200;
  else if (artist.includes(q)) value += 1400;

  // Known original performers get a strong, explicit boost for known recordings.
  if (canonicalArtistMatches(track, query)) value += 5000;

  // Alternate versions should not outrank a clean studio/original recording.
  value -= versionPenalty(track);

  const released = releaseTimestamp(track);
  if (earliestRelease !== undefined && released === earliestRelease) value += 120;

  value += STOREFRONT_WEIGHT[track.storefront] || 0;
  return value;
}

function annotateOriginality(track: CatalogTrack, query: string, earliestRelease?: number): CatalogTrack {
  const verified = verifiedRecordingForCatalog(track);
  const isAlternate = versionPenalty(track) > 0;
  if (verified && !isAlternate) {
    return { ...track, versionKind: catalogVersion(track), originality: 'known-original', originalityLabel: '已核对原唱署名（录音版本待确认）', originalityConfidence: 0.75, originalityEvidence: ['匹配已核对的原唱歌手与歌名；Apple 录音版本仍须确认'] };
  }
  if (canonicalArtistMatches(track, query) && !isAlternate) {
    return { ...track, versionKind: catalogVersion(track), originality: 'known-original', originalityLabel: '已知原唱', originalityConfidence: 0.98, originalityEvidence: ['人工维护的原唱资料库匹配'] };
  }
  if (versionPenalty(track) > 0) {
    return { ...track, versionKind: catalogVersion(track), originality: 'alternate-version', originalityLabel: '特殊版本', originalityConfidence: 0.86, originalityEvidence: ['目录标题或专辑标记了现场、翻唱、混音或伴奏版本'] };
  }
  if (earliestRelease !== undefined && releaseTimestamp(track) === earliestRelease) {
    return { ...track, versionKind: catalogVersion(track), originality: 'earlier-release', originalityLabel: '较早发行（原唱待核）', originalityConfidence: 0.35, originalityEvidence: ['目录中较早发行不等于原唱证明'] };
  }
  return { ...track, versionKind: catalogVersion(track), originality: 'unconfirmed', originalityLabel: '原唱待确认', originalityConfidence: 0.1, originalityEvidence: ['缺少足够的原唱证据'] };
}

export async function searchAppleCatalog(query: string, signal?: AbortSignal): Promise<{ tracks: CatalogTrack[]; warnings: string[] }> {
  const term = query.trim();
  if (!term) return { tracks: [], warnings: [] };
  const key = normalize(term);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return { tracks: cached.tracks, warnings: [] };

  const intent = parseMusicSearchIntent(term);
  const terms = musicCatalogQueries(intent);
  // Bounded call budget avoids saturating Apple's documented rate limits.
  const isCyrillic = /[\u0400-\u04ff]/.test(terms[0]);
  const countries = isCyrillic ? ["us", "gb", "kz"] : storefronts(intent.normalizedQuery).slice(0, 3);
  const jobs = countries.map((country, index) => ({ country, term: terms[index % terms.length] }));
  const warnings: string[] = [];
  const collected: CatalogTrack[] = [];
  const timeout = AbortSignal.timeout(8500);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const settled = await Promise.allSettled(jobs.map(({ country, term: queryTerm }) => searchStore(queryTerm, country, combined)));
  for (const result of settled) {
    if (result.status === 'fulfilled') collected.push(...result.value);
    else {
      if (signal?.aborted) throw signal.reason;
      warnings.push(`Apple 音乐目录：${result.reason instanceof Error ? result.reason.message : '部分地区暂时不可用'}`);
    }
  }

  const unique = new Map<string, CatalogTrack>();
  for (const track of collected) {
    const dedupeKey = `${normalize(track.title)}::${normalize(track.artist)}::${catalogVersion(track)}`;
    const previous = unique.get(dedupeKey);
    if (!previous || score(track, intent.title || term) > score(previous, intent.title || term)) unique.set(dedupeKey, track);
  }
  const titleGroups = new Map<string, CatalogTrack[]>();
  for (const track of unique.values()) {
    const titleKey = normalize(track.title);
    titleGroups.set(titleKey, [...(titleGroups.get(titleKey) || []), track]);
  }
  const earliestByTitle = new Map<string, number>();
  for (const [titleKey, group] of titleGroups) {
    const dates = group.map(releaseTimestamp).filter((value) => value !== Number.MAX_SAFE_INTEGER);
    if (dates.length) earliestByTitle.set(titleKey, Math.min(...dates));
  }
  const annotated = [...unique.values()].map((track) => annotateOriginality(track, intent.title || term, earliestByTitle.get(normalize(track.title))));
  const tracks = mergeAndRankCatalog(term, annotated);
  // Save even offline reference rows to reduce repeated requests to an unavailable provider.
  cache.set(key, { at: Date.now(), tracks });
  return { tracks, warnings: [...new Set(warnings)] };
}
