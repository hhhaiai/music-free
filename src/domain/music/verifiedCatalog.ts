import type { CatalogTrackRecord } from "./types.ts";
import { parseMusicSearchIntent } from "./searchIntent.ts";

/**
 * Small human-verified reference index for examples. Never describe this as
 * realtime Apple search or as a full-length independent audio stream.
 * Official video availability is decided by YouTube at playback time.
 */
export type VerifiedRecording = {
  id: string;
  title: string;
  artist: string;
  titleAliases: string[];
  artistAliases: string[];
  album?: string;
  releaseDate?: string;
  duration?: number;
  videoId: string;
  videoTitle: string;
  videoPublisher: string;
  videoKind: "official-mv" | "official-lyric-video";
  evidenceUrl: string;
};

export const VERIFIED_RECORDINGS: readonly VerifiedRecording[] = [
  {
    id: "vitas-zvezda", title: "星星", artist: "维塔斯",
    titleAliases: ["Звезда", "Zvezda", "The Star"],
    artistAliases: ["Vitas", "Витас", "維塔斯"],
    album: "Мама (Mama)", releaseDate: "2003-06-05", duration: 210,
    videoId: "AwJj10bCl08", videoTitle: "VITAS - Звезда (Official video 2003)",
    videoPublisher: "VITAS (Official Artist Channel)", videoKind: "official-mv",
    evidenceUrl: "https://www.youtube.com/watch?v=AwJj10bCl08",
  },
  {
    id: "chenchusheng-miaotang", title: "庙堂之外", artist: "陈楚生",
    titleAliases: ["廟堂之外"], artistAliases: ["陳楚生", "Chen Chusheng"],
    album: "《长安的荔枝》电影片尾曲", releaseDate: "2025-07-17", duration: 282,
    videoId: "r_7-80t9tKA", videoTitle: "陈楚生《庙堂之外》官方 MV",
    videoPublisher: "腾讯音乐发行", videoKind: "official-mv",
    evidenceUrl: "https://www.youtube.com/watch?v=r_7-80t9tKA",
  },
  {
    id: "stevechou-huanghun", title: "黄昏", artist: "周传雄",
    titleAliases: ["黃昏", "Huang Hun"], artistAliases: ["周傳雄", "Steve Chou", "Zhou Chuanxiong", "小刚"],
    album: "Transfer", releaseDate: "2000-12-25", duration: 344,
    videoId: "6ca_YHZvzls", videoTitle: "周傳雄 Steve Chou - 黃昏",
    videoPublisher: "周傳雄 Steve Chou (Official Artist Channel)", videoKind: "official-mv",
    evidenceUrl: "https://www.youtube.com/watch?v=6ca_YHZvzls",
  },
  {
    id: "luhu-snow", title: "雪落下的声音", artist: "陆虎",
    titleAliases: ["雪落下的聲音"], artistAliases: ["陸虎", "路虎", "Lu Hu", "Tiger Lu"],
    album: "《延禧攻略》片尾曲",
    videoId: "wBIpo6vTuYc", videoTitle: "陸虎《雪落下的聲音》Official Lyric Video",
    videoPublisher: "YOYOROCK 滾石移動", videoKind: "official-lyric-video",
    evidenceUrl: "https://www.youtube.com/watch?v=wBIpo6vTuYc",
  },
];

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function matchVerifiedRecordings(query: string): VerifiedRecording[] {
  const intent = parseMusicSearchIntent(query);
  if (intent.kind === "song" && intent.artist && intent.title) {
    const requestedArtist = normalize(intent.artist);
    const requestedTitle = normalize(intent.title);
    return VERIFIED_RECORDINGS.filter((record) => normalize(record.artist) === requestedArtist && normalize(record.title) === requestedTitle);
  }
  if (intent.kind === "artist" && intent.artist) {
    const requestedArtist = normalize(intent.artist);
    return VERIFIED_RECORDINGS.filter((record) => normalize(record.artist) === requestedArtist);
  }
  const token = normalize(query);
  return VERIFIED_RECORDINGS.filter((record) => {
    // Bare "星星" is ambiguous; do not claim Vitas as the only identity.
    if (token === normalize("星星") && record.id === "vitas-zvezda") return false;
    return [record.title, ...record.titleAliases, record.artist, ...record.artistAliases]
      .some((value) => normalize(value) === token);
  });
}

export function verifiedCatalogTracks(query: string): CatalogTrackRecord[] {
  return matchVerifiedRecordings(query).map((record) => ({
    id: `verified:${record.id}`,
    title: record.title,
    artist: record.artist,
    album: record.album,
    duration: record.duration,
    releaseDate: record.releaseDate,
    storefront: "VERIFIED",
    catalogSource: "verified-reference",
    officialVideoId: record.videoId,
    officialVideoTitle: record.videoTitle,
    officialVideoPublisher: record.videoPublisher,
    officialVideoKind: record.videoKind,
    sourceUrl: record.evidenceUrl,
    originality: "known-original",
    originalityLabel: "原唱已核对 · 官方视频",
    originalityConfidence: 0.98,
    originalityEvidence: ["参考官方发行方/艺人频道公开信息", record.evidenceUrl],
    versionKind: "studio",
  }));
}

export function verifiedRecordingForCatalog(catalog: Pick<CatalogTrackRecord, "title" | "artist">): VerifiedRecording | undefined {
  const title = normalize(catalog.title);
  const artist = normalize(catalog.artist);
  return VERIFIED_RECORDINGS.find((record) =>
    [record.title, ...record.titleAliases].some((item) => normalize(item) === title) &&
    [record.artist, ...record.artistAliases].some((item) => normalize(item) === artist)
  );
}
