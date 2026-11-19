import assert from "node:assert/strict";
import { createDiscoveryScheduler } from "../server/scheduler.mjs";

const memory = { tasks: new Map(), snapshots: new Map(), providers: new Map(),
  async getTaskState(id) { return this.tasks.get(id) || null; },
  async saveTaskState(row) { this.tasks.set(row.taskId, { ...row, last_started_at: row.lastStartedAt, last_success_at: row.lastSuccessAt, next_run_at: row.nextRunAt, failure_count: row.failureCount, last_error: row.lastError, item_count: row.itemCount, duration_ms: row.durationMs }); },
  async saveSnapshot(id, payload) { this.snapshots.set(id, payload); },
  async saveProviderHealth(row) { this.providers.set(row.provider, row); },
};
let clock = 1_000_000;
let calls = 0;
const scheduler = createDiscoveryScheduler({
  store: memory, now: () => clock, random: () => 0,
  tasks: [{ id: "fake-a", provider: "fake", intervalMs: 10_000, run: async () => { calls += 1; return { tracks: [{ id: "x" }] }; } }],
});
await scheduler.initialize();
const first = await scheduler.runDue();
assert.equal(first.length, 1);
assert.equal(calls, 1);
assert.equal(memory.snapshots.get("fake-a").tracks.length, 1);
assert.equal((await memory.getTaskState("fake-a")).status, "ok");
assert.equal((await scheduler.runDue()).length, 0, "not-due tasks must not rerun");
clock += 10_001;
await scheduler.runDue();
assert.equal(calls, 2);

let release;
const overlap = createDiscoveryScheduler({
  store: memory, now: () => clock,
  tasks: [{ id: "slow", provider: "slow-provider", intervalMs: 10_000, run: () => new Promise((resolve) => { release = resolve; }) }],
});
const firstRun = overlap.runDue();
await new Promise((resolve) => setTimeout(resolve, 0));
const secondRun = await overlap.runDue({ force: true });
assert.equal(secondRun.length, 0, "overlapping tasks must be skipped");
release({ tracks: [] });
await firstRun;

let failCount = 0;
const failing = createDiscoveryScheduler({
  store: memory, now: () => clock,
  tasks: [{ id: "flaky", provider: "flaky-provider", intervalMs: 1000, run: async () => { failCount += 1; throw new Error("simulated offline"); } }],
});
await failing.runDue();
assert.equal(failCount, 1);
const failureState = await memory.getTaskState("flaky");
assert.equal(failureState.status, "error");
assert.ok(failureState.nextRunAt > clock, "failed tasks must back off instead of hammering providers");

console.log("Music Free V4.1.1 scheduler regression passed.");
