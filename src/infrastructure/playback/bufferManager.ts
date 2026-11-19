import type { PlaybackQuality } from "../../domain/music/types";

export type BufferReadiness = { bufferedSeconds: number; degraded: boolean; networkHint: string };
type BufferPlan = { targetSeconds: number; minimumSeconds: number; timeoutMs: number };
const plans: Record<PlaybackQuality, BufferPlan> = {
  stable: { targetSeconds: 8, minimumSeconds: 2.2, timeoutMs: 26000 },
  balanced: { targetSeconds: 3.5, minimumSeconds: 1.2, timeoutMs: 16000 },
  fast: { targetSeconds: 0.8, minimumSeconds: 0.35, timeoutMs: 9000 },
};

type NetworkInformation = EventTarget & { effectiveType?: string; downlink?: number; saveData?: boolean };
function connectionInfo(): NetworkInformation | undefined {
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}
export function getNetworkHint(): string {
  const connection = connectionInfo();
  if (!connection) return navigator.onLine ? "浏览器未提供网络质量信息" : "离线";
  const parts = [connection.effectiveType?.toUpperCase(), Number.isFinite(connection.downlink) ? `${connection.downlink} Mbps` : "", connection.saveData ? "省流量模式" : ""].filter(Boolean);
  return parts.join(" · ") || (navigator.onLine ? "网络信息不可用" : "离线");
}
export function getBufferedAhead(audio: HTMLMediaElement): number {
  const time = audio.currentTime;
  for (let i = 0; i < audio.buffered.length; i += 1) {
    const start = audio.buffered.start(i); const end = audio.buffered.end(i);
    if (time >= start - 0.25 && time <= end + 0.25) return Math.max(0, end - time);
  }
  return 0;
}
function adjustedPlan(quality: PlaybackQuality): BufferPlan {
  const plan = plans[quality]; const connection = connectionInfo();
  if (!connection) return plan;
  if (connection.saveData || connection.effectiveType === "2g" || connection.effectiveType === "slow-2g") return { targetSeconds: Math.max(plan.targetSeconds, 10), minimumSeconds: Math.max(plan.minimumSeconds, 2.5), timeoutMs: Math.max(plan.timeoutMs, 30000) };
  if (connection.effectiveType === "3g") return { targetSeconds: Math.max(plan.targetSeconds, 6), minimumSeconds: Math.max(plan.minimumSeconds, 1.8), timeoutMs: Math.max(plan.timeoutMs, 22000) };
  return plan;
}
export function waitUntilPlayable(audio: HTMLAudioElement, quality: PlaybackQuality): Promise<BufferReadiness> {
  const plan = adjustedPlan(quality); const hint = getNetworkHint(); const ahead = getBufferedAhead(audio);
  if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && ahead >= Math.min(plan.targetSeconds, 1.5)) return Promise.resolve({ bufferedSeconds: ahead, degraded: false, networkHint: hint });
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      ["loadedmetadata", "loadeddata", "canplay", "progress", "timeupdate"].forEach((name) => audio.removeEventListener(name, check));
      audio.removeEventListener("error", fail);
    };
    const finish = (result: BufferReadiness) => { if (settled) return; settled = true; cleanup(); resolve(result); };
    const fail = () => { if (settled) return; settled = true; cleanup(); reject(new Error("音源无法加载。可能是地址失效、格式不支持、跨域限制或来源禁止直接播放。")); };
    const check = () => {
      if (audio.error) { fail(); return; }
      const buffered = getBufferedAhead(audio);
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && buffered >= plan.minimumSeconds) finish({ bufferedSeconds: buffered, degraded: buffered < plan.targetSeconds, networkHint: hint });
      else if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) finish({ bufferedSeconds: buffered, degraded: buffered < plan.targetSeconds, networkHint: hint });
      // Stream-only hosts sometimes omit reliable TimeRanges while audio is
      // already playing. Do not hold the UI at "buffering" for 26 seconds.
      else if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && !audio.paused && !audio.seeking) finish({ bufferedSeconds: buffered, degraded: true, networkHint: hint });
    };
    timer = window.setTimeout(() => {
      const buffered = getBufferedAhead(audio);
      if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) finish({ bufferedSeconds: buffered, degraded: true, networkHint: hint });
      else { settled = true; cleanup(); reject(new Error("等待音频缓冲超时。可以重试，或换一个音源。")); }
    }, plan.timeoutMs);
    ["loadedmetadata", "loadeddata", "canplay", "progress", "timeupdate"].forEach((name) => audio.addEventListener(name, check));
    audio.addEventListener("error", fail, { once: true });
    check();
  });
}
// Metadata-only warmup. Do not fetch or persist the complete next audio track.
export function preloadMetadata(url?: string) {
  if (!url) return null;
  const audio = new Audio(); audio.preload = "metadata"; audio.src = url; audio.load(); return audio;
}
