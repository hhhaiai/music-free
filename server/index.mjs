import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createLocalStore } from "./storage.mjs";
import { createDiscoveryScheduler } from "./scheduler.mjs";
import { createDiscoveryTasks } from "./tasks/discovery.mjs";
import { loadLocalEnvironment } from "./env.mjs";
import { resolveYouTubeVideoUrl, searchYouTubeVideos } from "./providers/youtube.mjs";
import { resolveBilibiliVideoUrl } from "./providers/bilibili.mjs";
import { getMediaCapabilities } from "./media/capabilities.mjs";

await loadLocalEnvironment();

const HOST = "127.0.0.1";
const PORT = Number(process.env.MUSIC_FREE_PORT || 4179);
const DATA_DIR = process.env.MUSIC_FREE_DATA_DIR || join(homedir(), ".music-free");
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:5173", "http://localhost:5173",
  "http://127.0.0.1:4173", "http://localhost:4173",
]);
const store = await createLocalStore({ dataDir: DATA_DIR });
const YOUTUBE_API_KEY = String(process.env.YOUTUBE_API_KEY || "").trim();
const scheduler = createDiscoveryScheduler({ store, tasks: createDiscoveryTasks({ youtubeApiKey: YOUTUBE_API_KEY }), tickMs: 5_000, maxConcurrent: 2 });
const startedAt = Date.now();
let lastManualRefreshAt = 0;

function send(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(JSON.stringify(payload));
}

async function mergedDiscovery() {
  const snapshots = await store.listSnapshots();
  const merged = new Map();
  for (const snapshot of snapshots) {
    for (const track of snapshot.tracks || []) {
      const existing = merged.get(track.id);
      if (!existing || (track.playCount || 0) > (existing.playCount || 0)) merged.set(track.id, track);
    }
  }
  const sources = snapshots.map((snapshot) => ({
    source: snapshot.source, provider: snapshot.provider, updatedAt: snapshot.updatedAt,
    itemCount: snapshot.tracks?.length || 0, warning: snapshot.warnings?.join("；") || null,
  }));
  return {
    source: "local-multi-provider",
    updatedAt: snapshots.reduce((latest, item) => Math.max(latest, item.updatedAt || 0), 0) || null,
    tracks: [...merged.values()].sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).slice(0, 160),
    sources,
  };
}

const server = createServer(async (req, res) => {
  const host = String(req.headers.host || "").toLowerCase();
  if (host !== `${HOST}:${PORT}` && host !== `localhost:${PORT}`) return send(res, 421, { error: "仅允许本机访问。" });
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, { error: "不允许的本地页面来源。" });

  const url = new URL(req.url || "/", `http://${host}`);
  if (req.method === "GET" && url.pathname === "/api/local/health") {
    const [storage, taskStates] = await Promise.all([store.getStats(), store.listTaskStates()]);
    return send(res, 200, {
      service: "music-free-local-core", version: "4.1.1", online: true,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      discovery: {
        status: scheduler.state.status,
        lastRunAt: taskStates.reduce((v, x) => Math.max(v, x.last_success_at ?? x.lastSuccessAt ?? 0), 0) || null,
        nextRunAt: taskStates.reduce((v, x) => Math.min(v, x.next_run_at ?? x.nextRunAt ?? Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER) === Number.MAX_SAFE_INTEGER
          ? null : taskStates.reduce((v, x) => Math.min(v, x.next_run_at ?? x.nextRunAt ?? Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER),
        itemCount: taskStates.reduce((v, x) => v + (x.item_count ?? x.itemCount ?? 0), 0),
        lastError: taskStates.filter((x) => x.last_error || x.lastError).map((x) => `${x.task_id || x.taskId}: ${x.last_error || x.lastError}`).slice(0, 3).join("；") || null,
        intervalHours: 6,
      },
      storage,
      tasks: scheduler.state.tasks,
    });
  }
  if (req.method === "GET" && url.pathname === "/api/local/discovery") {
    return send(res, 200, await mergedDiscovery());
  }
  if (req.method === "GET" && url.pathname === "/api/local/tasks") {
    await scheduler.initialize();
    return send(res, 200, { tasks: scheduler.state.tasks });
  }
  if (req.method === "GET" && url.pathname === "/api/local/cache/stats") {
    return send(res, 200, await store.getStats());
  }
  if (req.method === "GET" && url.pathname === "/api/local/media/capabilities") {
    return send(res, 200, getMediaCapabilities());
  }
  if (req.method === "GET" && url.pathname === "/api/local/media/source-health") {
    return send(res, 200, { items: await store.listMediaSourceHealth() });
  }
  if (req.method === "POST" && url.pathname === "/api/local/media/source-health/report") {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return send(res, 403, { error: "媒体健康报告只接受本地 Music Free 页面请求。" });
    let body = "";
    for await (const chunk of req) {
      body += chunk.toString("utf8");
      if (Buffer.byteLength(body) > 8192) return send(res, 413, { error: "报告内容过大。" });
    }
    let report;
    try { report = JSON.parse(body || "{}"); } catch { return send(res, 400, { error: "无效的 JSON 报告。" }); }
    const sourceId = typeof report.sourceId === "string" ? report.sourceId.trim().slice(0, 256) : "";
    const provider = typeof report.provider === "string" ? report.provider.trim().slice(0, 40) : "unknown";
    if (!sourceId || !/^[a-z0-9:_-]+$/i.test(sourceId)) return send(res, 400, { error: "无效的音源标识。" });
    const previous = await store.getMediaSourceHealth(sourceId);
    const now = Date.now();
    const success = report.success === true;
    const failures = success ? 0 : (previous?.failure_count ?? previous?.failureCount ?? 0) + 1;
    const cooldown = success ? 0 : Math.min(10 * 60_000, 15_000 * (2 ** Math.min(failures - 1, 6)));
    const item = {
      sourceId, provider, status: success ? "ok" : "degraded", checkedAt: now,
      lastSuccessAt: success ? now : (previous?.last_success_at ?? previous?.lastSuccessAt ?? null),
      lastFailureAt: success ? (previous?.last_failure_at ?? previous?.lastFailureAt ?? null) : now,
      failureCount: failures, retryAt: success ? null : now + cooldown,
      lastError: success ? null : String(report.error || "播放失败").slice(0, 240),
    };
    await store.saveMediaSourceHealth(item);
    return send(res, 200, { accepted: true, item });
  }
  if (req.method === "GET" && url.pathname === "/api/local/video/providers") {
    return send(res, 200, {
      youtube: { enabled: true, searchMode: YOUTUBE_API_KEY ? "data-api" : "official-search-page", apiKeyConfigured: Boolean(YOUTUBE_API_KEY), trendingEnabled: Boolean(YOUTUBE_API_KEY), playback: "youtube-nocookie-iframe" },
      bilibili: { enabled: true, searchMode: "official-search-page", apiKeyConfigured: false, trendingEnabled: false, playback: "official-player-iframe" },
    });
  }
  if (req.method === "GET" && url.pathname === "/api/local/video/youtube/trending") {
    const snapshot = await store.getSnapshot("youtube-music-trending");
    return send(res, 200, { provider: "youtube", enabled: Boolean(YOUTUBE_API_KEY), items: snapshot?.tracks || [], updatedAt: snapshot?.updatedAt || null });
  }
  if (req.method === "GET" && url.pathname === "/api/local/video/youtube/search") {
    const query = String(url.searchParams.get("q") || "").trim();
    const region = String(url.searchParams.get("region") || "SG").toUpperCase();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 10), 1), 10);
    const order = String(url.searchParams.get("order") || "relevance");
    if (!query) return send(res, 400, { error: "missing_query", message: "请输入搜索关键词。" });
    if (query.length > 120) return send(res, 400, { error: "query_too_long", message: "搜索关键词不能超过 120 个字符。" });
    if (!YOUTUBE_API_KEY) return send(res, 503, { error: "api_key_missing", message: "尚未配置 YouTube Data API Key。你仍可打开 YouTube 官方搜索页并粘贴视频链接，无需 API Key。" });
    const cacheKey = `${region}:${limit}:${order}:${query.toLocaleLowerCase()}`;
    try {
      const cached = await store.cacheGet("video-search-youtube", cacheKey);
      if (cached) return send(res, 200, { provider: "youtube", items: cached.items || [], cached: true, updatedAt: cached.updatedAt });
      const items = await searchYouTubeVideos(query, { apiKey: YOUTUBE_API_KEY, region, limit, order });
      const payload = { items, updatedAt: Date.now() };
      await store.cacheSet("video-search-youtube", cacheKey, payload, { ttlMs: 15 * 60 * 1000 });
      return send(res, 200, { provider: "youtube", ...payload, cached: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "YouTube 搜索暂时不可用。";
      return send(res, 502, { error: "youtube_search_failed", message });
    }
  }
  if (req.method === "GET" && url.pathname === "/api/local/video/youtube/resolve") {
    const input = String(url.searchParams.get("url") || "").trim();
    if (!input || input.length > 2048) return send(res, 400, { error: "invalid_url", message: "请粘贴有效的 YouTube 视频链接。" });
    try {
      const item = await resolveYouTubeVideoUrl(input);
      return send(res, 200, { provider: "youtube", item });
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法读取 YouTube 视频资料。";
      const status = message.includes("有效的 YouTube") ? 400 : 502;
      return send(res, status, { error: "youtube_resolve_failed", message });
    }
  }
  if (req.method === "GET" && url.pathname === "/api/local/video/bilibili/resolve") {
    const input = String(url.searchParams.get("url") || "").trim();
    if (!input || input.length > 2048) return send(res, 400, { error: "invalid_url", message: "请粘贴有效的 Bilibili 视频链接。" });
    try {
      const item = resolveBilibiliVideoUrl(input);
      return send(res, 200, { provider: "bilibili", item });
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法识别 Bilibili 视频链接。";
      return send(res, 400, { error: "bilibili_resolve_failed", message });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/local/refresh") {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return send(res, 403, { error: "刷新任务只接受本地 Music Free 页面请求。" });
    if (Date.now() - lastManualRefreshAt < 60_000) return send(res, 429, { error: "刷新过于频繁，请稍后再试。" });
    lastManualRefreshAt = Date.now();
    void scheduler.refreshAll();
    return send(res, 202, { accepted: true, message: "已启动多来源本地元数据发现任务。" });
  }
  if (req.method === "POST" && url.pathname === "/api/local/cache/prune") {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return send(res, 403, { error: "缓存维护只接受本地 Music Free 页面请求。" });
    const deleted = await store.pruneExpired();
    return send(res, 200, { deleted, stats: await store.getStats() });
  }
  return send(res, 404, { error: "Not found" });
});

await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
server.listen(PORT, HOST, () => {
  console.log(`[Music Free Local Core] http://${HOST}:${PORT}`);
  console.log(`[Music Free Local Core] disk database: ${store.databasePath}`);
  console.log(`[Music Free Local Core] storage engine: ${store.engine}`);
  if (process.env.MUSIC_FREE_AUTODISCOVERY !== "0") scheduler.start({ runImmediately: true });
  else console.log("[Music Free Local Core] automatic discovery disabled by environment.");
});

function shutdown() {
  scheduler.stop();
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
