import { setTimeout as delay } from "node:timers/promises";

export async function fetchJsonWithRetry(url, {
  signal,
  timeoutMs = 10_000,
  retries = 2,
  headers = { accept: "application/json" },
  fetchImpl = fetch,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", abortFromParent, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("请求超时")), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, headers });
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 15_000) : Math.min(1000 * (2 ** attempt), 8000);
        if (attempt < retries) { await delay(waitMs, undefined, { signal }); continue; }
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("网络请求失败");
      if (signal?.aborted) throw signal.reason || lastError;
      if (attempt < retries) await delay(Math.min(500 * (2 ** attempt), 4000), undefined, { signal });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromParent);
    }
  }
  throw lastError || new Error("网络请求失败");
}
