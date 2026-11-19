import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Load only explicitly supported local secrets from .env; never print values. */
export async function loadLocalEnvironment(cwd = process.cwd()) {
  let content = "";
  try { content = await readFile(join(cwd, ".env"), "utf8"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(YOUTUBE_API_KEY)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2").trim();
    if (value && !/[\r\n]/.test(value)) process.env[match[1]] = value;
  }
}
