import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const mode = process.argv[2] === "preview" ? "preview" : "dev";
const viteEntry = resolve("node_modules/vite/bin/vite.js");
if (!existsSync(viteEntry)) {
  console.error("找不到 Vite。请先在项目目录运行 npm install。");
  process.exit(1);
}
const children = [];
let shuttingDown = false;

function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300).unref();
}

const core = spawn(process.execPath, [resolve("server/index.mjs")], { stdio: "inherit", env: process.env });
children.push(core);
core.on("error", (error) => { console.error("本地服务启动失败：", error.message); stop(1); });
core.on("exit", (code) => { if (!shuttingDown) stop(code || 1); });

const args = mode === "preview"
  ? [viteEntry, "preview", "--host", "127.0.0.1", "--strictPort"]
  : [viteEntry, "--host", "127.0.0.1", "--strictPort"];
const vite = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
children.push(vite);
vite.on("error", (error) => { console.error("Vite 启动失败：", error.message); stop(1); });
vite.on("exit", (code) => stop(code || 0));

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
