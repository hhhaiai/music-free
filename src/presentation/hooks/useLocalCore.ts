import { useCallback, useEffect, useState } from "react";
import type { TrackRecord } from "../../domain/music/types";

type StorageStats = {
  engine: "sqlite-wal" | "json-fallback";
  databasePath: string;
  databaseBytes: number;
  walBytes: number;
  cacheEntries: number;
  cacheBytes: number;
  snapshots: number;
  tasks: number;
};
type TaskState = {
  task_id?: string;
  taskId?: string;
  provider: string;
  status: string;
  last_success_at?: number | null;
  next_run_at?: number | null;
  last_error?: string | null;
  item_count?: number;
};
type LocalCoreHealth = {
  service: string;
  version: string;
  online: boolean;
  uptimeSeconds: number;
  discovery: { status: "idle" | "running" | "degraded" | "error"; lastRunAt: number | null; nextRunAt: number | null; itemCount: number; lastError: string | null; intervalHours: number };
  storage: StorageStats;
  tasks: TaskState[];
};
type LocalDiscovery = { source: string; updatedAt: number | null; tracks: TrackRecord[]; sources?: Array<{ source: string; provider: string; updatedAt: number; itemCount: number; warning: string | null }> };
type MediaCapabilities = {
  processingMode: string;
  browserWasm: { required: boolean; description: string };
  native: { ffmpeg: { available: boolean; version: string | null }; ffprobe: { available: boolean; version: string | null } };
  remoteMediaUpload: boolean;
  persistentRemoteMediaCache: boolean;
  maxBrowserFileBytes: number;
};
type SourceHealthItem = {
  source_id?: string;
  sourceId?: string;
  provider: string;
  status: string;
  checked_at?: number;
  checkedAt?: number;
  last_success_at?: number | null;
  lastSuccessAt?: number | null;
  failure_count?: number;
  failureCount?: number;
  retry_at?: number | null;
  retryAt?: number | null;
  last_error?: string | null;
  lastError?: string | null;
};

export function useLocalCore() {
  const [health, setHealth] = useState<LocalCoreHealth | null>(null);
  const [discovery, setDiscovery] = useState<LocalDiscovery | null>(null);
  const [mediaCapabilities, setMediaCapabilities] = useState<MediaCapabilities | null>(null);
  const [sourceHealth, setSourceHealth] = useState<SourceHealthItem[]>([]);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const refreshNow = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/local/refresh", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法启动后台发现任务。");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "本地服务不可用。");
    } finally { setRefreshing(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [healthResponse, discoveryResponse, mediaResponse, sourceHealthResponse] = await Promise.all([
          fetch("/api/local/health", { cache: "no-store" }),
          fetch("/api/local/discovery", { cache: "no-store" }),
          fetch("/api/local/media/capabilities", { cache: "no-store" }),
          fetch("/api/local/media/source-health", { cache: "no-store" }),
        ]);
        if (!healthResponse.ok || !discoveryResponse.ok) throw new Error("本地后台服务暂时不可用。");
        const [nextHealth, nextDiscovery, nextMedia, nextSourceHealth] = await Promise.all([
          healthResponse.json(), discoveryResponse.json(),
          mediaResponse.ok ? mediaResponse.json() : Promise.resolve(null),
          sourceHealthResponse.ok ? sourceHealthResponse.json() : Promise.resolve({ items: [] }),
        ]) as [LocalCoreHealth, LocalDiscovery, MediaCapabilities | null, { items: SourceHealthItem[] }];
        if (!cancelled) {
          setHealth(nextHealth); setDiscovery(nextDiscovery);
          setMediaCapabilities(nextMedia); setSourceHealth(nextSourceHealth.items || []);
          setError("");
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "本地后台服务暂时不可用。");
      } finally { inFlight = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  return { online: Boolean(health?.online), health, discovery, mediaCapabilities, sourceHealth, error, refreshing, refreshNow };
}
