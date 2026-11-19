import type { VerifiedRecording } from "../../domain/music/verifiedCatalog";

export type OfficialVideoSelection = {
  id: string;
  title: string;
  artist: string;
  publisher: string;
  videoId: string;
  evidenceUrl: string;
  videoKind: VerifiedRecording["videoKind"];
};

export function officialVideoSelection(record: VerifiedRecording): OfficialVideoSelection {
  return {
    id: record.id, title: record.title, artist: record.artist,
    publisher: record.videoPublisher, videoId: record.videoId,
    videoKind: record.videoKind, evidenceUrl: record.evidenceUrl,
  };
}

/** The YouTube player is never rehosted, scraped, downloaded or obscured. */
export function OfficialVideoStage({ selection, onClose }: { selection: OfficialVideoSelection; onClose: () => void }) {
  const embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(selection.videoId)}?autoplay=1&playsinline=1&rel=0`;
  return <section className="official-inline-stage" aria-label="本站官方视频播放区域">
    <div className="official-inline-heading">
      <div>
        <b>{selection.title} · {selection.artist}</b>
        <small>{selection.publisher} · {selection.videoKind === "official-mv" ? "官方 MV" : "官方歌词视频"}</small>
      </div>
      <button type="button" className="outline" onClick={onClose}>关闭视频</button>
    </div>
    <div className="official-inline-frame">
      <iframe key={selection.videoId} src={embedUrl} title={`${selection.title} — 官方视频`} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
    </div>
    <p className="official-inline-note">本页内使用 YouTube 官方嵌入播放器，不跳转二级页面。音频属于官方视频，不是独立音频提取。平台可能禁止嵌入或拦截自动播放；如出现播放按钮，请在视频中点一次开始。没有绕过版权或访问限制。</p>
    <a href={selection.evidenceUrl} target="_blank" rel="noreferrer">查看官方发布来源 ↗</a>
  </section>;
}
