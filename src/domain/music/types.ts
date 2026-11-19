export type TrackKind = "local-audio" | "extracted-video" | "remote-audio";
export type CatalogOriginality = "known-original" | "earlier-release" | "alternate-version" | "unconfirmed";
export type CatalogTrackRecord = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
  releaseDate?: string;
  genre?: string;
  sourceUrl?: string;
  storefront: string;
  /** Public catalog metadata source, not a claim of full-track audio availability. */
  catalogSource?: "apple" | "verified-reference";
  officialVideoId?: string;
  officialVideoTitle?: string;
  officialVideoPublisher?: string;
  officialVideoKind?: "official-mv" | "official-lyric-video";
  originality?: CatalogOriginality;
  originalityLabel?: string;
  versionKind?: TrackVersionKind;
  originalityConfidence?: number;
  originalityEvidence?: string[];
};

export type TrackVersionKind = "studio" | "live" | "cover" | "remix" | "karaoke" | "instrumental" | "unknown";
export type IdentityConfidence = "verified" | "curated" | "unconfirmed";
export type MusicRegion = "CN" | "HK" | "TW" | "SG" | "MY" | "TH" | "ID" | "VN" | "PH" | "JP" | "KR" | "US" | "EU" | "OTHER" | "UNKNOWN";
export type MusicLanguage = "zh" | "yue" | "en" | "ja" | "ko" | "th" | "ms" | "id" | "vi" | "tl" | "instrumental" | "unknown";
export type OriginalityStatus = "known-original" | "likely-original" | "alternate-version" | "unconfirmed";
export type MetadataConfidence = "high" | "medium" | "low";
export type ProviderName = "local" | "openverse" | "internet-archive" | "audius" | "manual";

export type TrackRecord = {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  kind: TrackKind;
  provider?: ProviderName;
  fileName?: string;
  size?: number;
  duration?: number;
  addedAt: number;
  audioHandle?: FileSystemFileHandle;
  videoHandle?: FileSystemFileHandle;
  remoteUrl?: string;
  sourceUrl?: string;
  license?: string;
  licenseUrl?: string;
  attribution?: string;
  genre?: string;
  tags?: string[];
  playCount?: number;
  releaseDate?: string;
  vocalType?: "vocal" | "instrumental" | "unknown";
  /** Stable recording identity when a trusted catalog identifier is available. */
  recordingId?: string;
  /** Version classification is descriptive; it is not proof of copyright ownership. */
  versionKind?: TrackVersionKind;
  identityConfidence?: IdentityConfidence;
  /** Explicit/derived metadata used for region-aware discovery; unknown is safer than guessing. */
  region?: MusicRegion;
  language?: MusicLanguage;
  regionConfidence?: MetadataConfidence;
  languageConfidence?: MetadataConfidence;
  /** Version and originality are separate concepts: a studio version is not automatically the original recording. */
  versionConfidence?: MetadataConfidence;
  versionEvidence?: string[];
  originalityStatus?: OriginalityStatus;
  originalityConfidence?: number;
  originalityEvidence?: string[];
  artistId?: string;
  releaseId?: string;
};

export type LyricLine = { time: number; text: string };
export type PlaybackQuality = "stable" | "balanced" | "fast";
export type RepeatMode = "off" | "all" | "one";
export type ThemeName = "cyberpunk" | "minimal" | "glass" | "retro" | "holographic" | "lofi";


export type PlaylistRecord = {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type PlaybackSnapshot = {
  key: "last-session";
  current: TrackRecord | null;
  queue: TrackRecord[];
  queueIndex: number;
  position: number;
  volume: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  updatedAt: number;
};
