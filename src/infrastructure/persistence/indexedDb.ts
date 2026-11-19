import type { PlaybackSnapshot, PlaylistRecord, TrackRecord } from "../../domain/music/types";

// Keep the V2.2 database name to preserve existing local music records.
const DB = "music-free-v22";
const VERSION = 3;
const TRACKS = "tracks";
const DISCOVERY = "discovery";
const HISTORY = "history";
const PLAYLISTS = "playlists";
const STATE = "state";
const LYRICS = "lyrics";

type DiscoveryCache = { key: string; items: TrackRecord[]; updatedAt: number };
type HistoryRecord = { id: string; track: TrackRecord; playedAt: number; position?: number };
type LyricsRecord = { trackId: string; content: string; updatedAt: number };

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRACKS)) db.createObjectStore(TRACKS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(DISCOVERY)) db.createObjectStore(DISCOVERY, { keyPath: "key" });
      if (!db.objectStoreNames.contains(HISTORY)) db.createObjectStore(HISTORY, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PLAYLISTS)) db.createObjectStore(PLAYLISTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STATE)) db.createObjectStore(STATE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(LYRICS)) db.createObjectStore(LYRICS, { keyPath: "trackId" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("音乐数据库正在被其他页面占用，请关闭旧版 Music Free 标签页后重试。"));
  });
}

function requestResult<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, action: (objectStore: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("数据库事务已中止。")); };
  });
}

export async function getTracks(): Promise<TrackRecord[]> {
  const db = await openDB();
  const rows = await requestResult<TrackRecord[]>(db, TRACKS, "readonly", (store) => store.getAll());
  return rows.sort((a, b) => b.addedAt - a.addedAt);
}

export async function saveTracks(items: TrackRecord[]): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TRACKS, "readwrite");
    items.forEach((item) => tx.objectStore(TRACKS).put(item));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("保存曲目失败。")); };
  });
}

export async function deleteTrack(id: string): Promise<void> {
  const db = await openDB();
  await requestResult<undefined>(db, TRACKS, "readwrite", (store) => store.delete(id));
}

export async function getDiscovery(key = "home"): Promise<DiscoveryCache | null> {
  const db = await openDB();
  return (await requestResult<DiscoveryCache | undefined>(db, DISCOVERY, "readonly", (store) => store.get(key))) || null;
}

export async function saveDiscovery(key: string, items: TrackRecord[]): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DISCOVERY, "readwrite");
    tx.objectStore(DISCOVERY).put({ key, items, updatedAt: Date.now() } satisfies DiscoveryCache);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function addHistory(track: TrackRecord, position = 0): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HISTORY, "readwrite");
    tx.objectStore(HISTORY).put({ id: `${track.id}`, track, playedAt: Date.now(), position } satisfies HistoryRecord);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getHistory(): Promise<HistoryRecord[]> {
  const db = await openDB();
  const rows = await requestResult<HistoryRecord[]>(db, HISTORY, "readonly", (store) => store.getAll());
  return rows.sort((a, b) => b.playedAt - a.playedAt).slice(0, 100);
}

export async function getPlaylists(): Promise<PlaylistRecord[]> {
  const db = await openDB();
  const rows = await requestResult<PlaylistRecord[]>(db, PLAYLISTS, "readonly", (store) => store.getAll());
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function savePlaylist(playlist: PlaylistRecord): Promise<void> {
  const db = await openDB();
  await requestResult<IDBValidKey>(db, PLAYLISTS, "readwrite", (store) => store.put(playlist));
}

export async function deletePlaylist(id: string): Promise<void> {
  const db = await openDB();
  await requestResult<undefined>(db, PLAYLISTS, "readwrite", (store) => store.delete(id));
}

export async function savePlaybackSnapshot(snapshot: PlaybackSnapshot): Promise<void> {
  const db = await openDB();
  await requestResult<IDBValidKey>(db, STATE, "readwrite", (store) => store.put(snapshot));
}

export async function getPlaybackSnapshot(): Promise<PlaybackSnapshot | null> {
  const db = await openDB();
  return (await requestResult<PlaybackSnapshot | undefined>(db, STATE, "readonly", (store) => store.get("last-session"))) || null;
}

export async function saveLyrics(trackId: string, content: string): Promise<void> {
  const db = await openDB();
  await requestResult<IDBValidKey>(db, LYRICS, "readwrite", (store) => store.put({ trackId, content, updatedAt: Date.now() } satisfies LyricsRecord));
}

export async function getLyrics(trackId: string): Promise<string | null> {
  const db = await openDB();
  const record = await requestResult<LyricsRecord | undefined>(db, LYRICS, "readonly", (store) => store.get(trackId));
  return record?.content || null;
}
