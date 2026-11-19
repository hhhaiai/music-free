import assert from "node:assert/strict";
import { parseMediaProbeLogs, outputVideoFormat } from "../src/engine/mediaProbe.ts";
import { SourceHealthRegistry } from "../src/engine/sourceHealth.ts";
import { PlaybackController, playbackControllerFor } from "../src/engine/playbackController.ts";

const logs = [
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':",
  "  Duration: 00:03:21.45, start: 0.000000, bitrate: 1200 kb/s",
  "    Stream #0:0(und): Video: h264 (High), yuv420p, 1920x1080",
  "    Stream #0:1(chi): Audio: aac (LC), 48000 Hz, stereo",
  "    Stream #0:2(eng): Audio: aac (LC), 44100 Hz, stereo",
];
const probe = parseMediaProbeLogs(logs);
assert.equal(probe.durationSeconds, 201.45);
assert.equal(probe.streams.length, 3);
assert.equal(probe.streams[0].type, "video");
assert.equal(probe.streams[1].codec, "aac");
assert.equal(probe.streams[2].index, 2);
assert.equal(probe.hasAudio, true);
assert.equal(probe.hasVideo, true);
assert.deepEqual(outputVideoFormat("concert.MOV"), { ext: "mp4", mime: "video/mp4" });
assert.deepEqual(outputVideoFormat("clip.webm"), { ext: "webm", mime: "video/webm" });
assert.deepEqual(outputVideoFormat("legacy.avi"), { ext: "mkv", mime: "video/x-matroska" });

let now = 1_000_000;
const health = new SourceHealthRegistry(() => now);
const first = health.recordFailure("audius:track-1", "network timeout");
assert.equal(first.failures, 1);
assert.equal(first.retryAt, now + 15_000);
assert.equal(health.canAutoRetry("audius:track-1"), false);
now += 15_001;
assert.equal(health.canAutoRetry("audius:track-1"), true);
const second = health.recordFailure("audius:track-1", "decode error");
assert.equal(second.failures, 2);
assert.equal(second.retryAt, now + 30_000);
const recovered = health.recordSuccess("audius:track-1");
assert.equal(recovered.failures, 0);
assert.equal(recovered.retryAt, null);
assert.equal(health.get("audius:track-1").lastError, null);
const cappedHealth = new SourceHealthRegistry(() => now);
let cappedRecord;
for (let attempt = 0; attempt < 8; attempt += 1) cappedRecord = cappedHealth.recordFailure("source:max", "repeated failure");
assert.equal(cappedRecord.retryAt - now, 10 * 60_000, "source cooldown must be capped at ten minutes");

const fakeMedia = {
  paused: true, currentTime: 12, duration: 100, volume: 0.8, muted: false,
  playbackRate: 1, readyState: 3,
  buffered: { length: 1, start: () => 0, end: () => 24 },
  play: async function () { this.paused = false; },
  pause: function () { this.paused = true; },
};
const controller = new PlaybackController(fakeMedia);
await controller.play();
assert.equal(fakeMedia.paused, false);
controller.pause();
assert.equal(fakeMedia.paused, true);
assert.equal(await controller.toggle(), true);
assert.equal(fakeMedia.paused, false);
assert.equal(controller.seek(150), 100);
assert.equal(controller.setVolume(2), 1);
assert.equal(controller.setRate(3), 2);
const snapshot = controller.snapshot();
assert.equal(snapshot.currentTime, 100);
assert.equal(snapshot.bufferedSeconds, 0);
assert.equal(snapshot.volume, 1);
assert.equal(playbackControllerFor(fakeMedia), playbackControllerFor(fakeMedia));

console.log("Music Free V4.1.1 media, playback-controller and source-health regression passed.");
