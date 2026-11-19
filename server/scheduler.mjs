const MINUTE = 60 * 1000;

export function createDiscoveryScheduler({
  store,
  tasks = [],
  tickMs = 30_000,
  maxConcurrent = 2,
  now = Date.now,
  random = Math.random,
}) {
  const running = new Set();
  const runtime = new Map();
  let timer = null;
  let initialized = false;
  const state = { status: "idle", runningTasks: [], lastTickAt: null, tasks: [] };

  async function initialize() {
    if (initialized) return;
    for (const task of tasks) {
      const saved = await store.getTaskState(task.id);
      const wasInterrupted = saved?.status === "running";
      const failureCount = (saved?.failure_count ?? saved?.failureCount ?? 0) + (wasInterrupted ? 1 : 0);
      const initialNextRunAt = saved?.next_run_at ?? saved?.nextRunAt ?? (now() + (task.initialDelayMs || 0));
      const current = {
        taskId: task.id, provider: task.provider || "unknown",
        status: wasInterrupted ? "error" : (saved?.status || "idle"),
        lastStartedAt: saved?.last_started_at ?? saved?.lastStartedAt ?? null,
        lastSuccessAt: saved?.last_success_at ?? saved?.lastSuccessAt ?? null,
        nextRunAt: wasInterrupted ? now() + Math.min(6 * 60 * 60 * 1000, 60_000 * (2 ** Math.min(failureCount - 1, 6))) : initialNextRunAt,
        failureCount,
        lastError: wasInterrupted ? "上次 Music Free 本地服务非正常退出，任务已安全重新排队。" : (saved?.last_error ?? saved?.lastError ?? null),
        itemCount: saved?.item_count ?? saved?.itemCount ?? 0,
        durationMs: saved?.duration_ms ?? saved?.durationMs ?? null,
      };
      runtime.set(task.id, current);
      if (!saved || wasInterrupted) await store.saveTaskState(current);
    }
    initialized = true;
    updateSummary();
  }

  function updateSummary() {
    state.runningTasks = [...running];
    state.tasks = [...runtime.values()].map((x) => ({ ...x }));
    state.status = running.size ? "running" : state.tasks.some((x) => x.status === "error" || x.status === "degraded") ? "degraded" : "idle";
  }

  async function execute(task, { force = false } = {}) {
    await initialize();
    if (running.has(task.id)) return { skipped: true, reason: "already-running" };
    const current = runtime.get(task.id);
    if (!force && current.nextRunAt && current.nextRunAt > now()) return { skipped: true, reason: "not-due" };

    running.add(task.id);
    const started = now();
    Object.assign(current, { status: "running", lastStartedAt: started, lastError: null });
    await store.saveTaskState(current);
    updateSummary();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`${task.id} 任务超时`)), task.timeoutMs || 45_000);
    try {
      const result = await task.run({ signal: controller.signal, store });
      const tracks = Array.isArray(result) ? result : Array.isArray(result?.tracks) ? result.tracks : [];
      const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
      const payload = { source: task.id, provider: task.provider || "unknown", updatedAt: now(), tracks, warnings };
      await store.saveSnapshot(task.id, payload);
      if (typeof store.cacheSet === "function") {
        await store.cacheSet("discovery-snapshot", task.id, payload, { ttlMs: Math.max(task.intervalMs * 3, 24 * HOUR) });
      }
      const durationMs = Math.max(0, now() - started);
      Object.assign(current, {
        status: warnings.length ? "degraded" : "ok",
        lastSuccessAt: now(), nextRunAt: now() + task.intervalMs + Math.floor(random() * Math.min(task.intervalMs * 0.05, 5 * MINUTE)),
        failureCount: 0, lastError: warnings.length ? warnings.slice(0, 3).join("；") : null,
        itemCount: tracks.length, durationMs,
      });
      await store.saveProviderHealth({
        provider: task.provider || "unknown", status: warnings.length ? "degraded" : "ok",
        checkedAt: now(), lastSuccessAt: current.lastSuccessAt, lastError: current.lastError, consecutiveFailures: 0,
      });
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : "后台发现任务失败";
      const failures = current.failureCount + 1;
      const backoffMs = Math.min(6 * HOUR, 60_000 * (2 ** Math.min(failures - 1, 6)));
      Object.assign(current, {
        status: "error", failureCount: failures, lastError: message,
        nextRunAt: now() + backoffMs, durationMs: Math.max(0, now() - started),
      });
      await store.saveProviderHealth({
        provider: task.provider || "unknown", status: "error", checkedAt: now(),
        lastSuccessAt: current.lastSuccessAt, lastError: message, consecutiveFailures: failures,
      });
      return { error: message, nextRunAt: current.nextRunAt };
    } finally {
      clearTimeout(timeout);
      running.delete(task.id);
      await store.saveTaskState(current);
      updateSummary();
    }
  }

  const HOUR = 60 * MINUTE;
  async function runDue({ force = false } = {}) {
    await initialize();
    state.lastTickAt = now();
    const due = tasks.filter((task) => {
      const current = runtime.get(task.id);
      if (running.has(task.id)) return false;
      if (force) return true;
      if (!current.nextRunAt) return true;
      return current.nextRunAt <= now();
    });
    const results = [];
    let cursor = 0;
    async function worker() {
      while (cursor < due.length) {
        const task = due[cursor++];
        results.push(await execute(task, { force }));
      }
    }
    await Promise.all(Array.from({ length: Math.min(maxConcurrent, due.length) }, () => worker()));
    updateSummary();
    return results;
  }

  function start({ runImmediately = true } = {}) {
    if (timer) return;
    void initialize().then(() => runImmediately ? runDue() : undefined);
    timer = setInterval(() => { void runDue(); }, tickMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function refreshAll() { return runDue({ force: true }); }

  return { state, start, stop, runDue, refreshAll, initialize };
}

const HOUR = 60 * MINUTE;
