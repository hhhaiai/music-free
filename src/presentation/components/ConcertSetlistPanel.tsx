import { useMemo, useState } from "react";


import { parseConcertChapters, type ConcertChapter } from "../../domain/music/concertChapters";
export { parseConcertChapters } from "../../domain/music/concertChapters";

function timestamp(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function ConcertSetlistPanel({ initialChapters = [], onPlayChapter }: { initialChapters?: ConcertChapter[]; onPlayChapter: (startSeconds: number) => void }) {
  const [description, setDescription] = useState("");
  const parsed = useMemo(() => initialChapters.length ? initialChapters : parseConcertChapters(description), [initialChapters, description]);
  return <section className="concert-setlist">
    <div className="concert-setlist-heading"><div><b>演唱会曲目 / 时间戳</b><small>可粘贴官方视频简介中的章节列表，点击曲目从对应时间开始播放。</small></div><span>{parsed.length} 个章节</span></div>
    {!initialChapters.length && <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={'粘贴视频简介章节，例如：\n00:00 开场\n03:24 第一首歌曲\n07:18 第二首歌曲'} rows={4}/>} 
    {parsed.length ? <div className="concert-chapter-list">{parsed.map((chapter) => <button key={`${chapter.startSeconds}-${chapter.title}`} type="button" onClick={() => onPlayChapter(chapter.startSeconds)}><span>{timestamp(chapter.startSeconds)}</span><b>{chapter.title}</b><i>▶</i></button>)}</div> : <p className="concert-empty">暂未识别到章节。支持 MM:SS 或 HH:MM:SS 格式。</p>}
    <small className="concert-disclaimer">章节由用户粘贴的公开描述解析；不会抓取平台隐藏信息，也不会下载或提取视频媒体。</small>
  </section>;
}
