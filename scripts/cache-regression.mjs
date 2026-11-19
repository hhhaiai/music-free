import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalStore } from "../server/storage.mjs";

const dir = await mkdtemp(join(tmpdir(), "music-free-cache-"));
try {
  const store = await createLocalStore({ dataDir: dir });
  assert.ok(["sqlite-wal", "json-fallback"].includes(store.engine));
  await store.cacheSet("provider-response", "seed:mandopop", { items: [1, 2, 3] }, { ttlMs: 60_000 });
  assert.deepEqual(await store.cacheGet("provider-response", "seed:mandopop"), { items: [1, 2, 3] });
  await store.cacheSet("temporary", "expires", { ok: true }, { ttlMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await store.cacheGet("temporary", "expires"), null);
  await store.saveSnapshot("test-provider", { source: "test-provider", updatedAt: Date.now(), tracks: [{ id: "t1" }] });
  await store.saveTaskState({ taskId: "test-task", provider: "test-provider", status: "ok", lastSuccessAt: Date.now(), nextRunAt: Date.now() + 1000, itemCount: 1 });
  await store.saveMediaSourceHealth({ sourceId: "audius:track-1", provider: "audius", status: "degraded", checkedAt: Date.now(), lastFailureAt: Date.now(), failureCount: 2, retryAt: Date.now() + 30000, lastError: "network error" });
  const stats = await store.getStats();
  assert.ok(stats.databaseBytes >= 0);
  assert.equal(stats.snapshots, 1);
  assert.equal(stats.tasks, 1);
  await store.close();

  const reopened = await createLocalStore({ dataDir: dir });
  assert.deepEqual(await reopened.cacheGet("provider-response", "seed:mandopop"), { items: [1, 2, 3] }, "disk cache must survive process/store restart");
  assert.equal((await reopened.getSnapshot("test-provider")).tracks[0].id, "t1");
  assert.equal((await reopened.getTaskState("test-task")).status, "ok");
  const persistedHealth = await reopened.getMediaSourceHealth("audius:track-1");
  assert.equal(persistedHealth.failure_count ?? persistedHealth.failureCount, 2);
  assert.equal((await reopened.listMediaSourceHealth()).length, 1);
  await reopened.close();

  // Legacy V3.7.0 JSON discovery cache is migrated without deleting the source file.
  const legacyDir = await mkdtemp(join(tmpdir(), "music-free-legacy-"));
  try {
    await writeFile(join(legacyDir, "discovery-cache.json"), JSON.stringify({ source: "audius-trending-week", updatedAt: 123, tracks: [{ id: "legacy-track" }] }));
    const migrated = await createLocalStore({ dataDir: legacyDir });
    assert.equal((await migrated.getSnapshot("audius-trending")).tracks[0].id, "legacy-track");
    await migrated.close();
    const legacy = JSON.parse(await readFile(join(legacyDir, "discovery-cache.json"), "utf8"));
    assert.equal(legacy.tracks[0].id, "legacy-track", "migration must not delete the legacy file");
  } finally { await rm(legacyDir, { recursive: true, force: true }); }

  console.log("Music Free V4.1.1 disk-cache persistence regression passed.");
} finally { await rm(dir, { recursive: true, force: true }); }
