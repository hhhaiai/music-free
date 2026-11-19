import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { parseMediaProbeLogs, outputVideoFormat, type MediaProbe } from "./mediaProbe";
export type { MediaProbe, MediaStreamInfo } from "./mediaProbe";
export type MediaExtractionResult = {
  audioBlob: Blob;
  videoBlob: Blob | null;
  videoMime: string | null;
  probe: MediaProbe;
  warnings: string[];
};
export type MediaProgress = (value: number, stage?: string) => void;

const MAX_LOCAL_MEDIA_BYTES = 250 * 1024 * 1024;
let engine: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let activeProgress: MediaProgress | null = null;
let activeLogs: string[] | null = null;
let jobQueue: Promise<unknown> = Promise.resolve();
let jobSequence = 0;

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = jobQueue.then(job, job);
  jobQueue = run.catch(() => undefined);
  return run;
}

function assertLocalFile(file: File) {
  if (!(file instanceof File)) throw new Error("请选择一个本地视频文件。");
  if (file.size <= 0) throw new Error("文件为空。");
  if (file.size > MAX_LOCAL_MEDIA_BYTES) throw new Error("单个视频暂时限制为 250 MB，以避免浏览器内存不足。");
  if (!/\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)$/i.test(file.name)) {
    throw new Error("暂时支持 MP4、MOV、M4V、WebM、MKV、AVI、MPEG 视频文件。");
  }
}

async function getEngine(progress: MediaProgress): Promise<FFmpeg> {
  activeProgress = progress;
  if (engine?.loaded) return engine;
  if (!loading) {
    loading = (async () => {
      const ffmpeg = new FFmpeg();
      ffmpeg.on("progress", ({ progress: value }) => {
        if (Number.isFinite(value)) activeProgress?.(Math.max(0, Math.min(100, Math.round(value * 100))));
      });
      ffmpeg.on("log", ({ message }) => {
        if (activeLogs && message) activeLogs.push(message);
      });
      await ffmpeg.load({
        coreURL: "/ffmpeg/ffmpeg-core.js",
        wasmURL: "/ffmpeg/ffmpeg-core.wasm",
      });
      engine = ffmpeg;
      return ffmpeg;
    })();
  }
  try { return await loading; }
  catch (error) { loading = null; engine = null; throw error; }
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason || new DOMException("操作已取消。", "AbortError");
}

function withAbort(ffmpeg: FFmpeg, signal?: AbortSignal) {
  if (!signal) return () => undefined;
  const abort = () => {
    try { ffmpeg.terminate(); } catch { /* worker may already be terminated */ }
    if (engine === ffmpeg) engine = null;
    loading = null;
  };
  if (signal.aborted) {
    abort();
    return () => undefined;
  }
  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

async function writeInput(ffmpeg: FFmpeg, file: File, inputName: string) {
  await ffmpeg.writeFile(inputName, await fetchFile(file));
}

async function probeInternal(file: File, progress: MediaProgress, signal?: AbortSignal) {
  assertLocalFile(file);
  assertNotAborted(signal);
  const ffmpeg = await getEngine(progress);
  assertNotAborted(signal);
  const inputName = `mf-probe-${++jobSequence}.${file.name.split(".").pop()?.toLowerCase() || "bin"}`;
  const logs: string[] = [];
  activeLogs = logs;
  const removeAbort = withAbort(ffmpeg, signal);
  try {
    progress(2, "加载本地媒体引擎");
    await writeInput(ffmpeg, file, inputName);
    assertNotAborted(signal);
    progress(8, "识别音视频轨道");
    activeProgress = (value) => progress(8 + Math.round(value * 0.08), "识别音视频轨道");
    // FFmpeg prints stream metadata before returning the expected no-output error.
    await ffmpeg.exec(["-hide_banner", "-i", inputName]);
    const probe = parseMediaProbeLogs(logs);
    if (!probe.streams.length) throw new Error("无法识别音视频轨道。文件可能损坏或编码暂不受支持。");
    return probe;
  } finally {
    activeLogs = null;
    removeAbort();
    await ffmpeg.deleteFile(inputName).catch(() => undefined);
  }
}

export function probeLocalMedia(file: File, progress: MediaProgress = () => undefined, signal?: AbortSignal) {
  return enqueue(() => probeInternal(file, progress, signal));
}

async function extractInternal(
  file: File,
  options: { audioStreamIndex: number; videoStreamIndex?: number | null; progress?: MediaProgress; signal?: AbortSignal; probe?: MediaProbe },
): Promise<MediaExtractionResult> {
  assertLocalFile(file);
  assertNotAborted(options.signal);
  const progress = options.progress || (() => undefined);
  const ffmpeg = await getEngine(progress);
  assertNotAborted(options.signal);
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const token = ++jobSequence;
  const inputName = `mf-source-${token}.${ext}`;
  const audioName = `mf-audio-${token}.mp3`;
  const videoFormat = outputVideoFormat(file.name);
  const videoName = `mf-video-${token}.${videoFormat.ext}`;
  const warnings: string[] = [];
  const removeAbort = withAbort(ffmpeg, options.signal);
  try {
    progress(1, "读取本地文件");
    await writeInput(ffmpeg, file, inputName);
    assertNotAborted(options.signal);

    progress(8, "提取音频轨");
    activeProgress = (value) => progress(8 + Math.round(value * 0.56), "提取音频轨");
    const audioCode = await ffmpeg.exec([
      "-hide_banner", "-i", inputName,
      "-map", `0:${options.audioStreamIndex}`,
      "-vn", "-sn", "-dn",
      "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100",
      audioName,
    ]);
    if (audioCode !== 0) throw new Error("音频轨提取失败。请尝试其他音频轨或确认文件编码受支持。");
    assertNotAborted(options.signal);
    const audioData = await ffmpeg.readFile(audioName);
    if (typeof audioData === "string") throw new Error("FFmpeg 没有返回有效音频数据。");
    const audioBytes = new Uint8Array(audioData);
    const audioBlob = new Blob([audioBytes.buffer as ArrayBuffer], { type: "audio/mpeg" });

    let videoBlob: Blob | null = null;
    let videoMime: string | null = null;
    if (options.videoStreamIndex !== undefined && options.videoStreamIndex !== null) {
      try {
        progress(68, "分离视频轨");
        activeProgress = (value) => progress(68 + Math.round(value * 0.28), "分离视频轨");
        const videoArgs = [
          "-hide_banner", "-i", inputName,
          "-map", `0:${options.videoStreamIndex}`,
          "-an", "-sn", "-dn", "-c:v", "copy",
        ];
        if (videoFormat.ext === "mp4") videoArgs.push("-movflags", "+faststart");
        videoArgs.push(videoName);
        const videoCode = await ffmpeg.exec(videoArgs);
        if (videoCode !== 0) throw new Error("当前视频编码与目标容器不兼容。");
        assertNotAborted(options.signal);
        const videoData = await ffmpeg.readFile(videoName);
        if (typeof videoData === "string") throw new Error("FFmpeg 没有返回有效视频数据。");
        const videoBytes = new Uint8Array(videoData);
        videoBlob = new Blob([videoBytes.buffer as ArrayBuffer], { type: videoFormat.mime });
        videoMime = videoFormat.mime;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        warnings.push(error instanceof Error ? error.message : "视频轨分离失败；音频轨已成功提取。");
      }
    }

    progress(100, "处理完成");
    return { audioBlob, videoBlob, videoMime, probe: options.probe || { durationSeconds: null, streams: [], hasAudio: true, hasVideo: Boolean(videoBlob) }, warnings };
  } finally {
    activeLogs = null;
    removeAbort();
    await Promise.all([inputName, audioName, videoName].map((name) => ffmpeg.deleteFile(name).catch(() => undefined)));
  }
}

export function extractMediaTracks(
  file: File,
  options: { audioStreamIndex: number; videoStreamIndex?: number | null; progress?: MediaProgress; signal?: AbortSignal; probe?: MediaProbe },
) {
  return enqueue(() => extractInternal(file, options));
}

export async function extractAudio(file: File, onProgress: (value: number) => void): Promise<Blob> {
  const probe = await probeLocalMedia(file, (value) => onProgress(Math.round(value * 0.15)));
  const audio = probe.streams.find((stream) => stream.type === "audio");
  if (!audio) throw new Error("视频中没有可提取的音频轨。");
  const result = await extractMediaTracks(file, {
    audioStreamIndex: audio.index,
    probe,
    progress: (value) => onProgress(15 + Math.round(value * 0.85)),
  });
  return result.audioBlob;
}

export function localMediaEngineStatus() {
  return {
    engine: "ffmpeg.wasm",
    processing: "browser-local-memory",
    maxFileBytes: MAX_LOCAL_MEDIA_BYTES,
    remoteUpload: false,
    persistentMediaCache: false,
  } as const;
}
