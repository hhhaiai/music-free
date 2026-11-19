import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { getVideoProvider, listVideoProviders } from "../../infrastructure/providers/video/registry";
import type { VideoPlatformId, VideoSearchResult } from "../../infrastructure/providers/video/types";
import { ConcertSetlistPanel } from "./ConcertSetlistPanel";

const PROVIDERS = listVideoProviders();
type ProviderStatus = {
  youtube?: { enabled: boolean; searchMode: "data-api" | "official-search-page"; apiKeyConfigured: boolean; trendingEnabled?: boolean };
  bilibili?: { enabled: boolean; searchMode: "official-search-page"; apiKeyConfigured: boolean; trendingEnabled?: boolean };
};

function durationLabel(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return "时长待确认";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function countLabel(value?: number) {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

export function VideoSearchPanel({ query }: { query: string }) {
  const [platform, setPlatform] = useState<VideoPlatformId>("youtube");
  const [term, setTerm] = useState(query);
  const [region, setRegion] = useState("SG");
  const [urlInput, setUrlInput] = useState("");
  const [status, setStatus] = useState<ProviderStatus>({});
  const [results, setResults] = useState<VideoSearchResult[]>([]);
  const [active, setActive] = useState<VideoSearchResult | null>(null);
  const [activeStartSeconds, setActiveStartSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [trending, setTrending] = useState<VideoSearchResult[]>([]);
  const [trendingUpdatedAt, setTrendingUpdatedAt] = useState<number | null>(null);

  useEffect(() => { if (query.trim()) setTerm(query); }, [query]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/local/video/providers", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("本地视频 Provider 状态暂时不可用。");
        return response.json() as Promise<ProviderStatus>;
      }),
      fetch("/api/local/video/youtube/trending", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) return { items: [] as VideoSearchResult[], updatedAt: null as number | null };
        return response.json() as Promise<{ items: VideoSearchResult[]; updatedAt: number | null }>;
      }),
    ]).then(([providers, popular]) => {
      if (!cancelled) {
        setStatus(providers);
        setTrending(popular.items || []);
        setTrendingUpdatedAt(popular.updatedAt || null);
      }
    }).catch((error) => { if (!cancelled) setFailure(error instanceof Error ? error.message : "无法读取视频来源状态。"); });
    return () => { cancelled = true; };
  }, []);

  const provider = useMemo(() => getVideoProvider(platform), [platform]);
  const activeProvider = useMemo(() => active ? getVideoProvider(active.platform) : undefined, [active]);
  const activeEmbedUrl = active && activeProvider ? activeProvider.buildEmbed(active, activeStartSeconds) : active?.embed.url || "";
  const searchUrl = provider?.buildSearchUrl(term.trim()) || "";

  function selectActive(item: VideoSearchResult) {
    setActive(item);
    setActiveStartSeconds(0);
  }
  const apiSearchEnabled = platform === "youtube" && status.youtube?.searchMode === "data-api";

  async function searchVideos(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const value = term.trim();
    if (!value) { setFailure("请输入歌手、歌曲或视频关键词。"); return; }
    setFailure("");
    setMessage("");
    setActive(null);
    setResults([]);
    if (!provider?.search || !apiSearchEnabled) {
      setMessage(platform === "bilibili"
        ? "Bilibili 当前使用官方站内搜索。打开搜索页后，复制视频链接粘贴到下方即可在 Music Free 内调用官方播放器。"
        : "未配置 YouTube Data API Key。可以直接打开 YouTube 官方搜索页；复制视频链接后粘贴到下方，无需 API Key。可选 API Key 只保存在本机。 ");
      return;
    }
    setLoading(true);
    try {
      const items = await provider.search(value, { limit: 10, region, order: "relevance" });
      setResults(items);
      setMessage(items.length ? `找到 ${items.length} 个可嵌入结果（已过滤已知短片段和不可嵌入视频）。` : "没有找到符合条件的可嵌入视频。可以尝试更具体的歌名或打开官方搜索页。 ");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "视频搜索失败。");
    } finally { setLoading(false); }
  }

  async function resolveLink(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const value = urlInput.trim();
    if (!value) { setFailure("请粘贴 YouTube 或 Bilibili 视频链接。"); return; }
    const targetPlatform: VideoPlatformId = /(^|\.)bilibili\.com|b23\.tv/i.test(value) ? "bilibili" : "youtube";
    const targetProvider = getVideoProvider(targetPlatform);
    if (!targetProvider) { setFailure("当前视频来源未注册。"); return; }
    setPlatform(targetPlatform);
    setLoading(true);
    setFailure("");
    setMessage("");
    setResults([]);
    try {
      const item = await targetProvider.resolveUrl(value);
      if (!item) throw new Error("没有识别出可播放的视频链接。");
      selectActive(item);
      setMessage(item.metadataAvailable
        ? "已读取视频公开资料，播放由平台官方嵌入播放器完成。"
        : "已识别 BV 号。Bilibili 标题和作者信息由官方播放器加载。搜索与播放仍在 Bilibili 官方页面/播放器中完成。");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "视频链接解析失败。");
    } finally { setLoading(false); }
  }

  return <section className="video-search-panel">
    <div className="video-panel-heading">
      <div><small>OFFICIAL VIDEO SOURCES</small><h3>视频平台发现</h3><p>独立于音频播放器。仅调用平台官方搜索入口和官方嵌入播放器，不提取或下载平台媒体文件。</p></div>
      <span className="video-panel-state">{status.youtube?.apiKeyConfigured ? "YouTube API 已配置" : "免 Key 链接模式"}</span>
    </div>
    <div className="video-provider-tabs">
      {PROVIDERS.map((item) => <button type="button" key={item.id} className={platform === item.id ? "selected" : ""} onClick={() => { setPlatform(item.id); setResults([]); setActive(null); setMessage(""); setFailure(""); }}>
        <span>{item.id === "youtube" ? "▶" : "▣"}</span>{item.name}<small>{item.searchMode === "api" ? (status.youtube?.apiKeyConfigured ? "API 搜索" : "可选 API") : "官方搜索页"}</small>
      </button>)}
    </div>
    <form className="video-query-form" onSubmit={(event) => void searchVideos(event)}>
      <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="搜索歌曲、歌手、演唱会或 MV…" aria-label="视频平台搜索关键词"/>
      {platform === "youtube" && <select className="video-region-select" value={region} onChange={(event) => setRegion(event.target.value)} aria-label="YouTube 搜索地区">
        <option value="SG">新加坡</option><option value="US">美国</option><option value="GB">英国</option><option value="JP">日本</option><option value="KR">韩国</option><option value="MY">马来西亚</option><option value="TH">泰国</option><option value="ID">印尼</option><option value="PH">菲律宾</option>
      </select>}
      <button className="primary" type="submit" disabled={loading}>{loading ? "处理中…" : "搜索"}</button>
      {searchUrl && <a className="video-external-search" href={searchUrl} target="_blank" rel="noreferrer">官方搜索 ↗</a>}
    </form>
    <form className="video-link-form" onSubmit={(event) => void resolveLink(event)}>
      <input value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="粘贴 YouTube / Bilibili 视频链接…" aria-label="视频链接"/>
      <button type="submit" className="outline" disabled={loading}>识别并播放</button>
    </form>
    {message && <div className="video-message">{message}</div>}
    {failure && <div className="warning-line">{failure}</div>}
    {platform === "youtube" && !status.youtube?.apiKeyConfigured && <div className="video-message">当前为免 Key 模式：YouTube 站内搜索和粘贴链接均可使用；自动热门和应用内搜索 API 需要可选配置本机 Key。</div>}
    {platform === "youtube" && status.youtube?.apiKeyConfigured && trending.length === 0 && <div className="video-message">YouTube Data API 已启用。后台热门快照尚未同步完成，首次任务启动后会自动显示；你也可以先使用上方搜索。</div>}
    {platform === "youtube" && trending.length > 0 && <div className="video-trending-block">
      <div className="video-trending-heading"><b>本机后台 · YouTube 音乐热门</b><small>{trendingUpdatedAt ? `更新于 ${new Date(trendingUpdatedAt).toLocaleString()}` : "已缓存"}</small></div>
      <div className="video-result-list">
        {trending.slice(0, 8).map((item) => <article className={`video-result ${active?.id === item.id ? "active" : ""}`} key={item.id}>
          <button type="button" className="video-result-main" onClick={() => selectActive(item)}>
            <span className="video-thumb">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy"/> : <span>▶</span>}</span>
            <span className="video-result-copy"><b>{item.title}</b><small>{item.creator} · {durationLabel(item.durationSeconds)}{item.viewCount ? ` · ${countLabel(item.viewCount)} 次观看` : ""}</small></span>
          </button>
          <a href={item.watchUrl} target="_blank" rel="noreferrer">原始页面 ↗</a>
        </article>)}
      </div>
    </div>}
    {results.length > 0 && <div className="video-result-list">
      {results.map((item) => <article className={`video-result ${active?.id === item.id ? "active" : ""}`} key={item.id}>
        <button type="button" className="video-result-main" onClick={() => selectActive(item)}>
          <span className="video-thumb">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy"/> : <span>▶</span>}</span>
          <span className="video-result-copy"><b>{item.title}</b><small>{item.creator} · {durationLabel(item.durationSeconds)}{item.viewCount ? ` · ${countLabel(item.viewCount)} 次观看` : ""}</small></span>
        </button>
        <a href={item.watchUrl} target="_blank" rel="noreferrer">原始页面 ↗</a>
      </article>)}
    </div>}
    {active && <div className="video-player-shell">
      <div className="video-player-title"><div><b>{active.title}</b><small>{active.creator} · {active.platform === "youtube" ? "YouTube 官方播放器" : "Bilibili 官方播放器"}</small></div><a href={active.watchUrl} target="_blank" rel="noreferrer">打开原站 ↗</a></div>
      <div className="official-video-frame"><iframe key={`${active.id}-${activeStartSeconds}`} src={activeEmbedUrl} title={`${active.title} - 官方嵌入播放器`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen/></div>
      <small className="video-player-note">平台可能根据版权方设置限制嵌入播放；遇到限制时请使用原始页面。Music Free 不会尝试绕过限制。</small>
      <ConcertSetlistPanel initialChapters={active.chapters || []} onPlayChapter={setActiveStartSeconds}/>
    </div>}
    {!results.length && !active && !message && <div className="video-empty">搜索平台曲目，或直接粘贴一个视频链接。YouTube API 搜索是可选功能，不配置 Key 也能使用官方搜索和链接播放。</div>}
  </section>;
}
