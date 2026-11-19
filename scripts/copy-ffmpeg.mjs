import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const fromDir = resolve("node_modules/@ffmpeg/core/dist/esm");
const toDir = resolve("public/ffmpeg");
const files = ["ffmpeg-core.js", "ffmpeg-core.wasm"];
if (!existsSync(fromDir)) throw new Error("找不到 @ffmpeg/core ESM 目录，请重新运行 npm install。");
mkdirSync(toDir, { recursive: true });
for (const file of files) {
  const from = resolve(fromDir, file);
  if (!existsSync(from)) throw new Error(`缺少 FFmpeg 文件：${from}`);
  copyFileSync(from, resolve(toDir, file));
}
console.log("FFmpeg ESM 核心文件已复制到 public/ffmpeg（本地加载）。");
