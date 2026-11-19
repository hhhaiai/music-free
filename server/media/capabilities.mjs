import { spawnSync } from "node:child_process";

function probe(command) {
  try {
    const result = spawnSync(command, ["-version"], { encoding: "utf8", timeout: 1200, windowsHide: true });
    if (result.error || result.status !== 0) return { available: false, version: null };
    const firstLine = String(result.stdout || "").split(/\r?\n/, 1)[0].slice(0, 160);
    return { available: true, version: firstLine };
  } catch {
    return { available: false, version: null };
  }
}

let cachedCapabilities;
export function getMediaCapabilities() {
  if (cachedCapabilities) return cachedCapabilities;
  cachedCapabilities = {
    processingMode: "browser-wasm",
    browserWasm: { required: true, description: "FFmpeg.wasm 在本地浏览器内存中处理用户选择的文件" },
    native: { ffmpeg: probe("ffmpeg"), ffprobe: probe("ffprobe") },
    remoteMediaUpload: false,
    persistentRemoteMediaCache: false,
    maxBrowserFileBytes: 250 * 1024 * 1024,
  };
  return cachedCapabilities;
}
