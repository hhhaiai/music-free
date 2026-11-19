import assert from "node:assert/strict";
import { waitUntilPlayable, getBufferedAhead } from "../src/infrastructure/playback/bufferManager.ts";

globalThis.window = { setTimeout, clearTimeout };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
globalThis.HTMLMediaElement = { HAVE_CURRENT_DATA: 2, HAVE_FUTURE_DATA: 3, HAVE_ENOUGH_DATA: 4 };

class FakeAudio extends EventTarget {
  currentTime = 7;
  readyState = 3;
  paused = false;
  seeking = false;
  error = null;
  buffered = { length: 0, start: () => 0, end: () => 0 };
}
const playing = new FakeAudio();
const started = Date.now();
const readiness = await waitUntilPlayable(playing, "stable");
assert.ok(Date.now() - started < 500, "already playing media must not wait for the 26-second timeout");
assert.equal(readiness.degraded, true);
assert.equal(readiness.bufferedSeconds, 0);
assert.equal(getBufferedAhead(playing), 0);
const withBuffer = new FakeAudio();
withBuffer.buffered = { length: 1, start: () => 0, end: () => 17 };
const enough = await waitUntilPlayable(withBuffer, "stable");
assert.ok(enough.bufferedSeconds >= 8);
console.log("Music Free V4.1.1 buffer readiness regression passed.");
