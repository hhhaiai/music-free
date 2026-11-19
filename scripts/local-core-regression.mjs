import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = await mkdtemp(join(tmpdir(), "music-free-core-"));
const port = 4187;
const child = spawn(process.execPath, [join(root, "server/index.mjs")], {
  cwd: root,
  env: { ...process.env, YOUTUBE_API_KEY: "", MUSIC_FREE_PORT: String(port), MUSIC_FREE_DATA_DIR: dataDir, MUSIC_FREE_AUTODISCOVERY: "0" },
  stdio: "ignore",
});
try {
  let response;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { response = await fetch(`http://127.0.0.1:${port}/api/local/health`); break; }
    catch { await delay(100); }
  }
  assert.ok(response?.ok, "local core health endpoint should start on loopback");
  const health = await response.json();
  assert.equal(health.service, "music-free-local-core");
  assert.equal(health.version, "4.1.1");
  assert.ok(["sqlite-wal", "json-fallback"].includes(health.storage.engine));
  assert.ok(health.storage.databasePath.includes(dataDir));
  const discoveryResponse = await fetch(`http://127.0.0.1:${port}/api/local/discovery`);
  assert.equal(discoveryResponse.status, 200);
  const discovery = await discoveryResponse.json();
  assert.deepEqual(discovery.tracks, []);
  const statsResponse = await fetch(`http://127.0.0.1:${port}/api/local/cache/stats`);
  assert.equal(statsResponse.status, 200);
  const stats = await statsResponse.json();
  assert.equal(stats.engine, health.storage.engine);
  const videoProvidersResponse = await fetch(`http://127.0.0.1:${port}/api/local/video/providers`);
  assert.equal(videoProvidersResponse.status, 200);
  const videoProviders = await videoProvidersResponse.json();
  assert.equal(videoProviders.youtube.searchMode, "official-search-page", "YouTube search must work without an API key through the official site fallback");
  assert.equal(videoProviders.bilibili.playback, "official-player-iframe");
  const missingKeySearch = await fetch(`http://127.0.0.1:${port}/api/local/video/youtube/search?q=test`);
  assert.equal(missingKeySearch.status, 503, "API search must fail clearly when optional YouTube key is absent");
  const bilibiliResolve = await fetch(`http://127.0.0.1:${port}/api/local/video/bilibili/resolve?url=${encodeURIComponent("https://www.bilibili.com/video/BV1xx411c7mD/?p=1")}`);
  assert.equal(bilibiliResolve.status, 200);
  const bilibiliItem = (await bilibiliResolve.json()).item;
  assert.equal(bilibiliItem.videoId, "BV1xx411c7mD");
  const invalidBilibiliResolve = await fetch(`http://127.0.0.1:${port}/api/local/video/bilibili/resolve?url=${encodeURIComponent("https://evil.example/video/BV1xx411c7mD")}`);
  assert.equal(invalidBilibiliResolve.status, 400);
  const mediaCapabilitiesResponse = await fetch(`http://127.0.0.1:${port}/api/local/media/capabilities`);
  assert.equal(mediaCapabilitiesResponse.status, 200);
  const mediaCapabilities = await mediaCapabilitiesResponse.json();
  assert.equal(mediaCapabilities.processingMode, "browser-wasm");
  assert.equal(mediaCapabilities.remoteMediaUpload, false);
  assert.equal(mediaCapabilities.persistentRemoteMediaCache, false);
  const sourceHealthResponse = await fetch(`http://127.0.0.1:${port}/api/local/media/source-health`);
  assert.equal(sourceHealthResponse.status, 200);
  assert.deepEqual((await sourceHealthResponse.json()).items, []);
  const sourceHealthReport = await fetch(`http://127.0.0.1:${port}/api/local/media/source-health/report`, {
    method: "POST", headers: { Origin: "http://127.0.0.1:5173", "content-type": "application/json" },
    body: JSON.stringify({ sourceId: "audius:track-test", provider: "audius", success: false, error: "simulated playback failure" }),
  });
  assert.equal(sourceHealthReport.status, 200);
  const reportedHealth = (await sourceHealthReport.json()).item;
  assert.equal(reportedHealth.failureCount, 1);
  assert.ok(reportedHealth.retryAt > Date.now());
  const persistedSourceHealth = await fetch(`http://127.0.0.1:${port}/api/local/media/source-health`);
  assert.equal((await persistedSourceHealth.json()).items.length, 1);
  const forbiddenHealthReport = await fetch(`http://127.0.0.1:${port}/api/local/media/source-health/report`, {
    method: "POST", headers: { Origin: "https://example.com", "content-type": "application/json" },
    body: JSON.stringify({ sourceId: "audius:track-test", provider: "audius", success: true }),
  });
  assert.equal(forbiddenHealthReport.status, 403);
  const tasksResponse = await fetch(`http://127.0.0.1:${port}/api/local/tasks`);
  assert.equal(tasksResponse.status, 200);
  const tasks = await tasksResponse.json();
  assert.equal(tasks.tasks.length, 4, "four background discovery tasks should be registered even when auto-run is disabled");
  const forbidden = await fetch(`http://127.0.0.1:${port}/api/local/health`, { headers: { Origin: "https://example.com" } });
  assert.equal(forbidden.status, 403, "untrusted browser origins must be rejected");
  console.log("Music Free V4.1.1 local core regression passed.");
} finally {
  child.kill("SIGTERM");
  await delay(200);
  await rm(dataDir, { recursive: true, force: true });
}
