import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalEnvironment } from "../server/env.mjs";

const dir = await mkdtemp(join(tmpdir(), "music-free-env-"));
const previous = process.env.YOUTUBE_API_KEY;
const previousIgnored = process.env.IGNORED_VALUE;
try {
  await writeFile(join(dir, ".env"), "# local-only secret\nYOUTUBE_API_KEY=\"local-test-secret\"\nIGNORED_VALUE=not-loaded\n", { mode: 0o600 });
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.IGNORED_VALUE;
  await loadLocalEnvironment(dir);
  assert.equal(process.env.YOUTUBE_API_KEY, "local-test-secret");
  assert.equal(process.env.IGNORED_VALUE, undefined, "only explicitly supported local variables should be loaded");
  process.env.YOUTUBE_API_KEY = "shell-precedence";
  await loadLocalEnvironment(dir);
  assert.equal(process.env.YOUTUBE_API_KEY, "shell-precedence", "process environment must take precedence over .env");
  console.log("Music Free V4.1.1 local environment regression passed.");
} finally {
  if (previous === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = previous;
  if (previousIgnored === undefined) delete process.env.IGNORED_VALUE;
  else process.env.IGNORED_VALUE = previousIgnored;
  await rm(dir, { recursive: true, force: true });
}
