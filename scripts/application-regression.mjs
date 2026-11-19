import assert from "node:assert/strict";
import { createMusicDiscoveryUseCases } from "../src/application/use-cases/musicDiscovery.ts";

const calls = [];
const provider = (id, tracks, options = {}) => ({
  id, name: id, requiresApiKey: false,
  capabilities: { search: true, trending: Boolean(options.trending), independentAudio: true, licenseMetadata: false, videoSearch: false, officialEmbed: false },
  async search(query, limit, signal) { calls.push({ id, query, limit, aborted: Boolean(signal?.aborted) }); if (options.fail) throw new Error("test provider offline"); return tracks.map((track) => ({ ...track, id: `${id}:${track.id}`, provider: id })); },
  ...(options.trending ? { async trending() { return tracks.map((track) => ({ ...track, id: `${id}:trending:${track.id}`, provider: id })); } } : {}),
});

const audius = provider("audius", [
  { id: "song-a", title: "Seoul Nights", artist: "Artist A", kind: "remote-audio", remoteUrl: "https://a.example/a.mp3", genre: "K-pop", vocalType: "vocal", duration: 210, addedAt: 1 },
], { trending: true });
const archive = provider("internet-archive", [
  { id: "song-b", title: "Archive Song", artist: "Artist B", kind: "remote-audio", remoteUrl: "https://b.example/b.mp3", license: "CC BY", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", duration: 240, addedAt: 2 },
]);
const offline = provider("openverse", [], { fail: true });
const useCases = createMusicDiscoveryUseCases([audius, archive, offline]);

const search = await useCases.searchMusic("K-pop");
assert.equal(search.tracks.length, 2);
assert.ok(search.tracks.some((track) => track.region === "KR"));
assert.ok(search.warnings.some((warning) => warning.includes("openverse")));
assert.ok(calls.some((call) => call.id === "audius" && call.query === "K-pop"));
assert.ok(calls.some((call) => call.id === "internet-archive" && call.query === "K-pop"));

const discovery = await useCases.discoverMusic(["K-pop"]);
assert.ok(discovery.tracks.some((track) => track.title === "Seoul Nights"));
assert.ok(discovery.tracks.every((track) => (track.duration || 0) >= 120));
const abort = new AbortController(); abort.abort();
await assert.rejects(() => useCases.searchMusic("test", abort.signal), /搜索已取消/);

console.log("Music Free V4.1 application use-case and provider-injection regression passed.");
