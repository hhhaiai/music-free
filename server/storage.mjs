import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cache_entries (
  namespace TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  accessed_at INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  PRIMARY KEY(namespace, cache_key)
);
CREATE INDEX IF NOT EXISTS idx_cache_expiry ON cache_entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_access ON cache_entries(accessed_at);
CREATE TABLE IF NOT EXISTS discovery_snapshots (
  source TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS task_state (
  task_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  last_started_at INTEGER,
  last_success_at INTEGER,
  next_run_at INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER
);
CREATE TABLE IF NOT EXISTS provider_health (
  provider TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  last_success_at INTEGER,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS app_meta (
  meta_key TEXT PRIMARY KEY,
  meta_value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS media_source_health (
  source_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  last_success_at INTEGER,
  last_failure_at INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_media_source_retry ON media_source_health(retry_at);
`;

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function createJsonFallback(dataDir) {
  const filePath = join(dataDir, "local-store-fallback.json");
  const state = { cache: [], snapshots: [], tasks: [], providers: [], meta: [], mediaSources: [] };
  let writeChain = Promise.resolve();
  async function persist() {
    writeChain = writeChain.then(async () => {
      const { writeFile, rename } = await import("node:fs/promises");
      const temp = `${filePath}.tmp`;
      await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
      await rename(temp, filePath);
    });
    return writeChain;
  }
  return {
    engine: "json-fallback",
    databasePath: filePath,
    async init() {
      try {
        const saved = JSON.parse(await readFile(filePath, "utf8"));
        Object.assign(state, saved);
        state.mediaSources ||= [];
      } catch (error) { if (error?.code !== "ENOENT") throw error; }
    },
    async cacheGet(namespace, key) {
      const row = state.cache.find((x) => x.namespace === namespace && x.key === key);
      if (!row) return null;
      if (row.expiresAt && row.expiresAt <= Date.now()) { state.cache = state.cache.filter((x) => x !== row); await persist(); return null; }
      row.accessedAt = Date.now(); await persist(); return row.value;
    },
    async cacheSet(namespace, key, value, { ttlMs = 0 } = {}) {
      state.cache = state.cache.filter((x) => !(x.namespace === namespace && x.key === key));
      state.cache.push({ namespace, key, value, createdAt: Date.now(), expiresAt: ttlMs ? Date.now() + ttlMs : null, accessedAt: Date.now(), sizeBytes: Buffer.byteLength(JSON.stringify(value)) });
      await persist();
    },
    async saveSnapshot(source, payload) {
      state.snapshots = state.snapshots.filter((x) => x.source !== source);
      state.snapshots.push({ source, updatedAt: payload.updatedAt || Date.now(), payload });
      await persist();
    },
    async getSnapshot(source) { return state.snapshots.find((x) => x.source === source)?.payload || null; },
    async listSnapshots() { return state.snapshots.map((x) => ({ source: x.source, ...x.payload })); },
    async saveTaskState(task) {
      state.tasks = state.tasks.filter((x) => x.taskId !== task.taskId);
      state.tasks.push(task); await persist();
    },
    async getTaskState(taskId) { return state.tasks.find((x) => x.taskId === taskId) || null; },
    async listTaskStates() { return [...state.tasks]; },
    async saveProviderHealth(item) {
      state.providers = state.providers.filter((x) => x.provider !== item.provider);
      state.providers.push(item); await persist();
    },
    async saveMediaSourceHealth(item) {
      state.mediaSources = state.mediaSources.filter((x) => x.sourceId !== item.sourceId);
      state.mediaSources.push(item);
      state.mediaSources.sort((a, b) => (b.checkedAt || 0) - (a.checkedAt || 0));
      state.mediaSources = state.mediaSources.slice(0, 500);
      await persist();
    },
    async getMediaSourceHealth(sourceId) { return state.mediaSources.find((x) => x.sourceId === sourceId) || null; },
    async listMediaSourceHealth() { return [...state.mediaSources].sort((a, b) => (b.checkedAt || 0) - (a.checkedAt || 0)); },
    async getStats() {
      let bytes = 0; try { bytes = (await stat(filePath)).size; } catch {}
      return { engine: "json-fallback", databasePath: filePath, databaseBytes: bytes, walBytes: 0, cacheEntries: state.cache.length, cacheBytes: state.cache.reduce((n, x) => n + x.sizeBytes, 0), snapshots: state.snapshots.length, tasks: state.tasks.length };
    },
    async pruneExpired() {
      const before = state.cache.length;
      state.cache = state.cache.filter((x) => !x.expiresAt || x.expiresAt > Date.now());
      await persist();
      return before - state.cache.length;
    },
    async close() { await persist(); },
  };
}

export async function createLocalStore({ dataDir } = {}) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  let sqlite;
  try { sqlite = await import("node:sqlite"); } catch { sqlite = null; }
  if (!sqlite?.DatabaseSync) {
    const fallback = createJsonFallback(dataDir);
    await fallback.init();
    return fallback;
  }

  const databasePath = join(dataDir, "music-free.sqlite");
  const db = new sqlite.DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=FULL;");
  db.exec("PRAGMA busy_timeout=5000;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec("PRAGMA wal_autocheckpoint=1000;");
  db.exec(SCHEMA);

  const statements = {
    cacheGet: db.prepare("SELECT value_json, expires_at FROM cache_entries WHERE namespace=? AND cache_key=?"),
    cacheTouch: db.prepare("UPDATE cache_entries SET accessed_at=? WHERE namespace=? AND cache_key=?"),
    cacheDelete: db.prepare("DELETE FROM cache_entries WHERE namespace=? AND cache_key=?"),
    cacheSet: db.prepare(`INSERT INTO cache_entries(namespace,cache_key,value_json,created_at,expires_at,accessed_at,size_bytes)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(namespace,cache_key) DO UPDATE SET
      value_json=excluded.value_json, created_at=excluded.created_at, expires_at=excluded.expires_at,
      accessed_at=excluded.accessed_at, size_bytes=excluded.size_bytes`),
    snapshotGet: db.prepare("SELECT payload_json FROM discovery_snapshots WHERE source=?"),
    snapshotSet: db.prepare(`INSERT INTO discovery_snapshots(source,updated_at,payload_json,item_count) VALUES(?,?,?,?)
      ON CONFLICT(source) DO UPDATE SET updated_at=excluded.updated_at,payload_json=excluded.payload_json,item_count=excluded.item_count`),
    snapshotList: db.prepare("SELECT source,payload_json FROM discovery_snapshots ORDER BY updated_at DESC"),
    taskGet: db.prepare("SELECT * FROM task_state WHERE task_id=?"),
    taskList: db.prepare("SELECT * FROM task_state ORDER BY task_id"),
    taskSet: db.prepare(`INSERT INTO task_state(task_id,provider,status,last_started_at,last_success_at,next_run_at,failure_count,last_error,item_count,duration_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET provider=excluded.provider,status=excluded.status,
      last_started_at=excluded.last_started_at,last_success_at=excluded.last_success_at,next_run_at=excluded.next_run_at,
      failure_count=excluded.failure_count,last_error=excluded.last_error,item_count=excluded.item_count,duration_ms=excluded.duration_ms`),
    providerSet: db.prepare(`INSERT INTO provider_health(provider,status,checked_at,last_success_at,last_error,consecutive_failures)
      VALUES(?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at,
      last_success_at=excluded.last_success_at,last_error=excluded.last_error,consecutive_failures=excluded.consecutive_failures`),
    mediaSourceGet: db.prepare("SELECT * FROM media_source_health WHERE source_id=?"),
    mediaSourceList: db.prepare("SELECT * FROM media_source_health ORDER BY checked_at DESC LIMIT 200"),
    mediaSourceSet: db.prepare(`INSERT INTO media_source_health(source_id,provider,status,checked_at,last_success_at,last_failure_at,failure_count,retry_at,last_error)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET provider=excluded.provider,status=excluded.status,
      checked_at=excluded.checked_at,last_success_at=excluded.last_success_at,last_failure_at=excluded.last_failure_at,
      failure_count=excluded.failure_count,retry_at=excluded.retry_at,last_error=excluded.last_error`),
    mediaSourcePrune: db.prepare("DELETE FROM media_source_health WHERE source_id NOT IN (SELECT source_id FROM media_source_health ORDER BY checked_at DESC LIMIT 500)"),
    prune: db.prepare("DELETE FROM cache_entries WHERE expires_at IS NOT NULL AND expires_at <= ?"),
  };

  const store = {
    engine: "sqlite-wal",
    databasePath,
    async cacheGet(namespace, key) {
      const row = statements.cacheGet.get(namespace, key);
      if (!row) return null;
      if (row.expires_at !== null && row.expires_at <= Date.now()) {
        statements.cacheDelete.run(namespace, key);
        return null;
      }
      statements.cacheTouch.run(Date.now(), namespace, key);
      return parseJson(row.value_json);
    },
    async cacheSet(namespace, key, value, { ttlMs = 0 } = {}) {
      const now = Date.now();
      const json = JSON.stringify(value);
      if (Buffer.byteLength(json) > 2 * 1024 * 1024) throw new Error("本地元数据缓存单条记录不能超过 2 MB。");
      statements.cacheSet.run(namespace, key, json, now, ttlMs > 0 ? now + ttlMs : null, now, Buffer.byteLength(json));
    },
    async saveSnapshot(source, payload) {
      const json = JSON.stringify(payload);
      statements.snapshotSet.run(source, payload.updatedAt || Date.now(), json, Array.isArray(payload.tracks) ? payload.tracks.length : 0);
    },
    async getSnapshot(source) {
      const row = statements.snapshotGet.get(source);
      return row ? parseJson(row.payload_json) : null;
    },
    async listSnapshots() {
      return statements.snapshotList.all().map((row) => ({ source: row.source, ...parseJson(row.payload_json, {}) }));
    },
    async saveTaskState(task) {
      statements.taskSet.run(task.taskId, task.provider || "unknown", task.status || "idle",
        task.lastStartedAt ?? null, task.lastSuccessAt ?? null, task.nextRunAt ?? null,
        task.failureCount || 0, task.lastError || null, task.itemCount || 0, task.durationMs ?? null);
    },
    async getTaskState(taskId) { return statements.taskGet.get(taskId) || null; },
    async listTaskStates() { return statements.taskList.all(); },
    async saveProviderHealth(item) {
      statements.providerSet.run(item.provider, item.status, item.checkedAt || Date.now(), item.lastSuccessAt ?? null,
        item.lastError || null, item.consecutiveFailures || 0);
    },
    async saveMediaSourceHealth(item) {
      statements.mediaSourceSet.run(item.sourceId, item.provider || "unknown", item.status || "unknown",
        item.checkedAt || Date.now(), item.lastSuccessAt ?? null, item.lastFailureAt ?? null,
        item.failureCount || 0, item.retryAt ?? null, item.lastError || null);
      statements.mediaSourcePrune.run();
    },
    async getMediaSourceHealth(sourceId) { return statements.mediaSourceGet.get(sourceId) || null; },
    async listMediaSourceHealth() { return statements.mediaSourceList.all(); },
    async getStats() {
      const counts = db.prepare("SELECT COUNT(*) AS entries, COALESCE(SUM(size_bytes),0) AS cache_bytes FROM cache_entries").get();
      const snapshots = db.prepare("SELECT COUNT(*) AS count FROM discovery_snapshots").get().count;
      const tasks = db.prepare("SELECT COUNT(*) AS count FROM task_state").get().count;
      let databaseBytes = 0, walBytes = 0;
      try { databaseBytes = (await stat(databasePath)).size; } catch {}
      try { walBytes = (await stat(`${databasePath}-wal`)).size; } catch {}
      return { engine: "sqlite-wal", databasePath, databaseBytes, walBytes, cacheEntries: counts.entries, cacheBytes: counts.cache_bytes, snapshots, tasks };
    },
    async pruneExpired() { return Number(statements.prune.run(Date.now()).changes || 0); },
    async close() {
      try { db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch {}
      db.close();
    },
  };

  // One-time, non-destructive migration of the V3.7.0 JSON discovery snapshot.
  const legacyPath = join(dataDir, "discovery-cache.json");
  const legacyExists = await stat(legacyPath).then(() => true).catch(() => false);
  if (legacyExists && !await store.getSnapshot("audius-trending")) {
    try {
      const legacy = JSON.parse(await readFile(legacyPath, "utf8"));
      if (legacy && Array.isArray(legacy.tracks)) await store.saveSnapshot("audius-trending", legacy);
    } catch { /* Keep the legacy file untouched; corrupted legacy data is not fatal. */ }
  }
  return store;
}
