import type { TrackRecord, TrackVersionKind } from "./types.ts";
import { classifyTrackVersion } from "./metadata.ts";
import { matchesCatalogIdentity } from "./identity.ts";
import type { CatalogTrackRecord } from "./types.ts";

export type SourceHealthSnapshot = { failures?: number; failureCount?: number; retryAt?: number | null; lastSuccessAt?: number | null; status?: string };
export type SourceScoreBreakdown = { identity: number; transport: number; duration: number; version: number; license: number; health: number; metadata: number; total: number; reasons: string[] };
export type RankedSource = { track: TrackRecord; score: number; breakdown: SourceScoreBreakdown };

const VERSION_SCORE: Record<TrackVersionKind, number> = { studio: 10, unknown: 3, live: -8, cover: -12, remix: -10, karaoke: -24, instrumental: -24 };

export function scoreSourceCandidate(target: CatalogTrackRecord, candidate: TrackRecord, health?: SourceHealthSnapshot, now = Date.now()): RankedSource | null {
  if (candidate.kind !== "remote-audio" || !candidate.remoteUrl?.startsWith("https://") || !matchesCatalogIdentity(target, candidate)) return null;
  const reasons: string[] = [];
  const identity = 45;
  reasons.push("歌名、歌手署名与时长规则匹配（未完成音频指纹验证）");
  const transport = 12;
  reasons.push("HTTPS 独立音频地址");
  let duration = 0;
  if (target.duration && candidate.duration) {
    const delta = Math.abs(target.duration - candidate.duration);
    duration = delta <= 5 ? 22 : delta <= 15 ? 16 : delta <= 45 ? 8 : delta <= 90 ? 0 : -20;
    reasons.push(delta <= 15 ? "时长高度接近" : delta <= 45 ? "时长基本接近" : "时长差异较大");
  } else if (candidate.duration && candidate.duration >= 180) {
    duration = 6; reasons.push("已知时长达到完整曲目区间");
  }
  const versionKind = classifyTrackVersion(candidate).kind;
  const version = VERSION_SCORE[versionKind];
  reasons.push(versionKind === "unknown" ? "版本类型待确认" : `版本类型：${versionKind}`);
  let license = 0;
  if (candidate.licenseUrl) { license = 8; reasons.push("提供许可条款链接"); }
  else if (candidate.license) { license = 3; reasons.push("提供许可说明"); }
  const failures = health?.failures ?? health?.failureCount ?? 0;
  const cooling = Boolean(health?.retryAt && health.retryAt > now);
  const healthScore = cooling ? -45 : Math.max(-18, Math.min(8, (health?.lastSuccessAt ? 8 : 0) - failures * 4));
  if (cooling) reasons.push("音源处于冷却期");
  else if (health?.lastSuccessAt) reasons.push("曾经播放成功");
  else if (failures) reasons.push(`历史失败 ${failures} 次`);
  let metadata = 0;
  if (candidate.artist) metadata += 2;
  if (candidate.album) metadata += 2;
  if (candidate.coverUrl) metadata += 1;
  if (candidate.releaseDate) metadata += 1;
  if (candidate.sourceUrl) metadata += 1;
  const total = identity + transport + duration + version + license + healthScore + metadata;
  return { track: candidate, score: total, breakdown: { identity, transport, duration, version, license, health: healthScore, metadata, total, reasons } };
}

export function rankSourceCandidates(target: CatalogTrackRecord, candidates: TrackRecord[], healthById: Map<string, SourceHealthSnapshot> = new Map()): RankedSource[] {
  return candidates
    .map((candidate) => scoreSourceCandidate(target, candidate, healthById.get(candidate.id)))
    .filter((item): item is RankedSource => Boolean(item))
    .sort((a, b) => b.score - a.score || (a.track.duration || 0) - (b.track.duration || 0));
}
