import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, DragEvent as ReactDragEvent, FormEvent, PointerEvent as ReactPointerEvent } from "react";
import type { LyricLine, PlaybackQuality, RepeatMode, ThemeName, TrackRecord, PlaylistRecord, PlaybackSnapshot, MusicRegion, CatalogTrackRecord } from "../domain/music/types";
import { addHistory, deleteTrack, getDiscovery, getHistory, getTracks, saveDiscovery, saveTracks, getPlaylists, savePlaylist, deletePlaylist, getPlaybackSnapshot, savePlaybackSnapshot, getLyrics, saveLyrics } from "../infrastructure/persistence/indexedDb";
import { extractAudio } from "../infrastructure/media/localExtractor";
import { fileTitle, timeLabel } from "../infrastructure/media/videoUtils";
import { searchMusic, discoverMusic, searchAppleCatalog, findLyrics, parseLrc } from "../bootstrap/compositionRoot";
import { buildDiscoverySeeds, rankRecommendations, groupByArtist } from "../domain/music/recommendation";
import { MUSIC_REGIONS } from "../domain/music/regions";
import { VERSION_LABELS, classifyTrackVersion } from "../domain/music/metadata";
import { buildArtistEntities, buildReleaseEntities, buildRecordingEntities } from "../domain/music/entities";
import type { LyricsResult } from "../infrastructure/providers/lyrics";
import { waitUntilPlayable, preloadMetadata, getBufferedAhead, getNetworkHint } from "../infrastructure/playback/bufferManager";
import { matchCatalogCandidate, isCatalogTrackCurrent, sameTrackIdentity } from "../domain/music/identity";
import { parseMusicSearchIntent } from "../domain/music/searchIntent";
import { verifiedCatalogTracks, verifiedRecordingForCatalog } from "../domain/music/verifiedCatalog";
import { OfficialVideoStage, officialVideoSelection, type OfficialVideoSelection } from "./components/OfficialVideoStage";
import { resolveCatalogAudio } from "../application/use-cases/resolveCatalogAudio";
import { startBufferedPlayback } from "../application/use-cases/startBufferedPlayback";
import type { SourceHealthSnapshot } from "../domain/music/sourceRanking";
import { useLocalCore } from "./hooks/useLocalCore";
import { playbackControllerFor } from "../infrastructure/playback/playbackController";
import { sourceHealth } from "../infrastructure/playback/sourceHealth";
import { LocalMediaWorkbench } from "./components/LocalMediaWorkbench";
import { VideoSearchPanel } from "./components/VideoSearchPanel";
import { ImmersivePlayer } from "./components/ImmersivePlayer";
import { EmptyState, LoadingState, NavButton, PanelHeading, SearchBox, TrackGrid, TrackRows, providerLabel } from "./components/MusicComponents";

type Tab = "discover" | "search" | "radio" | "library" | "favorites" | "playlists" | "extract" | "settings";
type HistoryItem = { id: string; track: TrackRecord; playedAt: number; position?: number };
type FloatPosition = { x: number; y: number };

const FAVORITES_KEY = "music-free-v3:favorites";
const V22_FAVORITES_KEY = "music-free-v22:favorites";
const THEME_KEY = "music-free-v3:theme";
const QUALITY_KEY = "music-free-v3:quality";
const FLOAT_KEY = "music-free-v3:floating-lyrics";
const LYRIC_OFFSET_KEY = "music-free-v31:lyric-offset";
const PREFERRED_REGION_KEY = "music-free-v40:preferred-region";
const THEMES: { id: ThemeName; name: string; description: string }[] = [
  { id: "cyberpunk", name: "Cyberpunk", description: "霓虹紫 · 科技感" },
  { id: "minimal", name: "Minimal", description: "极简黑 · 克制" },
  { id: "glass", name: "Glass", description: "玻璃拟态 · 通透" },
  { id: "retro", name: "Retro", description: "复古唱片 · 暖色" },
  { id: "holographic", name: "Holographic", description: "全息蓝 · 沉浸" },
  { id: "lofi", name: "Lo-fi", description: "柔和暖色 · 放松" },
];
const GENRES = ["华语流行", "粤语金曲", "欧美流行", "K-pop", "J-pop", "新加坡音乐", "马来西亚音乐", "泰国流行", "印尼流行", "越南流行", "菲律宾流行", "抖音热歌", "TikTok 热歌", "鬼畜/Remix", "短视频热歌", "DJ Remix", "纯音乐"];

function readList<T>(key: string): T[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value as T[] : [];
  } catch { return []; }
}

function trackId(file: File, prefix: string) {
  return `${prefix}:${file.name}:${file.size}:${file.lastModified}`;
}

async function readHandle(handle: FileSystemFileHandle): Promise<File> {
  const h = handle as FileSystemFileHandle & { requestPermission?: (options: { mode: "read" }) => Promise<PermissionState> };
  if (h.requestPermission) {
    const permission = await h.requestPermission({ mode: "read" });
    if (permission !== "granted") throw new Error("没有获得本地文件读取权限，请重新选择文件。");
  }
  try { return await handle.getFile(); }
  catch { throw new Error("原文件可能已移动或删除，请重新导入。"); }
}


function activeLyric(lines: LyricLine[], time: number) {
  let active = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].time <= time + 0.08) active = i;
    else break;
  }
  return active;
}

export default function App() {
  const localCore = useLocalCore();
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const lrcInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const sessionFiles = useRef(new Map<string, File>());
  const objectUrls = useRef(new Map<string, string>());
  const nextPreload = useRef<HTMLAudioElement | null>(null);
  const floatDrag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  const [tab, setTab] = useState<Tab>("discover");
  const [tracks, setTracks] = useState<TrackRecord[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState("");
  const [playlistDraft, setPlaylistDraft] = useState("");
  const [resumeSnapshot, setResumeSnapshot] = useState<PlaybackSnapshot | null>(null);
  const [lyricOffset, setLyricOffset] = useState(() => Number(localStorage.getItem(LYRIC_OFFSET_KEY) || 0));
  const [discovery, setDiscovery] = useState<TrackRecord[]>([]);
  const [searchResults, setSearchResults] = useState<TrackRecord[]>([]);
  const [catalogResults, setCatalogResults] = useState<CatalogTrackRecord[]>([]);
  const [matchingCatalogId, setMatchingCatalogId] = useState<string | null>(null);
  const [matchingCatalogStage, setMatchingCatalogStage] = useState<"matching" | "buffering" | null>(null);
  const [activeCatalogTrackId, setActiveCatalogTrackId] = useState<string | null>(null);
  const [officialVideo, setOfficialVideo] = useState<OfficialVideoSelection | null>(null);
  const searchSequence = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const matchAbort = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [activeGenre, setActiveGenre] = useState("Ambient");
  const [current, setCurrent] = useState<TrackRecord | null>(null);
  const [queue, setQueue] = useState<TrackRecord[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [theme, setTheme] = useState<ThemeName>(() => (localStorage.getItem(THEME_KEY) as ThemeName) || "cyberpunk");
  const [preferredRegion, setPreferredRegion] = useState<MusicRegion | "ALL">(() => (localStorage.getItem(PREFERRED_REGION_KEY) as MusicRegion | "ALL") || "ALL");
  const [regionFilter, setRegionFilter] = useState<MusicRegion | "ALL">("ALL");
  const [versionFilter, setVersionFilter] = useState<TrackRecord["versionKind"] | "ALL">("ALL");
  const [immersiveOpen, setImmersiveOpen] = useState(false);
  const [quality, setQuality] = useState<PlaybackQuality>(() => (localStorage.getItem(QUALITY_KEY) as PlaybackQuality) || "stable");
  const [floatingLyrics, setFloatingLyrics] = useState(() => localStorage.getItem(FLOAT_KEY) === "true");
  const [floatPosition, setFloatPosition] = useState<FloatPosition>(() => ({ x: 50, y: Math.max(90, window.innerHeight - 210) }));
  const [lyricsResult, setLyricsResult] = useState<LyricsResult | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [providerWarnings, setProviderWarnings] = useState<string[]>([]);
  const [manualUrl, setManualUrl] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualConsent, setManualConsent] = useState(false);
  const [showPlainLyrics, setShowPlainLyrics] = useState(false);

  const lastSnapshotAt = useRef(0);
  const recoveryTimer = useRef<number | null>(null);
  const recoveryAttempts = useRef(0);
  const failedTrackIds = useRef(new Set<string>());
  const startingTrackId = useRef<string | null>(null);
  const playRequestId = useRef(0);
  const [bufferAhead, setBufferAhead] = useState(0);
  const [recoveryStatus, setRecoveryStatus] = useState("");
  const [networkHint, setNetworkHint] = useState(() => getNetworkHint());

  const interpretedQuery = useMemo(() => parseMusicSearchIntent(query), [query]);
  const lyricLines = useMemo(() => parseLrc(lyricsResult?.syncedLyrics || ""), [lyricsResult?.syncedLyrics]);
  const lyricIndex = activeLyric(lyricLines, Math.max(0, position + lyricOffset));
  const currentFavorite = current ? favorites.includes(current.id) : false;
  const [sourceFilter, setSourceFilter] = useState("all");
  const [fullTracksOnly, setFullTracksOnly] = useState(true);
  const [vocalOnly, setVocalOnly] = useState(true);
  const [licenseFilter, setLicenseFilter] = useState("all");
  const [sortMode, setSortMode] = useState("relevance");
  const visibleLibrary = tab === "favorites" ? tracks.filter((track) => favorites.includes(track.id)) : tracks;
  const filteredLibrary = visibleLibrary.filter((track) => `${track.title} ${track.artist || ""} ${track.fileName || ""}`.toLowerCase().includes(query.toLowerCase()));
  const filteredSearchResults = useMemo(() => {
    const filtered = searchResults.filter((track) => {
      if (sourceFilter !== "all" && track.provider !== sourceFilter) return false;
      if (regionFilter !== "ALL" && track.region !== regionFilter) return false;
      if (versionFilter !== "ALL" && classifyTrackVersion(track) !== versionFilter) return false;
      // Keep unknown-duration results visible for discovery; only hide items known to be short clips.
      if (fullTracksOnly && track.duration !== undefined && track.duration > 0 && track.duration < 120) return false;
      if (vocalOnly && track.vocalType === "instrumental") return false;
      const license = (track.license || "").toLowerCase();
      if (licenseFilter === "cc0" && !license.includes("cc0")) return false;
      if (licenseFilter === "cc-by" && !(license.includes("cc by") || license.includes("by-sa"))) return false;
      if (licenseFilter === "public-domain" && !license.includes("public domain")) return false;
      if (licenseFilter === "commercial" && !license.includes("by-nc")) return false;
      return true;
    });
    if (sortMode === "relevance") filtered.sort((a, b) => Number(b.vocalType === "vocal") - Number(a.vocalType === "vocal"));
    if (sortMode === "duration-asc") filtered.sort((a, b) => (a.duration || Number.MAX_SAFE_INTEGER) - (b.duration || Number.MAX_SAFE_INTEGER));
    if (sortMode === "duration-desc") filtered.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    if (sortMode === "artist") filtered.sort((a, b) => (a.artist || "").localeCompare(b.artist || ""));
    return filtered;
  }, [searchResults, sourceFilter, licenseFilter, sortMode, fullTracksOnly, vocalOnly, regionFilter, versionFilter]);
  const activeCatalogTrack = catalogResults.find((item) => item.id === activeCatalogTrackId) || null;
  const visibleSearchResults = useMemo(() => {
    if (catalogResults.length > 0) {
      if (!activeCatalogTrack) return [];
      return filteredSearchResults.filter((candidate) => matchCatalogCandidate(activeCatalogTrack, [candidate]));
    }
    return filteredSearchResults;
  }, [catalogResults, activeCatalogTrack, filteredSearchResults]);
  const artistGroups = useMemo(() => groupByArtist(tracks), [tracks]);
  const artistEntities = useMemo(() => buildArtistEntities(tracks), [tracks]);
  const releaseEntities = useMemo(() => buildReleaseEntities(tracks), [tracks]);
  const recordingEntities = useMemo(() => buildRecordingEntities(tracks), [tracks]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getTracks(), getDiscovery("home-v35-search"), getHistory(), getPlaylists(), getPlaybackSnapshot()]).then(([savedTracks, cached, savedHistory, savedPlaylists, snapshot]) => {
      if (cancelled) return;
      setTracks(savedTracks);
      setHistory(savedHistory);
      setPlaylists(savedPlaylists);
      if (savedPlaylists[0]) setSelectedPlaylistId(savedPlaylists[0].id);
      if (snapshot?.current) setResumeSnapshot(snapshot);
      if (cached?.items?.length) setDiscovery(cached.items);
      const migratedFavorites = localStorage.getItem(FAVORITES_KEY) !== null
        ? readList<string>(FAVORITES_KEY)
        : readList<string>(V22_FAVORITES_KEY);
      setFavorites(migratedFavorites);
      if (!localStorage.getItem(FAVORITES_KEY) && migratedFavorites.length) {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(migratedFavorites));
      }
      if (!cached?.items?.length) void refreshDiscovery();
      else if (Date.now() - cached.updatedAt > 6 * 60 * 60 * 1000) void refreshDiscovery();
    }).catch(() => setError("读取本地数据库失败。请尝试重新打开页面。"));
    return () => { cancelled = true; };
    // Initial hydration only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Server discovery snapshots can also contain YouTube video metadata, which
    // must never be misrepresented as independently playable audio.
    const backgroundTracks = (localCore.discovery?.tracks || []).filter((track): track is TrackRecord =>
      track?.kind === "remote-audio" && Boolean(track.remoteUrl?.startsWith("https://"))
      && Boolean(track.artist) && (!track.duration || track.duration >= 120));
    if (!backgroundTracks.length || !localCore.discovery?.updatedAt) return;
    setDiscovery((current) => {
      const merged = new Map<string, TrackRecord>();
      [...current, ...backgroundTracks].forEach((track) => merged.set(track.id, track));
      return rankRecommendations([...merged.values()], tracks, favorites, history.map((item) => item.track), {
        preferredRegions: preferredRegion === "ALL" ? [] : [preferredRegion],
        preferVocal: true, preferFullTracks: true, maxPerArtist: 3, maxPerIdentity: 1,
      }).slice(0, 60);
    });
    void saveDiscovery("home-v35-search", backgroundTracks).catch(() => undefined);
  }, [localCore.discovery?.updatedAt]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => { localStorage.setItem(QUALITY_KEY, quality); }, [quality]);
  useEffect(() => { localStorage.setItem(PREFERRED_REGION_KEY, preferredRegion); }, [preferredRegion]);
  useEffect(() => { localStorage.setItem(FLOAT_KEY, String(floatingLyrics)); }, [floatingLyrics]);
  useEffect(() => { localStorage.setItem(LYRIC_OFFSET_KEY, String(lyricOffset)); }, [lyricOffset]);
  useEffect(() => {
    const saveOnHide = () => { if (current) void persistSession(current, queue, queueIndex, audioRef.current?.currentTime || position); };
    window.addEventListener("pagehide", saveOnHide);
    return () => window.removeEventListener("pagehide", saveOnHide);
  });

  useEffect(() => () => {
    searchAbort.current?.abort();
    matchAbort.current?.abort();
    clearRecoveryTimer();
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    nextPreload.current?.pause();
  }, []);

  useEffect(() => {
    if (!current) { setLyricsResult(null); setLyricsError(""); return; }
    const controller = new AbortController();
    setLyricsLoading(true);
    setLyricsError("");
    getLyrics(current.id).then((localLyrics) => {
      if (controller.signal.aborted) return null;
      if (localLyrics) return { syncedLyrics: localLyrics } as LyricsResult;
      return findLyrics(current.title, current.artist, controller.signal);
    }).then((result) => { if (!controller.signal.aborted) setLyricsResult(result); })
      .catch((err) => { if (!controller.signal.aborted) setLyricsError(err instanceof Error ? err.message : "歌词暂时不可用。"); })
      .finally(() => { if (!controller.signal.aborted) setLyricsLoading(false); });
    return () => controller.abort();
  }, [current?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) playbackControllerFor(audio)?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (!current || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist || "Music Free",
        album: current.album || "",
        artwork: current.coverUrl ? [{ src: current.coverUrl, sizes: "512x512", type: "image/jpeg" }] : [],
      });
      navigator.mediaSession.setActionHandler("play", () => { void playbackControllerFor(audioRef.current)?.play(); setPlaying(true); });
      navigator.mediaSession.setActionHandler("pause", () => { playbackControllerFor(audioRef.current)?.pause(); setPlaying(false); });
      navigator.mediaSession.setActionHandler("previoustrack", () => playPrevious());
      navigator.mediaSession.setActionHandler("nexttrack", () => playNext());
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (audioRef.current && details.seekTime !== undefined) playbackControllerFor(audioRef.current)?.seek(details.seekTime);
      });
    } catch { /* Media Session support varies by browser. */ }
  }, [current?.id, playing, queueIndex, queue, repeatMode, shuffle]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.code === "Space") { event.preventDefault(); togglePlayback(); }
      if (event.code === "ArrowRight" && audioRef.current) playbackControllerFor(audioRef.current)?.seek(Math.min(duration || Infinity, position + 5));
      if (event.code === "ArrowLeft" && audioRef.current) playbackControllerFor(audioRef.current)?.seek(Math.max(0, position - 5));
      if (event.key.toLowerCase() === "n") void playNext();
      if (event.key.toLowerCase() === "p") void playPrevious();
      if (event.key.toLowerCase() === "m") setVolume((value) => value === 0 ? 0.85 : 0);
      if (event.key.toLowerCase() === "l") setShowPlainLyrics((value) => !value);
      if (event.key.toLowerCase() === "i" && current) setImmersiveOpen((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // The keyboard handler intentionally reads the latest render values.
  });

  useEffect(() => {
    const update = () => setNetworkHint(getNetworkHint());
    window.addEventListener("online", update); window.addEventListener("offline", update);
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    connection?.addEventListener?.("change", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); connection?.removeEventListener?.("change", update); };
  }, []);

  function clearRecoveryTimer() {
    if (recoveryTimer.current !== null) { window.clearTimeout(recoveryTimer.current); recoveryTimer.current = null; }
  }

  function scheduleRecovery() {
    const audio = audioRef.current;
    if (!audio || audio.paused || recoveryTimer.current !== null) return;
    recoveryTimer.current = window.setTimeout(() => {
      recoveryTimer.current = null;
      const element = audioRef.current;
      if (!element || element.paused || element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
      void recoverPlayback();
    }, 9000);
  }

  async function recoverPlayback() {
    const audio = audioRef.current; const track = current;
    if (!audio || !track || audio.paused) return;
    const sourceKey = track.id.replace(/[^a-z0-9:_-]/gi, "_").slice(0, 256);
    const persistedSource = localCore.sourceHealth.find((item) => (item.source_id || item.sourceId) === sourceKey);
    const persistedRetryAt = persistedSource?.retry_at ?? persistedSource?.retryAt ?? null;
    const cooldownMs = Math.max(sourceHealth.retryAfterMs(track.id), persistedRetryAt ? Math.max(0, persistedRetryAt - Date.now()) : 0);
    if (cooldownMs > 0) {
      setRecoveryStatus(`音源暂时降级，${Math.ceil(cooldownMs / 1000)} 秒后再尝试恢复…`);
      if (recoveryTimer.current === null) {
        recoveryTimer.current = window.setTimeout(() => {
          recoveryTimer.current = null;
          void recoverPlayback();
        }, cooldownMs);
      }
      return;
    }
    if (recoveryAttempts.current >= 2) { setBuffering(false); setError("音频连续缓冲失败。可以手动重试，或选择其他可用音源。"); return; }
    recoveryAttempts.current += 1;
    const savedPosition = audio.currentTime;
    setRecoveryStatus(`正在尝试恢复播放（${recoveryAttempts.current}/2）…`); setBuffering(true);
    startingTrackId.current = track.id;
    try {
      playbackControllerFor(audio)?.pause();
      const url = await resolveTrackUrl(track);
      audio.src = url; audio.load();
      const readiness = await waitUntilPlayable(audio, quality);
      setBufferAhead(readiness.bufferedSeconds);
      if (Number.isFinite(audio.duration) && savedPosition < audio.duration - 1) playbackControllerFor(audio)?.seek(savedPosition);
      await playbackControllerFor(audio)!.play();
      sourceHealth.recordSuccess(track.id);
      void reportSourceHealth(track, true);
      startingTrackId.current = null;
      setRecoveryStatus("播放已恢复"); setNotice("网络缓冲已恢复，继续播放。");
    } catch (err) {
      startingTrackId.current = null;
      setRecoveryStatus(""); setBuffering(false);
      setError(err instanceof Error ? err.message : "自动恢复失败。请手动重试。");
    }
  }

  async function retryCurrent() {
    if (!current) return;
    recoveryAttempts.current = 0; failedTrackIds.current.delete(current.id); setRecoveryStatus("");
    await playTrack(current, queue.length ? queue : [current], position, true);
  }

  async function persistSession(track = current, list = queue, index = queueIndex, pos = position) {
    if (!track) return;
    const snapshot: PlaybackSnapshot = {
      key: "last-session", current: track, queue: list, queueIndex: index,
      position: Math.max(0, pos), volume, repeatMode, shuffle, updatedAt: Date.now(),
    };
    await savePlaybackSnapshot(snapshot).catch(() => undefined);
  }

  async function resumeLastSession() {
    if (!resumeSnapshot?.current) return;
    await playTrack(resumeSnapshot.current, resumeSnapshot.queue.length ? resumeSnapshot.queue : [resumeSnapshot.current], resumeSnapshot.position);
    setVolume(resumeSnapshot.volume);
    setRepeatMode(resumeSnapshot.repeatMode);
    setShuffle(resumeSnapshot.shuffle);
    setResumeSnapshot(null);
  }

  async function createPlaylist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = playlistDraft.trim();
    if (!name) return;
    const playlist: PlaylistRecord = { id: crypto.randomUUID(), name, trackIds: [], createdAt: Date.now(), updatedAt: Date.now() };
    await savePlaylist(playlist);
    const updated = await getPlaylists();
    setPlaylists(updated); setSelectedPlaylistId(playlist.id); setPlaylistDraft("");
    setNotice(`已创建歌单「${name}」。`);
  }

  async function addToSelectedPlaylist(track: TrackRecord) {
    if (!selectedPlaylistId) { setNotice("请先创建并选择一个歌单。"); setTab("playlists"); return; }
    const playlist = playlists.find((item) => item.id === selectedPlaylistId);
    if (!playlist) return;
    if (playlist.trackIds.includes(track.id)) { setNotice("这首歌曲已经在歌单里了。"); return; }
    await saveRecords([track]);
    const updated = { ...playlist, trackIds: [...playlist.trackIds, track.id], updatedAt: Date.now() };
    await savePlaylist(updated);
    setPlaylists(await getPlaylists());
    setNotice(`已将「${track.title}」加入「${playlist.name}」。`);
  }

  async function removeFromPlaylist(playlist: PlaylistRecord, trackId: string) {
    const updated = { ...playlist, trackIds: playlist.trackIds.filter((id) => id !== trackId), updatedAt: Date.now() };
    await savePlaylist(updated); setPlaylists(await getPlaylists());
  }

  async function removePlaylist(playlist: PlaylistRecord) {
    if (!window.confirm(`删除歌单「${playlist.name}」？不会删除歌单中的音乐文件。`)) return;
    await deletePlaylist(playlist.id);
    const updated = await getPlaylists(); setPlaylists(updated);
    if (selectedPlaylistId === playlist.id) setSelectedPlaylistId(updated[0]?.id || "");
  }

  function moveQueueItem(from: number, to: number) {
    if (to < 0 || to >= queue.length || from === to) return;
    setQueue((old) => {
      const next = [...old]; const [item] = next.splice(from, 1); next.splice(to, 0, item);
      const currentId = current?.id;
      setQueueIndex(currentId ? next.findIndex((track) => track.id === currentId) : -1);
      void persistSession(current, next, currentId ? next.findIndex((track) => track.id === currentId) : -1, position);
      return next;
    });
  }

  async function importLrc(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !current) { event.target.value = ""; return; }
    const content = await file.text();
    if (!/\[\d{1,2}:\d{2}/.test(content)) { setError("这不是有效的 LRC 歌词文件。"); event.target.value = ""; return; }
    await saveLyrics(current.id, content);
    setLyricsResult({ syncedLyrics: content }); setLyricsError(""); setNotice(`已导入「${file.name}」歌词。`);
    event.target.value = "";
  }

  function rankForUser(candidates: TrackRecord[], library = tracks, favoriteIds = favorites, played = history.map((item) => item.track)) {
    return rankRecommendations(candidates, library, favoriteIds, played, {
      preferredRegions: preferredRegion === "ALL" ? [] : [preferredRegion],
      preferVocal: true,
      preferFullTracks: true,
      maxPerArtist: 3,
      maxPerIdentity: 1,
    });
  }

  async function refreshDiscovery(term?: string) {
    setDiscovering(true);
    setProviderWarnings([]);
    try {
      const seeds = term ? [] : buildDiscoverySeeds(tracks, favorites, history.map((item) => item.track));
      const result = term ? await searchMusic(term) : await discoverMusic(seeds);
      const ranked = rankForUser(result.tracks);
      setDiscovery(ranked);
      setProviderWarnings(result.warnings);
      if (ranked.length) await saveDiscovery("home-v35-search", ranked);
      else if (!result.warnings.length) setNotice("暂时没有找到时长达到 2 分钟、且非纯音乐的可播放歌曲。可以进入搜索页查看其他结果。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "音乐发现暂时不可用。");
    } finally { setDiscovering(false); }
  }

  async function startRadio(genre: string) {
    setActiveGenre(genre); setTab("radio"); setDiscovering(true); setProviderWarnings([]);
    try {
      const result = await searchMusic(genre);
      const ranked = rankForUser(result.tracks);
      setSearchResults(ranked); setProviderWarnings(result.warnings);
      if (ranked.length) {
        let started = false;
        for (const track of ranked.slice(0, 3)) {
          if (await playDiscoveryTrack(track, ranked)) { started = true; break; }
        }
        if (!started) setNotice(`「${genre}」的前三条候选音源暂时无法播放；不会无限重试。`);
      } else setNotice(`暂时没有找到可独立播放的「${genre}」音乐。`);
    } catch (err) { setError(err instanceof Error ? err.message : "电台搜索失败。"); }
    finally { setDiscovering(false); }
  }

  async function findSimilar() {
    if (!current) return;
    const term = current.artist?.trim() || current.title;
    setQuery(term); setTab("search"); setDiscovering(true);
    try {
      const result = await searchMusic(term);
      const ranked = rankForUser(result.tracks.filter((track) => track.id !== current.id), [current, ...tracks], [current.id, ...favorites]);
      setSearchResults(ranked); setProviderWarnings(result.warnings);
    } catch (err) { setError(err instanceof Error ? err.message : "相似音乐搜索失败。"); }
    finally { setDiscovering(false); }
  }

  async function runSearch(event?: FormEvent<HTMLFormElement>, searchTerm = query) {
    event?.preventDefault();
    const term = searchTerm.trim();
    if (!term) { setError("请输入歌曲名、歌手或音乐风格。"); return; }
    searchAbort.current?.abort();
    matchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    const sequence = ++searchSequence.current;
    const intent = parseMusicSearchIntent(term);
    setQuery(term);
    setTab("search");
    setDiscovering(true);
    setMatchingCatalogId(null);
    setMatchingCatalogStage(null);
    setActiveCatalogTrackId(null);
    setOfficialVideo(null);
    setError("");
    setProviderWarnings([]);
    setSearchResults([]);
    // Verified reference metadata is immediately available offline, but is NOT audio.
    setCatalogResults(verifiedCatalogTracks(term));
    try {
      const [audioResult, catalogResult] = await Promise.all([
        searchMusic(intent.normalizedQuery, controller.signal),
        searchAppleCatalog(term, controller.signal).catch((err) => ({
          tracks: verifiedCatalogTracks(term),
          warnings: [err instanceof Error ? `歌曲目录：${err.message}` : "歌曲目录暂时不可用。"],
        })),
      ]);
      if (controller.signal.aborted || sequence !== searchSequence.current) return;
      setSearchResults(audioResult.tracks);
      setCatalogResults(catalogResult.tracks);
      setProviderWarnings([...audioResult.warnings, ...catalogResult.warnings]);
      if (!audioResult.tracks.length && !catalogResult.tracks.length) {
        setNotice("没有找到对应歌曲资料或完整可播放音源。请尝试歌名、歌手，或核对网络连接。");
      }
    } catch (err) {
      if (!controller.signal.aborted && sequence === searchSequence.current) {
        setError(err instanceof Error ? err.message : "搜索失败。");
      }
    } finally {
      if (sequence === searchSequence.current) {
        searchAbort.current = null;
        setDiscovering(false);
      }
    }
  }

  function stopIndependentAudio() {
    playRequestId.current += 1;
    startingTrackId.current = "__official-video__";
    clearRecoveryTimer();
    recoveryAttempts.current = 0;
    playbackControllerFor(audioRef.current)?.pause();
    audioRef.current?.removeAttribute("src");
    audioRef.current?.load();
    setCurrent(null);
    setQueue([]);
    setQueueIndex(-1);
    setPlaying(false);
    setBuffering(false);
    setBusy(false);
    setPosition(0);
    setDuration(0);
    setBufferAhead(0);
  }

  function openVerifiedVideo(track: CatalogTrackRecord): boolean {
    const verified = verifiedRecordingForCatalog(track);
    if (!verified) return false;
    stopIndependentAudio();
    setActiveCatalogTrackId(track.id);
    setError("");
    setOfficialVideo(officialVideoSelection(verified));
    setNotice(`已在当前页面打开《${verified.title}》— ${verified.artist} 的官方视频。独立完整音频来源仍未确认；视频播放可能受平台限制。`);
    return true;
  }

  async function matchCatalogAudio(track: CatalogTrackRecord) {
    // Keep the current page and query. A catalog click is a direct-play request,
    // not a navigation action and not an invitation to choose a different song.
    if (matchingCatalogId) return;
    if (isCatalogTrackCurrent(track, current)) {
      togglePlayback();
      return;
    }

    const controller = new AbortController();
    matchAbort.current = controller;
    const searchAtStart = searchSequence.current;
    setOfficialVideo(null);
    let matchTimedOut = false;
    // A verified official video can be offered promptly if open providers stall.
    const deadline = window.setTimeout(() => {
      matchTimedOut = true;
      controller.abort(new Error("独立音源匹配超时"));
    }, verifiedRecordingForCatalog(track) ? 7000 : 14000);
    setMatchingCatalogId(track.id);
    setMatchingCatalogStage("matching");
    setActiveCatalogTrackId(track.id);
    setSearchResults([]);
    setError("");
    setNotice(`正在为《${track.title}》— ${track.artist} 匹配可播放音源…`);
    setProviderWarnings([]);

    // Stop the previous song so it cannot keep playing and be mistaken for
    // the requested track while matching runs.
    const audio = audioRef.current;
    playRequestId.current += 1;
    startingTrackId.current = "__catalog-match__";
    clearRecoveryTimer();
    recoveryAttempts.current = 0;
    playbackControllerFor(audio)?.pause();
    if (audio) {
      audio.removeAttribute("src");
      audio.load();
    }
    setCurrent(null);
    setQueue([]);
    setQueueIndex(-1);
    setPlaying(false);
    setBuffering(false);
    setBusy(false);
    setPosition(0);
    setDuration(0);
    setBufferAhead(0);
    setRecoveryStatus("");
    setResumeSnapshot(null);
    await savePlaybackSnapshot({
      key: "last-session", current: null, queue: [], queueIndex: -1,
      position: 0, volume, repeatMode, shuffle, updatedAt: Date.now(),
    }).catch(() => undefined);

    try {
      const healthById = new Map<string, SourceHealthSnapshot>(localCore.sourceHealth.map((item): [string, SourceHealthSnapshot] => [item.source_id || item.sourceId || "", {
        failureCount: item.failure_count ?? item.failureCount ?? 0,
        retryAt: item.retry_at ?? item.retryAt ?? null,
        lastSuccessAt: item.last_success_at ?? item.lastSuccessAt ?? null,
      }]));
      const resolution = await resolveCatalogAudio(track, tracks, searchMusic, controller.signal, healthById);
      if (controller.signal.aborted || searchAtStart !== searchSequence.current) return;
      setSearchResults(resolution.candidates);
      setProviderWarnings(resolution.warnings);

      if (resolution.matched) {
        setMatchingCatalogStage("buffering");
        setNotice(`已找到《${track.title}》— ${track.artist} 的匹配音源（匹配评分 ${resolution.sourceScores?.[0]?.score ?? "—"}），正在缓冲并直接播放…`);
        startingTrackId.current = null;
        const played = resolution.matched.kind === "remote-audio"
          ? await playDiscoveryTrack(resolution.matched, [resolution.matched, ...resolution.candidates.filter((item) => item.id !== resolution.matched?.id)])
          : await playTrack(resolution.matched, [resolution.matched]);
        if (!played && !controller.signal.aborted && searchAtStart === searchSequence.current) {
          if (!openVerifiedVideo(track)) setNotice(`没有找到《${track.title}》— ${track.artist} 的可靠可播放完整音源；未播放其他歌曲。`);
        }
      } else {
        setBuffering(false);
        setPlaying(false);
        if (!openVerifiedVideo(track)) setNotice(`没有找到《${track.title}》— ${track.artist} 对应的完整可播放音源。不会拿其他歌曲代替。`);
      }
    } catch (err) {
      if (searchAtStart === searchSequence.current && (!controller.signal.aborted || matchTimedOut)) {
        if (!openVerifiedVideo(track)) setError(err instanceof Error ? err.message : "匹配或播放音源失败。");
      }
    } finally {
      window.clearTimeout(deadline);
      if (matchAbort.current === controller) {
        matchAbort.current = null;
        if (startingTrackId.current === "__catalog-match__") startingTrackId.current = null;
        setMatchingCatalogId(null);
        setMatchingCatalogStage(null);
      }
    }
  }

  async function saveRecords(items: TrackRecord[]) {
    await saveTracks(items);
    setTracks(await getTracks());
  }

  async function addLocalAudio(files: File[], handles: FileSystemFileHandle[] = []) {
    const items = files.map((file, index): TrackRecord => {
      const id = trackId(file, "audio");
      sessionFiles.current.set(id, file);
      const filenameTitle = fileTitle(file.name);
      const recognized = parseMusicSearchIntent(filenameTitle);
      // Only infer artist/title from an unambiguous known filename pattern.
      // Unknown filenames remain unchanged and are never credited to a guessed singer.
      return {
        id, title: recognized.kind === "song" && recognized.title ? recognized.title : filenameTitle,
        ...(recognized.kind === "song" && recognized.artist ? { artist: recognized.artist } : {}),
        kind: "local-audio", provider: "local",
        fileName: file.name, size: file.size, addedAt: Date.now(),
        ...(handles[index] ? { audioHandle: handles[index] } : {}),
      };
    });
    await saveRecords(items);
    setNotice(`已加入 ${items.length} 首本地音频。文件只在本机读取。`);
  }

  async function importAudio() {
    setError("");
    if (!window.showOpenFilePicker) { audioInput.current?.click(); return; }
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: "音频文件", accept: { "audio/*": [".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus", ".flac"] } }],
      });
      const files = await Promise.all(handles.map((handle) => handle.getFile()));
      await addLocalAudio(files, handles);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "导入音频失败。");
    }
  }

  async function importAudioFallback(event: ChangeEvent<HTMLInputElement>) {
    try { await addLocalAudio(Array.from(event.target.files || [])); }
    catch (err) { setError(err instanceof Error ? err.message : "导入音频失败。"); }
    event.target.value = "";
  }

  async function importVideo() {
    setError("");
    if (!window.showOpenFilePicker) { videoInput.current?.click(); return; }
    try {
      const handles = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: "本地视频文件", accept: { "video/*": [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"] } }],
      });
      const handle = handles[0];
      await addVideoFile(await handle.getFile(), handle);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "导入视频失败。");
    }
  }

  async function importVideoFallback(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      try { await addVideoFile(file); }
      catch (err) { setError(err instanceof Error ? err.message : "提取视频音轨失败。"); }
    }
    event.target.value = "";
  }

  async function addVideoFile(file: File, handle?: FileSystemFileHandle) {
    const id = trackId(file, "video");
    sessionFiles.current.set(id, file);
    const record: TrackRecord = {
      id, title: fileTitle(file.name), kind: "extracted-video", provider: "local",
      fileName: file.name, size: file.size, addedAt: Date.now(),
      ...(handle ? { videoHandle: handle } : {}),
    };
    await saveRecords([record]);
    setTab("extract");
    await playTrack(record, [record, ...tracks]);
  }

  async function resolveTrackUrl(track: TrackRecord): Promise<string> {
    if (track.kind === "remote-audio") {
      if (!track.remoteUrl?.startsWith("https://")) throw new Error("在线音源地址无效或不是 HTTPS 地址。");
      return track.remoteUrl;
    }
    const cachedUrl = objectUrls.current.get(track.id);
    if (cachedUrl) return cachedUrl;
    let file: File | null = sessionFiles.current.get(track.id) || null;
    if (!file && track.kind === "local-audio" && track.audioHandle) file = await readHandle(track.audioHandle);
    if (!file && track.kind === "extracted-video" && track.videoHandle) file = await readHandle(track.videoHandle);
    if (!file) throw new Error("找不到本地文件。请重新导入原文件后播放。");
    if (track.kind === "extracted-video") {
      setNotice("正在使用本机 FFmpeg 提取音轨…");
      const blob = await extractAudio(file, setProgress);
      const url = URL.createObjectURL(blob);
      objectUrls.current.set(track.id, url);
      return url;
    }
    const url = URL.createObjectURL(file);
    objectUrls.current.set(track.id, url);
    return url;
  }

  function findFallbackTrack(track: TrackRecord): TrackRecord | undefined {
    // A fallback must be the same credited recording/version. Missing artist
    // metadata is never treated as a match; same-title substitution is forbidden.
    return [...tracks, ...discovery, ...searchResults].find((item) =>
      item.id !== track.id && !failedTrackIds.current.has(item.id)
      && item.kind === "remote-audio" && Boolean(item.remoteUrl?.startsWith("https://"))
      && sameTrackIdentity(track, item)
    );
  }

  function reportSourceHealth(track: TrackRecord, success: boolean, message = "") {
    if (track.kind !== "remote-audio") return;
    const sourceId = track.id.replace(/[^a-z0-9:_-]/gi, "_").slice(0, 256);
    const payload = { sourceId, provider: track.provider || "unknown", success, error: message };
    void fetch("/api/local/media/source-health/report", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }).catch(() => undefined);
  }

  async function playTrack(track: TrackRecord, list: TrackRecord[], startAt = 0, forceReload = false): Promise<boolean> {
    const audio = audioRef.current;
    if (!audio) return false;
    const requestId = ++playRequestId.current;
    setError("");
    clearRecoveryTimer(); recoveryAttempts.current = 0; failedTrackIds.current.delete(track.id); setRecoveryStatus("");
    if (current?.id === track.id && audio.src && !forceReload && startAt <= 0) { startingTrackId.current = null; setBusy(false); togglePlayback(); return true; }
    setOfficialVideo(null);
    startingTrackId.current = track.id;
    setBusy(true);
    setBuffering(true);
    setProgress(0);
    try {
      const url = await resolveTrackUrl(track);
      if (requestId !== playRequestId.current) return false;
      playbackControllerFor(audio)?.pause();
      audio.preload = "auto";
      audio.src = url;
      audio.load();
      setCurrent(track);
      setQueue(list);
      setQueueIndex(Math.max(0, list.findIndex((item) => item.id === track.id)));
      setPosition(0);
      setDuration(track.duration || 0);
      // Begin play() before waiting for a long buffer: otherwise user-gesture
      // activation can expire and browsers reject playback as an autoplay attempt.
      const readiness = await startBufferedPlayback(
        () => playbackControllerFor(audio)!.play(),
        () => waitUntilPlayable(audio, quality),
      );
      if (requestId !== playRequestId.current) return false;
      setBufferAhead(readiness.bufferedSeconds);
      if (readiness.degraded) setRecoveryStatus("音源缓冲较少，播放中会持续监测网络。");
      if (startAt > 0 && Number.isFinite(audio.duration) && startAt < audio.duration - 2) playbackControllerFor(audio)?.seek(startAt);
      sourceHealth.recordSuccess(track.id);
      void reportSourceHealth(track, true);
      startingTrackId.current = null;
      setPlaying(true);
      setBuffering(false);
      setNotice(`正在播放：${track.title}`);
      await addHistory(track, 0).catch(() => undefined);
      setHistory(await getHistory().catch(() => []));
      await persistSession(track, list, Math.max(0, list.findIndex((item) => item.id === track.id)), audio.currentTime);
      const nextIndex = list.findIndex((item) => item.id === track.id) + 1;
      const nextTrack = list[nextIndex];
      nextPreload.current?.pause();
      nextPreload.current = nextTrack?.kind === "remote-audio" ? preloadMetadata(nextTrack.remoteUrl) : null;
      return true;
    } catch (err) {
      if (requestId !== playRequestId.current) return false;
      if (startingTrackId.current === track.id) startingTrackId.current = null;
      setPlaying(false);
      setBuffering(false);
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")) {
        setError(err.name === "NotAllowedError" ? "浏览器阻止了自动播放，请点击播放器的播放按钮继续。" : "播放请求已被新的操作取消。请重试。 ");
        return false;
      }
      failedTrackIds.current.add(track.id);
      const failureMessage = err instanceof Error ? err.message : "无法播放该音源。";
      sourceHealth.recordFailure(track.id, failureMessage);
      reportSourceHealth(track, false, failureMessage);
      const fallback = findFallbackTrack(track);
      if (fallback) {
        setNotice(`当前音源不可用，正在尝试同一歌曲的另一个可用来源：${fallback.provider || "其他来源"}`);
        return await playTrack(fallback, [fallback, ...list.filter((item) => item.id !== fallback.id)]);
      } else {
        playbackControllerFor(audio)?.pause();
        audio.removeAttribute("src");
        audio.load();
        setCurrent(null);
        setQueue([]);
        setQueueIndex(-1);
        setError(err instanceof Error ? err.message : "无法播放该音源。");
      }
      return false;
    } finally { if (requestId === playRequestId.current) setBusy(false); }
  }

  function togglePlayback() {
    const audio = audioRef.current;
    const controller = playbackControllerFor(audio);
    if (!audio || !controller || !current) return;
    if (audio.paused) {
      setBuffering(true);
      controller.play().then(() => { setPlaying(true); setBuffering(false); }).catch(() => {
        setPlaying(false); setBuffering(false); setError("浏览器无法继续播放，请重新尝试。");
      });
    } else { controller.pause(); setPlaying(false); }
  }

  async function playNext() {
    if (!queue.length) { setPlaying(false); return; }
    if (repeatMode === "one" && audioRef.current) {
      playbackControllerFor(audioRef.current)?.seek(0);
      await playbackControllerFor(audioRef.current)?.play().catch(() => undefined);
      return;
    }
    let next = queueIndex + 1;
    if (shuffle && queue.length > 1) {
      do { next = Math.floor(Math.random() * queue.length); } while (next === queueIndex);
    } else if (next >= queue.length && repeatMode === "all") next = 0;
    if (next < 0 || next >= queue.length) { setPlaying(false); return; }
    await playTrack(queue[next], queue);
  }

  async function playPrevious() {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) { playbackControllerFor(audio)?.seek(0); setPosition(0); return; }
    if (queueIndex > 0) await playTrack(queue[queueIndex - 1], queue);
  }

  async function playDiscoveryTrack(track: TrackRecord, list: TrackRecord[]): Promise<boolean> {
    const existing = tracks.find((item) => item.id === track.id);
    // Do not persist an unverified remote source before the browser can play it.
    const played = await playTrack(existing || track, list);
    if (played && !existing) await saveRecords([track]).catch(() => undefined);
    return played;
  }

  async function addManualAudio(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!manualConsent) { setError("请确认你拥有该音频的播放权限。"); return; }
    try {
      const url = new URL(manualUrl.trim());
      if (url.protocol !== "https:") throw new Error("请使用 HTTPS 音频直链。");
      const track: TrackRecord = {
        id: `manual:${crypto.randomUUID()}`, title: manualTitle.trim() || "在线音频",
        kind: "remote-audio", provider: "manual", remoteUrl: url.toString(), sourceUrl: url.toString(), addedAt: Date.now(),
      };
      await saveRecords([track]);
      setManualUrl(""); setManualTitle(""); setManualConsent(false);
      await playTrack(track, [track, ...tracks]);
    } catch (err) { setError(err instanceof Error ? err.message : "音频链接无效。"); }
  }

  function toggleFavorite(track: TrackRecord) {
    setFavorites((old) => {
      const next = old.includes(track.id) ? old.filter((id) => id !== track.id) : [track.id, ...old];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function removeTrack(track: TrackRecord) {
    if (!window.confirm(`从 Music Free 移除「${track.title}」？不会删除 Mac 上的原文件。`)) return;
    await deleteTrack(track.id);
    const updatedPlaylists = playlists.filter((playlist) => playlist.trackIds.includes(track.id)).map((playlist) => ({ ...playlist, trackIds: playlist.trackIds.filter((id) => id !== track.id), updatedAt: Date.now() }));
    await Promise.all(updatedPlaylists.map((playlist) => savePlaylist(playlist)));
    if (updatedPlaylists.length) setPlaylists(await getPlaylists());
    setTracks((old) => old.filter((item) => item.id !== track.id));
    setFavorites((old) => {
      const next = old.filter((id) => id !== track.id);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
    sessionFiles.current.delete(track.id);
    const url = objectUrls.current.get(track.id);
    if (url) { URL.revokeObjectURL(url); objectUrls.current.delete(track.id); }
    if (current?.id === track.id) {
      playbackControllerFor(audioRef.current)?.pause();
      if (audioRef.current) { audioRef.current.removeAttribute("src"); audioRef.current.load(); }
      setPlaying(false); setCurrent(null);
      const remainingQueue = queue.filter((item) => item.id !== track.id);
      setQueue(remainingQueue); setQueueIndex(-1);
      await savePlaybackSnapshot({ key: "last-session", current: null, queue: remainingQueue, queueIndex: -1, position: 0, volume, repeatMode, shuffle, updatedAt: Date.now() }).catch(() => undefined);
    }
  }

  function onAudioError() {
    setPlaying(false); setBuffering(false); clearRecoveryTimer();
    // During initial loading, let playTrack's catch block perform a single fallback.
    if (startingTrackId.current) return;
    if (!current) return;
    failedTrackIds.current.add(current.id);
    const mediaError = "HTMLMediaElement 报告音源播放错误。";
    sourceHealth.recordFailure(current.id, mediaError);
    reportSourceHealth(current, false, mediaError);
    const fallback = findFallbackTrack(current);
    if (fallback) {
      setNotice(`当前音源不可用，正在尝试同一歌曲的另一个可用来源：${fallback.provider || "其他来源"}`);
      void playTrack(fallback, [fallback, ...queue.filter((item) => item.id !== fallback.id)]);
      return;
    }
    setError(`「${current.title}」播放失败。音源可能失效、限制直链播放或不支持当前格式。可以重试或选择其他歌曲。`);
  }

  function cycleRepeat() {
    setRepeatMode((old) => old === "off" ? "all" : old === "all" ? "one" : "off");
  }

  function selectGenre(genre: string) {
    setActiveGenre(genre);
    void runSearch(undefined, genre.toLowerCase());
  }

  function handleFloatPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    floatDrag.current = { x: event.clientX, y: event.clientY, startX: floatPosition.x, startY: floatPosition.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function handleFloatPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = floatDrag.current;
    if (!start) return;
    setFloatPosition({
      x: Math.max(12, Math.min(88, start.startX + ((event.clientX - start.x) / window.innerWidth) * 100)),
      y: Math.max(12, Math.min(window.innerHeight - 120, start.startY + event.clientY - start.y)),
    });
  }

  const pageTitle: Record<Tab, string> = {
    discover: "发现音乐", search: "搜索结果", radio: "智能电台", library: "音乐库",
    favorites: "我的喜欢", playlists: "我的歌单", extract: "音频工作台", settings: "设置",
  };
  return (
    <div className={`app theme-${theme}`} onDragOver={(event: ReactDragEvent<HTMLDivElement>) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event: ReactDragEvent<HTMLDivElement>) => { event.preventDefault(); const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("audio/")); if (files.length) void addLocalAudio(files); }}>
      <aside className="sidebar">
        <a className="brand" href="#top" onClick={(e) => { e.preventDefault(); setTab("discover"); }}>
          <span className="brand-mark">♫</span><span><b>Music Free</b><small>ULTIMATE MUSIC CENTER</small></span>
        </a>
        <div className="nav-caption">DISCOVER</div>
        <NavButton active={tab === "discover"} onClick={() => setTab("discover")} icon="◈" label="发现" />
        <NavButton active={tab === "search"} onClick={() => setTab("search")} icon="⌕" label="搜索" />
        <NavButton active={tab === "radio"} onClick={() => setTab("radio")} icon="◉" label="智能电台" />
        <div className="nav-caption nav-gap">YOUR MUSIC</div>
        <NavButton active={tab === "library"} onClick={() => setTab("library")} icon="▤" label="音乐库" count={tracks.length} />
        <NavButton active={tab === "favorites"} onClick={() => setTab("favorites")} icon="♡" label="我的喜欢" count={favorites.length} />
        <NavButton active={tab === "playlists"} onClick={() => setTab("playlists")} icon="▧" label="我的歌单" count={playlists.length} />
        <NavButton active={tab === "extract"} onClick={() => setTab("extract")} icon="⌁" label="音频工作台" />
        <div className="side-note"><span className="dot"/><b>本地优先</b><p>个人音乐库保存在 IndexedDB；后台元数据和音源健康记录保存在 Mac 本地磁盘。</p></div>
        <button className={`nav-item settings-link ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}><span>⚙</span>设置</button>
        <div className="side-foot">PRIVATE LISTENING SPACE · V4.1</div>
      </aside>

      <main className="main" id="top">
        <header className="topbar">
          <span>MUSIC FREE <i>/</i> {pageTitle[tab].toUpperCase()}</span>
          <form className="global-search" onSubmit={(event) => void runSearch(event)}>
            <span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索歌手、歌曲、专辑或风格…"/><kbd>↵</kbd>
          </form>
          <span className="top-status"><span className="dot"/> LOCAL MODE</span>
        </header>

        <input ref={audioInput} hidden type="file" accept="audio/*" multiple onChange={(event) => void importAudioFallback(event)} />
        <input ref={videoInput} hidden type="file" accept="video/*" onChange={(event) => void importVideoFallback(event)} />
        <input ref={lrcInput} hidden type="file" accept=".lrc,text/plain" onChange={(event) => void importLrc(event)} />
        <div className="content">
          {tab === "discover" && <>
            {resumeSnapshot?.current && <section className="resume-banner"><div><b>继续上次播放</b><small>{resumeSnapshot.current.title} · {resumeSnapshot.current.artist || "未知艺术家"}</small></div><button className="primary" onClick={() => void resumeLastSession()}>继续播放 ↗</button></section>}
            <section className="hero hero-v3">
              <div className="hero-copy">
                <div className="eyebrow"><span/> MUSIC, YOUR WAY</div>
                <h1>让音乐，<br/><em>自然发生。</em></h1>
                <p>优先发现华语、欧美、日韩和东南亚人声歌曲，也可搜索短视频热歌、鬼畜 Remix 与经典金曲。找到可用的完整独立音源后，直接进入 Music Free 播放器。</p>
                <div className="hero-actions"><button className="primary" onClick={() => void refreshDiscovery()} disabled={discovering}>↻ 换一批推荐</button><button className="outline" onClick={() => setTab("radio")}>进入智能电台</button></div>
              </div>
              <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-vinyl"><span>♫</span></div><i>✦</i></div>
            </section>
            <section className="panel">
              <PanelHeading eyebrow="EXPLORE BY REGION & STYLE" title="按风格探索" right={<span className="muted-small">人声优先 · 完整曲目优先 · 分类搜索不等于实时平台榜</span>}/>
              <div className="genre-grid">{GENRES.map((genre) => <button key={genre} className={`genre-chip ${activeGenre === genre ? "selected" : ""}`} onClick={() => selectGenre(genre)}>{genre}<span>↗</span></button>)}</div>
              <div className="region-explore"><b>按地区探索</b><div>{MUSIC_REGIONS.map((region) => <button type="button" key={region.id} onClick={() => selectGenre(region.label)}>{region.label}<span>↗</span></button>)}</div></div>
            </section>
            <section className="panel">
              <PanelHeading eyebrow="FRESH DISCOVERIES" title="为你发现" right={<button className="text-button" onClick={() => void refreshDiscovery()} disabled={discovering}>{discovering ? "正在发现…" : "刷新推荐 ↻"}</button>}/>
              {discovering && discovery.length === 0 ? <LoadingState label="正在搜索人声歌曲与多来源音乐搜索…"/> : discovery.length ? <TrackGrid tracks={discovery} onPlay={(track) => void playDiscoveryTrack(track, discovery)} current={current} playing={playing}/> : <EmptyState title="暂时没有推荐结果" text="可以搜索歌手、歌曲或地区流行音乐，也可以稍后重试。" action={<button className="primary" onClick={() => void refreshDiscovery()}>重新发现</button>}/>}
              {providerWarnings.length > 0 && <div className="provider-warnings">{providerWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
            </section>
            {history.length > 0 && <section className="panel"><PanelHeading eyebrow="PICK UP WHERE YOU LEFT OFF" title="最近播放" right={<button className="text-button" onClick={() => setTab("library")}>打开音乐库</button>}/><TrackRows tracks={history.slice(0, 5).map((item) => item.track)} current={current} playing={playing} onPlay={(track, list) => void playTrack(track, list)}/></section>}
          </>}

          {tab === "search" && <section className="panel">
            <PanelHeading eyebrow="SEARCH RESULTS" title={query ? `「${query}」的搜索结果` : "搜索音乐"} right={<span className="muted-small">歌曲目录 + 独立音源双层搜索</span>}/>
            <form className="search-large" onSubmit={(event) => void runSearch(event)}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：北京一夜、黄昏、周杰伦、Elvis Presley"/><button className="primary" type="submit" disabled={discovering}>搜索</button></form>
            {interpretedQuery.note && <div className="search-intent-note">⌕ {interpretedQuery.note}</div>}
            {discovering && (searchResults.length > 0 || catalogResults.length > 0) && <div className="search-intent-note">正在补充 Apple 目录和公开音源结果，已核对的资料可以先查看。</div>}
            {discovering && !matchingCatalogId && catalogResults.length === 0 && searchResults.length === 0 ? <LoadingState label="正在搜索歌曲资料和可用独立音源…"/> : (searchResults.length > 0 || catalogResults.length > 0) ? <>
              {catalogResults.length > 0 && <div className="catalog-results">
                <div className="catalog-heading"><div><b>歌曲目录结果</b><small>目录资料不等于完整音频。点击「一键播放」会优先寻找独立音源；找不到时，已核实的歌曲可在本页打开官方视频，不会播放错歌。</small></div><span>{catalogResults.length} 条</span></div>
                {catalogResults.slice(0, 12).map((item) => {
                  const isCurrent = isCatalogTrackCurrent(item, current);
                  const isMatching = matchingCatalogId === item.id;
                  const buttonLabel = isMatching
                    ? matchingCatalogStage === "buffering" || busy || buffering ? "正在缓冲…" : "正在匹配…"
                    : isCurrent ? (playing ? "Ⅱ 暂停" : "▶ 继续播放") : "▶ 一键播放";
                  return <div className="catalog-row" key={item.id}>
                    <div className="catalog-art">{item.coverUrl ? <img src={item.coverUrl} alt="" loading="lazy"/> : <span>♫</span>}</div>
                    <div className="catalog-info"><b>{item.title} {item.originalityLabel && <span className={`originality-badge ${item.originality || "unconfirmed"}`}>{item.originalityLabel}</span>}</b><small>{item.artist}{item.album ? ` · ${item.album}` : ""}{item.duration ? ` · ${timeLabel(item.duration)}` : " · 时长待确认"}{item.genre ? ` · ${item.genre}` : ""}</small><div className="catalog-provenance">{item.catalogSource === "verified-reference" ? "官方公开资料核对 · 非独立音频" : "Apple 歌曲目录 · 非独立音频"}</div></div>
                    <button type="button" className={`catalog-play ${isCurrent && playing ? "is-playing" : ""}`} disabled={matchingCatalogId !== null && !isMatching} onClick={() => isCurrent ? togglePlayback() : void matchCatalogAudio(item)}>{buttonLabel}</button>
                    {verifiedRecordingForCatalog(item) && <button type="button" className="catalog-play secondary-video" onClick={() => openVerifiedVideo(item)}>▶ 官方视频</button>}
                    {item.sourceUrl && <a className="source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">出处 ↗</a>}
                  </div>;
                })}
              </div>}
              {officialVideo && <OfficialVideoStage selection={officialVideo} onClose={() => setOfficialVideo(null)}/>}
              {visibleSearchResults.length > 0 ? <>
                <div className="search-filters"><label>来源 <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="all">全部来源</option><option value="audius">Audius</option><option value="openverse">Openverse</option><option value="internet-archive">Internet Archive</option><option value="manual">手动添加</option></select></label><label>地区 <select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value as MusicRegion | "ALL")}><option value="ALL">全部地区</option>{MUSIC_REGIONS.map((region) => <option key={region.id} value={region.id}>{region.label}</option>)}</select></label><label>版本 <select value={versionFilter} onChange={(event) => setVersionFilter(event.target.value as TrackRecord["versionKind"] | "ALL")}><option value="ALL">全部版本</option>{Object.entries(VERSION_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>许可 <select value={licenseFilter} onChange={(event) => setLicenseFilter(event.target.value)}><option value="all">全部许可</option><option value="cc0">CC0</option><option value="cc-by">CC BY / BY-SA</option><option value="public-domain">Public Domain</option><option value="commercial">CC BY-NC</option></select></label><label>排序 <select value={sortMode} onChange={(event) => setSortMode(event.target.value)}><option value="relevance">推荐顺序</option><option value="artist">艺术家</option><option value="duration-asc">时长从短到长</option><option value="duration-desc">时长从长到短</option></select></label><label className="filter-check"><input type="checkbox" checked={fullTracksOnly} onChange={(event) => setFullTracksOnly(event.target.checked)}/> 过滤已知短片段（小于 2 分钟）</label><label className="filter-check"><input type="checkbox" checked={vocalOnly} onChange={(event) => setVocalOnly(event.target.checked)}/> 隐藏已识别纯音乐</label></div>
                <div className="playlist-target"><label>加入歌单 <select value={selectedPlaylistId} onChange={(event) => setSelectedPlaylistId(event.target.value)}><option value="">选择歌单</option>{playlists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><small>在歌曲右侧点击 + 即可加入</small></div>
                <TrackRows tracks={visibleSearchResults} current={current} playing={playing} onPlay={(track, list) => void playDiscoveryTrack(track, list)} onAddToPlaylist={addToSelectedPlaylist}/>
              </> : catalogResults.length > 0 ? <EmptyState
                title={matchingCatalogId ? "正在匹配这首歌的音源…" : activeCatalogTrackId ? "没有找到这首歌的匹配音源" : "点击上方歌曲的「一键播放」"}
                text={matchingCatalogId ? "系统正在后台匹配歌名和歌手，匹配成功后会自动启动底部播放器。" : activeCatalogTrackId ? "当前公开音频来源没有提供这首歌对应的完整音源。已停止上一首，不会拿其他歌曲代替，也不需要你再选一首。" : "请直接点击上方歌曲旁边的「一键播放」。系统会自动匹配并播放，不需要从下面的其他歌曲列表中再选一次。"}
              /> : searchResults.length > 0 ? <EmptyState title="当前筛选条件下没有可播放音源" text="可以调整来源、许可或时长筛选条件后重试。"/> : <EmptyState title="没有找到可播放音源" text="可以尝试歌曲原名、歌手名、繁体/简体名称，或确认网络连接后重试。"/>}
            </> : <EmptyState title="没有找到歌曲资料" text="可以尝试歌曲原名、繁体/简体名称、歌手名，或确认网络连接后重试。"/>}
            {providerWarnings.map((warning) => <div className="warning-line" key={warning}>{warning}</div>)}
            <VideoSearchPanel query={interpretedQuery.normalizedQuery}/>
          </section>}

          {tab === "radio" && <section className="panel">
            <PanelHeading eyebrow="PERSONAL RADIO" title="智能电台" icon="◉"/>
            <p className="section-intro">选择一个音乐方向，Music Free 会搜索符合条件的独立音频，并按队列连续播放。第一版采用风格搜索，后续迭代再加入更细致的本地偏好模型。</p>
            <div className="radio-grid">{GENRES.map((genre, index) => <button className="radio-card" key={genre} onClick={() => void startRadio(genre.toLowerCase())}><span className="radio-number">0{index + 1}</span><b>{genre}</b><small>开启 {genre} 电台 ↗</small></button>)}</div>
            {searchResults.length > 0 && <><PanelHeading eyebrow="RADIO QUEUE" title={`${activeGenre} · ${searchResults.length} 首候选`}/><TrackRows tracks={searchResults} current={current} playing={playing} onPlay={(track, list) => void playDiscoveryTrack(track, list)}/><button className="primary" onClick={() => searchResults[0] && void playDiscoveryTrack(searchResults[0], searchResults)}>从第一首开始播放</button></>}
          </section>}

          {(tab === "library" || tab === "favorites") && <section className="panel">
            <PanelHeading eyebrow={tab === "library" ? "YOUR MUSIC COLLECTION" : "YOUR FAVORITES"} title={pageTitle[tab]} right={<div className="head-actions"><SearchBox value={query} onChange={setQuery}/><button className="outline" onClick={importAudio}>＋ 导入音频</button></div>}/>
            <div className="subline"><button className="text-button" onClick={() => setTab("extract")}>＋ 提取本地视频音轨</button><span>{filteredLibrary.length} 首 · 本地与在线音频</span></div>{tab === "library" && artistGroups.length > 0 && <div className="artist-chips"><b>艺术家实体 · {artistEntities.length}</b>{artistGroups.slice(0, 8).map((group) => <button key={group.artist} onClick={() => { setQuery(group.artist); setTab("library"); }}>{group.artist} <small>{group.count}</small></button>)}</div>}{tab === "library" && releaseEntities.length > 0 && <div className="release-entity-strip"><b>专辑实体 · {releaseEntities.length}</b>{releaseEntities.slice(0, 6).map((release) => <button type="button" key={release.id} onClick={() => { setQuery(release.title); setTab("library"); }}><span>{release.coverUrl ? <img src={release.coverUrl} alt=""/> : "▤"}</span><b>{release.title}</b><small>{release.artist} · {release.trackCount} 首</small></button>)}<small className="muted-small">已归并 {recordingEntities.length} 个录音身份</small></div>}{playlists.length > 0 && <div className="playlist-target"><label>加入歌单 <select value={selectedPlaylistId} onChange={(event) => setSelectedPlaylistId(event.target.value)}>{playlists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><small>点击歌曲右侧 + 添加</small></div>}
            {filteredLibrary.length ? <TrackRows tracks={filteredLibrary} current={current} playing={playing} onPlay={(track, list) => void playTrack(track, list)} favorites={favorites} onFavorite={toggleFavorite} onRemove={(track) => void removeTrack(track)} onAddToPlaylist={addToSelectedPlaylist}/> : <EmptyState title={tab === "favorites" ? "还没有喜欢的音乐" : "你的音乐库还是空的"} text={tab === "favorites" ? "在歌曲旁边点击爱心，收藏喜欢的音乐。" : "导入本地音频，或从发现页搜索可用的开放音频。"} action={<button className="primary" onClick={tab === "favorites" ? () => setTab("discover") : importAudio}>{tab === "favorites" ? "去发现音乐" : "导入本地音频"}</button>}/>}
          </section>}

          {tab === "playlists" && <section className="panel">
            <PanelHeading eyebrow="YOUR PLAYLISTS" title="我的歌单" right={<span className="muted-small">{playlists.length} 个歌单</span>}/>
            <form className="playlist-create" onSubmit={(event) => void createPlaylist(event)}><input value={playlistDraft} onChange={(event) => setPlaylistDraft(event.target.value)} placeholder="给新歌单起个名字，例如：深夜驾驶" maxLength={60}/><button className="primary" type="submit">＋ 创建歌单</button></form>
            {playlists.length > 0 ? <><div className="playlist-select-row"><label>当前歌单 <select value={selectedPlaylistId} onChange={(event) => setSelectedPlaylistId(event.target.value)}>{playlists.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.trackIds.length}）</option>)}</select></label>{playlists.find((item) => item.id === selectedPlaylistId) && <button className="outline danger-button" onClick={() => void removePlaylist(playlists.find((item) => item.id === selectedPlaylistId)!)}>删除歌单</button>}</div>
            {(() => { const selected = playlists.find((item) => item.id === selectedPlaylistId); const list = selected ? selected.trackIds.map((id) => tracks.find((track) => track.id === id)).filter((track): track is TrackRecord => Boolean(track)) : []; return selected ? <>{list.length > 0 && <div className="playlist-actions"><button className="primary" onClick={() => void playTrack(list[0], list)}>▶ 播放全部</button><span>{list.length} 首歌曲</span></div>}{list.length ? <TrackRows tracks={list} current={current} playing={playing} onPlay={(track, rows) => void playTrack(track, rows)} onRemove={(track) => void removeFromPlaylist(selected, track.id)}/> : <EmptyState title="这个歌单还是空的" text="去搜索音乐，在歌曲右侧点击 + 加入当前歌单。" action={<button className="outline" onClick={() => setTab("search")}>去搜索音乐</button>}/>}</> : null; })()}</> : <EmptyState title="还没有创建歌单" text="创建自己的歌单，按场景、心情或歌手整理音乐。"/>}
          </section>}

          {tab === "extract" && <>
            <LocalMediaWorkbench />
            <section className="panel">
              <PanelHeading eyebrow="QUICK LOCAL AUDIO" title="快速添加到音乐库" icon="⌁"/>
              <div className="drop-zone"><div className="drop-icon">♫</div><b>快速提取音轨并加入个人音乐库</b><p>适合只想提取音频并立即播放的情况。需要选择多条音轨或同时分离视频轨，请使用上方双轨工作台。</p><button className="primary" disabled={busy} onClick={importVideo}>{busy ? "正在处理…" : "选择本地视频"}</button><div className="formats"><span>MP4</span><span>MOV</span><span>M4V</span><span>WEBM</span><span>MKV</span></div></div>
              {busy && <div className="progress-box"><div><b>正在本地提取音轨</b><strong>{progress}%</strong></div><div className="progress"><i style={{ width: `${progress}%` }}/></div><small>首次使用会启动本地 FFmpeg 引擎。</small></div>}
              <div className="privacy-points"><div><b>01 · 本地处理</b><span>视频由浏览器读取</span></div><div><b>02 · 内存播放</b><span>提取结果不持久化</span></div><div><b>03 · 不提供下载</b><span>没有导出按钮</span></div></div>
            </section>
            <section className="panel"><PanelHeading eyebrow="AUTHORIZED AUDIO URL" title="添加在线音频直链"/><form className="manual-form" onSubmit={(event) => void addManualAudio(event)}><input value={manualUrl} onChange={(event) => setManualUrl(event.target.value)} placeholder="https://example.com/authorized-audio.mp3"/><input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="歌曲名称（可选）"/><label className="consent"><input type="checkbox" checked={manualConsent} onChange={(event) => setManualConsent(event.target.checked)}/> 我确认拥有该音频的播放权限，且允许该链接直接播放。</label><button className="outline" type="submit">加入音乐库并播放</button></form></section>
          </>}

          {tab === "settings" && <>
             <section className="panel"><PanelHeading eyebrow="LOCAL CORE" title="本地后台发现服务"/><div className="setting-row"><div><b>本地服务状态</b><small>{localCore.online ? `服务运行中 · 后台每 ${localCore.health?.discovery.intervalHours || 6} 小时刷新一次音乐元数据` : (localCore.error || "本地服务未连接，请通过 npm run dev 启动完整服务")}</small></div><span className={localCore.online ? "setting-on" : "muted-small"}>{localCore.online ? "运行中" : "未连接"}</span></div><div className="setting-row"><div><b>本地媒体引擎</b><small>{localCore.mediaCapabilities ? `浏览器 FFmpeg.wasm · ${localCore.mediaCapabilities.native.ffmpeg.available ? "检测到本机 FFmpeg" : "未检测到本机 FFmpeg（不影响浏览器本地处理）"} · 最大单文件 250 MB` : "等待媒体能力检测"}</small></div><span className="setting-on">{localCore.mediaCapabilities?.browserWasm.required ? "本地模式" : "未检测"}</span></div><div className="setting-row"><div><b>音源健康监控</b><small>{localCore.sourceHealth.length ? `${localCore.sourceHealth.length} 个音源有记录，其中 ${localCore.sourceHealth.filter((item) => item.status !== "ok").length} 个最近播放异常` : "尚无播放异常记录"}</small></div><span className="muted-small">本地记录</span></div><div className="setting-row"><div><b>后台发现缓存</b><small>{localCore.health?.discovery.lastRunAt ? `上次更新：${new Date(localCore.health.discovery.lastRunAt).toLocaleString()}` : "尚未完成首次发现任务"} · {localCore.discovery?.tracks.length || 0} 首元数据</small></div><span className="muted-small">仅元数据</span></div>{localCore.health?.discovery.lastError && <div className="warning-line">后台发现：{localCore.health.discovery.lastError}</div>}<div className="setting-row"><div><b>立即刷新公开音乐元数据</b><small>只刷新公开音乐目录信息，不下载或缓存音频文件。</small></div><button className="outline" disabled={!localCore.online || localCore.refreshing} onClick={() => void localCore.refreshNow()}>{localCore.refreshing ? "正在启动…" : "立即刷新"}</button></div></section>
             <section className="panel"><PanelHeading eyebrow="APPEARANCE" title="界面主题"/><div className="theme-grid">{THEMES.map((item) => <button key={item.id} className={`theme-card theme-preview-${item.id} ${theme === item.id ? "chosen" : ""}`} onClick={() => setTheme(item.id)}><span className="theme-swatch"/><b>{item.name}</b><small>{item.description}</small>{theme === item.id && <i>✓</i>}</button>)}</div></section>
            <section className="panel"><PanelHeading eyebrow="MUSIC INTELLIGENCE" title="音乐发现偏好"/><div className="setting-row"><div><b>优先推荐地区</b><small>影响发现和智能电台的排序，不会排除其他地区的搜索结果。</small></div><select value={preferredRegion} onChange={(event) => setPreferredRegion(event.target.value as MusicRegion | "ALL")}><option value="ALL">不限地区</option>{MUSIC_REGIONS.map((region) => <option key={region.id} value={region.id}>{region.label}</option>)}</select></div><div className="setting-row"><div><b>音乐身份管理</b><small>{artistEntities.length} 位艺术家 · {releaseEntities.length} 张专辑 · {recordingEntities.length} 个录音身份</small></div><span className="setting-on">已启用</span></div></section><section className="panel"><PanelHeading eyebrow="PLAYBACK" title="播放偏好"/><div className="setting-row"><div><b>缓冲策略</b><small>稳定优先会等待更多可播放数据再启动，实际缓冲由音源服务器和浏览器决定。</small></div><select value={quality} onChange={(event) => setQuality(event.target.value as PlaybackQuality)}><option value="stable">稳定优先</option><option value="balanced">均衡模式</option><option value="fast">极速模式</option></select></div><div className="setting-row"><div><b>悬浮歌词</b><small>在页面上显示可拖动的歌词浮窗。</small></div><label className="switch"><input type="checkbox" checked={floatingLyrics} onChange={(event) => setFloatingLyrics(event.target.checked)}/><span/></label></div><div className="setting-row"><div><b>自动歌词</b><small>播放歌曲时尝试从 LRCLIB 匹配同步歌词。</small></div><span className="setting-on">开启</span></div></section>
            <section className="panel"><PanelHeading eyebrow="PLAYBACK HEALTH" title="播放状态诊断"/><div className="setting-row"><div><b>网络提示</b><small>{networkHint}</small></div><span className="setting-on">{navigator.onLine ? "在线" : "离线"}</span></div><div className="setting-row"><div><b>当前缓冲</b><small>浏览器报告的当前播放位置后方已缓冲时长。</small></div><span className="setting-on">{bufferAhead.toFixed(1)} 秒</span></div><div className="setting-row"><div><b>播放恢复</b><small>{recoveryStatus || "自动监测卡顿；连续失败后停止重试，避免无限循环。"}</small></div><button className="outline" disabled={!current || busy} onClick={() => void retryCurrent()}>重试当前歌曲</button></div></section>
            <section className="panel"><PanelHeading eyebrow="LOCAL DATA" title="本地数据与隐私"/><p className="section-intro">音乐库、收藏、最近播放和播放状态继续保存在浏览器 IndexedDB；后台自动发现结果、Provider 元数据快照和任务调度状态另外保存到 Mac 本地 SQLite（WAL 模式）。清理浏览器缓存不会删除这份磁盘数据库。远程音频本身不写入本地持久化缓存。</p><div className="setting-row"><div><b>本地磁盘缓存</b><small>{localCore.health?.storage ? `${localCore.health.storage.engine === "sqlite-wal" ? "SQLite WAL" : "JSON 兼容存储"} · ${(localCore.health.storage.databaseBytes / 1024 / 1024).toFixed(2)} MB 数据库 · ${(localCore.health.storage.walBytes / 1024 / 1024).toFixed(2)} MB WAL · ${localCore.health.storage.snapshots} 个发现快照 · ${localCore.health.storage.cacheEntries} 个缓存条目 · ${(localCore.health.storage.cacheBytes / 1024 / 1024).toFixed(2)} MB 元数据缓存` : "等待本地服务连接"}</small></div><span className="setting-on">{localCore.health?.storage?.engine === "sqlite-wal" ? "已启用" : localCore.online ? "兼容模式" : "未连接"}</span></div><div className="setting-row"><div><b>音乐库</b><small>{tracks.length} 首曲目</small></div><button className="outline" onClick={() => void getTracks().then(setTracks)}>重新读取</button></div><div className="setting-row"><div><b>清空搜索与推荐缓存</b><small>不会删除本地音乐库和收藏。</small></div><button className="outline danger-button" onClick={() => { void saveDiscovery("home-v35-search", []).then(() => setDiscovery([])); setNotice("已清空推荐缓存。"); }}>清空缓存</button></div></section>
          </>}

          {notice && <div className="toast ok"><span>✓</span>{notice}<button onClick={() => setNotice("")}>×</button></div>}
          {error && <div className="toast bad"><span>!</span>{error}<button onClick={() => setError("")}>×</button></div>}
          <footer className="footer"><span>Music Free V4.1.1 · Modular Music Experience</span><span>Local-first · Official video providers · Durable metadata cache</span></footer>
        </div>
      </main>

      {immersiveOpen && current && <ImmersivePlayer track={current} playing={playing} buffering={buffering} position={position} duration={duration} lyrics={lyricLines} activeLyricIndex={lyricIndex} theme={theme} onTogglePlayback={togglePlayback} onPrevious={() => void playPrevious()} onNext={() => void playNext()} onSeek={(value) => { if (audioRef.current) playbackControllerFor(audioRef.current)?.seek(value); setPosition(value); }} onClose={() => setImmersiveOpen(false)}/>}

      {floatingLyrics && current && <div className="floating-lyrics" style={{ left: `${floatPosition.x}%`, top: `${floatPosition.y}px` }} onPointerDown={handleFloatPointerDown} onPointerMove={handleFloatPointerMove} onPointerUp={() => { floatDrag.current = null; }} onPointerCancel={() => { floatDrag.current = null; }}>
        <div className="float-handle"><span>⋮⋮ &nbsp; MUSIC FREE LYRICS</span><button onClick={() => setFloatingLyrics(false)}>×</button></div>
        <b>{lyricLines[lyricIndex]?.text || (lyricsLoading ? "正在匹配歌词…" : current.title)}</b>
        <small>{current.artist || ""}</small>
      </div>}

      {showQueue && <div className="queue-drawer"><div className="drawer-head"><b>接下来播放 · {queue.length}</b><button onClick={() => setShowQueue(false)}>×</button></div><div className="queue-list">{queue.map((track, index) => <div className={`queue-item ${current?.id === track.id ? "active" : ""}`} key={`${track.id}-${index}`}><button className="queue-play" onClick={() => void playTrack(track, queue)}>{current?.id === track.id && playing ? "Ⅱ" : "▶"}</button><div className="queue-meta"><b>{track.title}</b><small>{track.artist || providerLabel(track)}</small></div><button title="上移" disabled={index === 0} onClick={() => moveQueueItem(index, index - 1)}>↑</button><button title="下移" disabled={index === queue.length - 1} onClick={() => moveQueueItem(index, index + 1)}>↓</button></div>)}</div></div>}

      <section className="player">
        <audio ref={audioRef} preload="none" onTimeUpdate={(event) => { const value = event.currentTarget.currentTime; setPosition(value); if (Date.now() - lastSnapshotAt.current > 5000 && current) { lastSnapshotAt.current = Date.now(); void persistSession(current, queue, queueIndex, value); } }} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || current?.duration || 0)} onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)} onProgress={(event) => { setBufferAhead(getBufferedAhead(event.currentTarget)); }} onWaiting={() => { setBuffering(true); scheduleRecovery(); }} onStalled={() => { setBuffering(true); scheduleRecovery(); }} onPlaying={() => { clearRecoveryTimer(); setRecoveryStatus(""); setBuffering(false); setPlaying(true); if (audioRef.current) setBufferAhead(getBufferedAhead(audioRef.current)); }} onPause={(event) => { clearRecoveryTimer(); setPlaying(false); if (current) void persistSession(current, queue, queueIndex, event.currentTarget.currentTime); }} onEnded={() => void playNext()} onError={onAudioError}/>
        <div className="now-playing"><div className="mini-cover">{current?.coverUrl ? <img src={current.coverUrl} alt=""/> : "♫"}</div><div className="now-meta"><b>{current?.title || "尚未播放"}</b><small>{current ? `${current.artist || providerLabel(current)} · ${providerLabel(current)}` : "从发现页或音乐库选择一首音乐"}</small></div>{current && <button className={`heart ${currentFavorite ? "liked" : ""}`} onClick={() => toggleFavorite(current)}>{currentFavorite ? "♥" : "♡"}</button>}</div>
        <div className="player-center"><div className={`visualizer ${playing ? "active" : ""}`} aria-hidden="true">{Array.from({ length: 23 }, (_, index) => <i key={index} style={{ animationDelay: `${(index % 7) * -0.13}s` }}/>)}</div><div className="control-buttons"><button title="随机播放" className={shuffle ? "control-active" : ""} onClick={() => setShuffle((value) => !value)}>⤨</button><button title="上一首" onClick={() => void playPrevious()} disabled={!current}>|◀</button><button className="play-main" title={playing ? "暂停" : "播放"} onClick={togglePlayback} disabled={!current}>{buffering ? "…" : playing ? "Ⅱ" : "▶"}</button><button title="下一首" onClick={() => void playNext()} disabled={!current}>▶|</button><button title={`循环：${repeatMode}`} className={repeatMode !== "off" ? "control-active" : ""} onClick={cycleRepeat}>{repeatMode === "one" ? "↻¹" : "↻"}</button></div>{recoveryStatus && <div className="playback-status">{recoveryStatus}</div>}<div className="timeline"><span>{timeLabel(position)}</span><input type="range" min="0" max={Math.max(duration, 1)} value={Math.min(position, duration || 0)} onChange={(event) => { const value = Number(event.target.value); if (audioRef.current) playbackControllerFor(audioRef.current)?.seek(value); setPosition(value); }} style={{ "--progress": `${duration > 0 ? position / duration * 100 : 0}%` } as CSSProperties} disabled={!current}/><span>{timeLabel(duration)}</span></div></div>
        <div className="player-tools"><button title="歌词" className={showPlainLyrics ? "control-active" : ""} onClick={() => setShowPlainLyrics((value) => !value)}>词</button><button title="悬浮歌词" className={floatingLyrics ? "control-active" : ""} onClick={() => setFloatingLyrics((value) => !value)}>浮</button><button title="找相似音乐" onClick={() => void findSimilar()} disabled={!current}>相似</button><button title="播放队列" onClick={() => setShowQueue((value) => !value)}>☷</button><label className="volume-control"><span>♪</span><input type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))}/></label><button title="沉浸式播放" onClick={() => setImmersiveOpen(true)} disabled={!current}>⛶</button></div>
      </section>

      {showPlainLyrics && <div className="lyrics-panel"><div className="lyrics-head"><b>歌词 · {current?.title || "未播放"}</b><div className="lyrics-actions"><button onClick={() => lrcInput.current?.click()}>导入 LRC</button><button onClick={() => setLyricOffset((value) => Math.max(-10, Math.min(10, value - 0.2)))}>−0.2s</button><button onClick={() => setLyricOffset((value) => Math.max(-10, Math.min(10, value + 0.2)))}>+0.2s</button><button onClick={() => setShowPlainLyrics(false)}>×</button></div></div>{lyricsLoading ? <p className="lyrics-muted">正在查找歌词…</p> : lyricsError ? <p className="lyrics-muted">{lyricsError}</p> : lyricLines.length ? <div className="lyrics-scroll">{lyricLines.map((line, index) => <p key={`${line.time}-${index}`} className={index === lyricIndex ? "lyric-active" : ""} onClick={() => { if (audioRef.current) playbackControllerFor(audioRef.current)?.seek(line.time); }}>{line.text}</p>)}</div> : <p className="lyrics-muted">{lyricsResult?.plainLyrics || "暂时没有找到同步歌词。可以点击上方「导入 LRC」使用本地歌词。"}</p>}</div>}
    </div>
  );
}

