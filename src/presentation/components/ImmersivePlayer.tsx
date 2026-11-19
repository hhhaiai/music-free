import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { LyricLine, ThemeName, TrackRecord } from "../../domain/music/types";
import { timeLabel } from "../../infrastructure/media/videoUtils";

type Scene = "album" | "lyrics" | "visualizer";
type Props = {
  track: TrackRecord;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  lyrics: LyricLine[];
  activeLyricIndex: number;
  theme: ThemeName;
  onTogglePlayback: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onClose: () => void;
};

const VERSION_LABEL: Record<string, string> = {
  studio: "录音室版", live: "Live 现场", cover: "翻唱", remix: "Remix", karaoke: "伴奏", instrumental: "纯音乐", unknown: "版本待确认",
};

export function ImmersivePlayer(props: Props) {
  const { track, playing, buffering, position, duration, lyrics, activeLyricIndex, theme, onTogglePlayback, onPrevious, onNext, onSeek, onClose } = props;
  const [scene, setScene] = useState<Scene>("album");
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const lyricRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const progress = duration > 0 ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
  const bars = useMemo(() => Array.from({ length: 48 }, (_, index) => ({
    id: index,
    delay: `${(index % 13) * -0.11}s`,
    height: `${18 + ((index * 17 + 11) % 72)}%`,
  })), []);

  useEffect(() => {
    lyricRefs.current[activeLyricIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeLyricIndex, scene]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div className={`immersive-overlay theme-${theme}`} role="dialog" aria-modal="true" aria-label={`沉浸式播放：${track.title}`}>
    <div className="immersive-backdrop" style={track.coverUrl ? { backgroundImage: `url("${track.coverUrl.replace(/"/g, "")}")` } : undefined}/>
    <div className="immersive-vignette"/>
    <div className="immersive-shell">
      <header className="immersive-header">
        <div className="immersive-brand"><span>♫</span><div><b>MUSIC FREE</b><small>IMMERSIVE LISTENING</small></div></div>
        <div className="immersive-header-track"><b>{track.title}</b><small>{track.artist || "未知艺术家"} · {VERSION_LABEL[track.versionKind || "unknown"]}</small></div>
        <button type="button" className="immersive-close" onClick={onClose} aria-label="关闭沉浸模式">×</button>
      </header>

      <nav className="immersive-scenes" aria-label="播放场景">
        <button type="button" className={scene === "album" ? "selected" : ""} onClick={() => setScene("album")}>专辑空间</button>
        <button type="button" className={scene === "lyrics" ? "selected" : ""} onClick={() => setScene("lyrics")}>歌词舞台</button>
        <button type="button" className={scene === "visualizer" ? "selected" : ""} onClick={() => setScene("visualizer")}>动态视觉</button>
      </nav>

      <main className={`immersive-stage scene-${scene}`}>
        {scene === "album" && <div className="immersive-album-scene">
          <div className="immersive-orbit orbit-a"/><div className="immersive-orbit orbit-b"/>
          <div className="immersive-album-card" style={{ transform: `perspective(1100px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }} onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setTilt({ x: ((event.clientY - rect.top) / rect.height - 0.5) * -12, y: ((event.clientX - rect.left) / rect.width - 0.5) * 16 });
          }} onPointerLeave={() => setTilt({ x: 0, y: 0 })}>
            {track.coverUrl ? <img src={track.coverUrl} alt={`${track.title} 专辑封面`} /> : <div className="immersive-album-placeholder">♫</div>}
            <div className="immersive-album-reflection"/>
          </div>
          <div className="immersive-track-copy"><span className="eyebrow">NOW PLAYING</span><h1>{track.title}</h1><p>{track.artist || "未知艺术家"}</p><small>{track.album || "Music Free Collection"} · {VERSION_LABEL[track.versionKind || "unknown"]}</small></div>
          {lyrics.length > 0 && <div className="immersive-current-lyric">{lyrics[activeLyricIndex]?.text || "♪"}</div>}
        </div>}

        {scene === "lyrics" && <div className="immersive-lyrics-scene">
          <div className="immersive-lyrics-heading"><span className="eyebrow">SYNCHRONIZED LYRICS</span><h2>{track.title}</h2><p>{track.artist || "未知艺术家"}</p></div>
          {lyrics.length ? <div className="immersive-lyrics-list">{lyrics.map((line, index) => <button ref={(node) => { lyricRefs.current[index] = node; }} type="button" key={`${line.time}-${index}`} className={index === activeLyricIndex ? "active" : ""} onClick={() => onSeek(line.time)}>{line.text}</button>)}</div> : <div className="immersive-no-lyrics">暂时没有同步歌词。你可以在主界面导入 LRC 歌词。</div>}
        </div>}

        {scene === "visualizer" && <div className={`immersive-visualizer ${playing ? "is-playing" : ""}`} aria-label="动态音乐视觉效果">
          <div className="visualizer-orb orb-one"/><div className="visualizer-orb orb-two"/>
          <div className="immersive-spectrum">{bars.map((bar) => <i key={bar.id} style={{ "--bar-delay": bar.delay, "--bar-height": bar.height } as CSSProperties}/>)}</div>
          <div className="visualizer-caption"><span className="eyebrow">MOTION VISUAL</span><h2>{track.title}</h2><p>{track.artist || "未知艺术家"}</p></div>
        </div>}
      </main>

      <footer className="immersive-controls">
        <div className="immersive-progress"><span>{timeLabel(position)}</span><input type="range" min="0" max={Math.max(duration, 1)} value={Math.min(position, duration || 0)} onChange={(event) => onSeek(Number(event.target.value))} style={{ "--progress": `${progress}%` } as CSSProperties}/><span>{timeLabel(duration)}</span></div>
        <div className="immersive-control-row"><button type="button" onClick={onPrevious} aria-label="上一首">|◀</button><button type="button" className="immersive-play" onClick={onTogglePlayback} aria-label={playing ? "暂停" : "播放"}>{buffering ? "…" : playing ? "Ⅱ" : "▶"}</button><button type="button" onClick={onNext} aria-label="下一首">▶|</button></div>
        <small>沉浸式视觉效果 · 本地歌词同步 · {VERSION_LABEL[track.versionKind || "unknown"]}</small>
      </footer>
    </div>
  </div>;
}
