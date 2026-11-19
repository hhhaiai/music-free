import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  extractMediaTracks,
  probeLocalMedia,
  type MediaExtractionResult,
  type MediaProbe,
} from "../../infrastructure/media/localExtractor";
import type { MediaStreamInfo } from "../../infrastructure/media/mediaProbe";

function bytesLabel(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
function timeLabel(value: number | null) {
  if (!value || !Number.isFinite(value)) return "时长待识别";
  const total = Math.floor(value);
  return `${Math.floor(total / 3600)}:${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function LocalMediaWorkbench() {
  const inputRef = useRef<HTMLInputElement>(null);
  const audioUrlRef = useRef<string | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  const [audioIndex, setAudioIndex] = useState("");
  const [videoIndex, setVideoIndex] = useState("");
  const [result, setResult] = useState<MediaExtractionResult | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => () => {
    abortRef.current?.abort();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
  }, []);

  function clearOutputs() {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    audioUrlRef.current = null;
    videoUrlRef.current = null;
    setAudioUrl("");
    setVideoUrl("");
    setResult(null);
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] || null;
    event.target.value = "";
    if (!selected) return;
    if (selected.size > 250 * 1024 * 1024) {
      setError("文件超过 250 MB。为避免浏览器内存不足，请先选择较小的本地文件。");
      return;
    }
    abortRef.current?.abort();
    clearOutputs();
    setFile(selected);
    setProbe(null);
    setError("");
    setMessage("文件已选择。下一步识别其中的音频和视频轨道。");
  }

  async function inspect() {
    if (!file) { setError("请先选择本地视频文件。"); return; }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true); setError(""); setMessage(""); setProgress(0);
    try {
      const next = await probeLocalMedia(file, (value, label) => { setProgress(value); if (label) setStage(label); }, controller.signal);
      setProbe(next);
      setAudioIndex(String(next.streams.find((item) => item.type === "audio")?.index ?? ""));
      setVideoIndex(String(next.streams.find((item) => item.type === "video")?.index ?? ""));
      setMessage(`识别完成：${next.streams.filter((item) => item.type === "audio").length} 条音频轨，${next.streams.filter((item) => item.type === "video").length} 条视频轨。`);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "媒体轨道识别失败。");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  async function separate() {
    if (!file || !probe) { setError("请先选择文件并识别轨道。"); return; }
    const selectedAudio = Number(audioIndex);
    const selectedVideo = videoIndex === "" ? null : Number(videoIndex);
    if (!Number.isInteger(selectedAudio) || !probe.streams.some((item) => item.type === "audio" && item.index === selectedAudio)) {
      setError("请选择有效的音频轨。"); return;
    }
    if (selectedVideo !== null && !probe.streams.some((item) => item.type === "video" && item.index === selectedVideo)) {
      setError("请选择有效的视频轨。"); return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true); setError(""); setMessage(""); setProgress(0); clearOutputs();
    try {
      const next = await extractMediaTracks(file, {
        audioStreamIndex: selectedAudio,
        videoStreamIndex: selectedVideo,
        probe,
        signal: controller.signal,
        progress: (value, label) => { setProgress(value); if (label) setStage(label); },
      });
      const nextAudioUrl = URL.createObjectURL(next.audioBlob);
      const nextVideoUrl = next.videoBlob ? URL.createObjectURL(next.videoBlob) : "";
      audioUrlRef.current = nextAudioUrl;
      videoUrlRef.current = nextVideoUrl || null;
      setResult(next);
      setAudioUrl(nextAudioUrl);
      setVideoUrl(nextVideoUrl);
      setMessage(next.warnings.length ? `音频轨已提取；视频轨提示：${next.warnings.join("；")}` : "音频轨与视频轨处理完成。结果只在当前页面内存中预览。");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "音视频轨处理失败。");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  function cancel() {
    abortRef.current?.abort(new DOMException("用户取消了本地媒体处理。", "AbortError"));
    abortRef.current = null;
    setBusy(false);
    setMessage("已请求取消处理。若 FFmpeg worker 已中止，下次操作会重新初始化引擎。");
  }

  function streamLabel(stream: MediaStreamInfo) {
    return `轨道 ${stream.index} · ${stream.codec} · ${stream.type === "audio" ? "音频" : "视频"}`;
  }

  return <section className="panel media-workbench">
    <div className="panel-heading"><div><span className="eyebrow">LOCAL MEDIA PIPELINE</span><h2>音视频双轨工作台</h2></div><span className="media-local-badge">仅本机处理</span></div>
    <p className="section-intro">选择你拥有或获准处理的本地视频。Music Free 使用 FFmpeg.wasm 在浏览器本机内存中识别轨道、分离音频和视频，不上传文件、不保存提取结果，也不提供下载。</p>
    <input ref={inputRef} hidden type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,.mp4,.mov,.m4v,.webm,.mkv,.avi,.mpeg,.mpg" onChange={chooseFile}/>
    <div className="media-file-picker">
      <div className="media-file-icon">▣</div>
      <div className="media-file-info">
        <b>{file?.name || "尚未选择本地视频"}</b>
        <small>{file ? `${bytesLabel(file.size)} · ${file.type || "媒体类型待识别"}` : "支持 MP4 / MOV / M4V / WebM / MKV / AVI · 最大 250 MB"}</small>
      </div>
      <button type="button" className="outline" disabled={busy} onClick={() => inputRef.current?.click()}>选择文件</button>
    </div>
    {probe && <div className="media-probe-summary">
      <div><small>媒体时长</small><b>{timeLabel(probe.durationSeconds)}</b></div>
      <div><small>音频轨</small><b>{probe.streams.filter((item) => item.type === "audio").length}</b></div>
      <div><small>视频轨</small><b>{probe.streams.filter((item) => item.type === "video").length}</b></div>
    </div>}
    {probe && <div className="media-stream-selectors">
      <label>音频轨
        <select value={audioIndex} onChange={(event) => setAudioIndex(event.target.value)}>
          {probe.streams.filter((item) => item.type === "audio").map((item) => <option key={item.index} value={item.index}>{streamLabel(item)}</option>)}
        </select>
      </label>
      <label>视频轨
        <select value={videoIndex} onChange={(event) => setVideoIndex(event.target.value)}>
          <option value="">不分离视频轨</option>
          {probe.streams.filter((item) => item.type === "video").map((item) => <option key={item.index} value={item.index}>{streamLabel(item)}</option>)}
        </select>
      </label>
    </div>}
    <div className="media-actions">
      <button type="button" className="outline" disabled={!file || busy} onClick={() => void inspect()}>① 识别轨道</button>
      <button type="button" className="primary" disabled={!probe || busy || !probe.hasAudio} onClick={() => void separate()}>② 分离音视频轨</button>
      {busy && <button type="button" className="outline danger-button" onClick={cancel}>取消</button>}
    </div>
    {busy && <div className="progress-box"><div><b>{stage || "本地媒体处理中…"}</b><strong>{progress}%</strong></div><div className="progress"><i style={{ width: `${progress}%` }}/></div><small>FFmpeg 在浏览器本机内存中运行；请暂时不要关闭此标签页。</small></div>}
    {error && <div className="warning-line">{error}</div>}
    {message && <div className="media-message">{message}</div>}
    {result && <div className="media-preview-grid">
      <div className="media-preview-card"><div><b>独立音频轨</b><small>MP3 · {bytesLabel(result.audioBlob.size)}</small></div><audio controls controlsList="nodownload" preload="metadata" src={audioUrl}/></div>
      {result.videoBlob && videoUrl && <div className="media-preview-card"><div><b>独立视频轨</b><small>{result.videoMime} · {bytesLabel(result.videoBlob.size)}</small></div><video controls controlsList="nodownload" playsInline preload="metadata" src={videoUrl}/></div>}
    </div>}
    <div className="media-footnote">说明：输出只用于当前页面预览，刷新或关闭页面后会释放内存。视频轨采用无重新编码的流复制；如果原始编码与目标容器不兼容，仍会保留已成功提取的音频轨，并显示具体原因。</div>
  </section>;
}
