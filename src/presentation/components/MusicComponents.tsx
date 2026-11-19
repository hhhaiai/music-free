import type { ReactNode } from "react";
import type { TrackRecord } from "../../domain/music/types";
import { bytesLabel, timeLabel } from "../../infrastructure/media/videoUtils";
import { REGION_LABELS, VERSION_LABELS } from "../../domain/music/metadata";

export function providerLabel(track: TrackRecord) {
  if (track.kind === "local-audio") return "本地音频";
  if (track.kind === "extracted-video") return "本地提取";
  if (track.provider === "audius") return "Audius";
  if (track.provider === "openverse") return "Openverse";
  if (track.provider === "internet-archive") return "Internet Archive";
  return "在线音频";
}

function trackMeta(track: TrackRecord) {
  const parts = [track.artist || track.fileName || "未知创作者", providerLabel(track)];
  if (track.duration && Number.isFinite(track.duration)) parts.push(timeLabel(track.duration));
  if (track.vocalType === "vocal") parts.push("人声");
  if (track.vocalType === "instrumental") parts.push("纯音乐");
  if (track.region && track.region !== "UNKNOWN") parts.push(REGION_LABELS[track.region]);
  if (track.language && track.language !== "unknown" && track.language !== "instrumental") parts.push(track.language.toUpperCase());
  if (track.versionKind && track.versionKind !== "unknown") parts.push(VERSION_LABELS[track.versionKind]);
  return parts.join(" · ");
}

export function NavButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: string; label: string; count?: number }) {
  return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}><span>{icon}</span>{label}{count !== undefined && <small>{count}</small>}</button>;
}
export function PanelHeading({ eyebrow, title, right, icon }: { eyebrow: string; title: string; right?: ReactNode; icon?: string }) {
  return <div className="panel-heading"><div><small>{eyebrow}</small><h2>{title}</h2></div>{right || (icon ? <span className="panel-icon">{icon}</span> : null)}</div>;
}
export function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="search-box"><span>⌕</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder="筛选音乐库"/></label>;
}
export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><span>♫</span><b>{title}</b><p>{text}</p>{action}</div>;
}
export function LoadingState({ label }: { label: string }) {
  return <div className="loading-state"><span className="spinner"/><b>{label}</b><small>正在连接公开音乐来源，不会上传你的本地文件。</small></div>;
}
export function TrackGrid({ tracks, onPlay, current, playing }: { tracks: TrackRecord[]; onPlay: (track: TrackRecord) => void; current: TrackRecord | null; playing: boolean }) {
  return <div className="track-grid">{tracks.map((track) => <button className={`track-card ${current?.id === track.id ? "selected" : ""}`} key={track.id} onClick={() => onPlay(track)}><div className="card-cover">{track.coverUrl ? <img src={track.coverUrl} alt="" loading="lazy"/> : <span>♫</span>}<i>{current?.id === track.id && playing ? "Ⅱ" : "▶"}</i></div><b>{track.title}</b><small>{track.artist || "未知创作者"}</small><span className="card-source">{providerLabel(track)} · {track.duration ? timeLabel(track.duration) : "时长未知"} · {track.region && track.region !== "UNKNOWN" ? REGION_LABELS[track.region] : "地区待识别"} · {track.versionKind ? VERSION_LABELS[track.versionKind] : "版本待确认"}</span></button>)}</div>;
}
export function TrackRows({ tracks, current, playing, onPlay, favorites, onFavorite, onRemove, onAddToPlaylist }: {
  tracks: TrackRecord[]; current: TrackRecord | null; playing: boolean;
  onPlay: (track: TrackRecord, list: TrackRecord[]) => void;
  favorites?: string[]; onFavorite?: (track: TrackRecord) => void; onRemove?: (track: TrackRecord) => void; onAddToPlaylist?: (track: TrackRecord) => void;
}) {
  return <div className="track-list">{tracks.map((track, index) => {
    const active = current?.id === track.id;
    return <div className={`track-row ${active ? "active" : ""}`} key={`${track.id}-${index}`}>
      <button className="track-art" onClick={() => onPlay(track, tracks)}>{track.coverUrl ? <img src={track.coverUrl} alt="" loading="lazy"/> : <span>{String(index + 1).padStart(2, "0")}</span>}<i>{active && playing ? "Ⅱ" : "▶"}</i></button>
      <button className="track-name" onClick={() => onPlay(track, tracks)}><b>{track.title}</b><small>{trackMeta(track)}{track.size ? ` · ${bytesLabel(track.size)}` : ""}</small></button>
      <span className="kind-tag">{track.license || providerLabel(track)}</span>
      <span className="track-version-meta">{track.region && track.region !== "UNKNOWN" ? REGION_LABELS[track.region] : "地区待识别"} · {track.versionKind ? VERSION_LABELS[track.versionKind] : "版本待确认"}</span>
      {track.sourceUrl && <a className="source-link" href={track.sourceUrl} target="_blank" rel="noreferrer" title="查看原始来源">来源 ↗</a>}
      {onAddToPlaylist && <button className="add-playlist" title="加入当前歌单" onClick={() => onAddToPlaylist(track)}>＋</button>}
      {onFavorite && <button className={`heart ${favorites?.includes(track.id) ? "liked" : ""}`} onClick={() => onFavorite(track)}>{favorites?.includes(track.id) ? "♥" : "♡"}</button>}
      {onRemove && <button className="remove" onClick={() => onRemove(track)}>×</button>}
    </div>;
  })}</div>;
}
