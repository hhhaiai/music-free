import assert from "node:assert/strict";
import { parseMusicSearchIntent, musicCatalogQueries } from "../src/domain/music/searchIntent.ts";
import { verifiedCatalogTracks, verifiedRecordingForCatalog, VERIFIED_RECORDINGS } from "../src/domain/music/verifiedCatalog.ts";
import { mergeAndRankCatalog, catalogMatchesIntent } from "../src/application/use-cases/catalogSearch.ts";
import { searchAppleCatalog } from "../src/infrastructure/providers/appleCatalog.ts";
import { resolveCatalogAudio } from "../src/application/use-cases/resolveCatalogAudio.ts";
import { sameTrackIdentity, matchesCatalogIdentity } from "../src/domain/music/identity.ts";
import { startBufferedPlayback } from "../src/application/use-cases/startBufferedPlayback.ts";

const SCENARIOS = [
  { search: "星星（俄罗斯高音的）", title: "星星", artist: "维塔斯", video: "AwJj10bCl08", term: "Звезда Vitas" },
  { search: "陈楚生 -庙堂之外", title: "庙堂之外", artist: "陈楚生", video: "r_7-80t9tKA", term: "庙堂之外 陈楚生" },
  { search: "黄昏 - 周传雄", title: "黄昏", artist: "周传雄", video: "6ca_YHZvzls", term: "黄昏 周传雄" },
  { search: "路虎", title: "雪落下的声音", artist: "陆虎", video: "wBIpo6vTuYc", term: "陆虎" },
];

for (const scenario of SCENARIOS) {
  const intent = parseMusicSearchIntent(scenario.search);
  assert.equal(intent.normalizedQuery, scenario.term);
  const entries = verifiedCatalogTracks(scenario.search);
  assert.ok(entries.length, `verified reference index must identify ${scenario.search}`);
  assert.equal(entries[0].title, scenario.title);
  assert.equal(entries[0].artist, scenario.artist);
  assert.equal(entries[0].officialVideoId, scenario.video);
  assert.equal(entries[0].catalogSource, "verified-reference");
  assert.equal(verifiedRecordingForCatalog(entries[0])?.videoId, scenario.video);
  assert.ok(catalogMatchesIntent(entries[0], intent));
  const mixed = mergeAndRankCatalog(scenario.search, [
    { id: "unrelated", title: scenario.title, artist: "其他歌手", storefront: "SG" },
    { id: "live", title: `${scenario.title} (Live)`, artist: scenario.artist, versionKind: "live", storefront: "SG" },
  ]);
  assert.equal(mixed[0].title, scenario.title);
  assert.equal(mixed[0].artist, scenario.artist);
  assert.equal(mixed[0].catalogSource, "verified-reference");
  assert.ok(!mixed.some((track) => track.artist === "其他歌手"));
  assert.ok(musicCatalogQueries(intent)[0].length > 0);
}
assert.equal(verifiedCatalogTracks("星星").length, 0, "bare ambiguous title must not be falsely identified as Vitas");
assert.equal(parseMusicSearchIntent("黄昏 - 周传雄").kind, "song");
assert.equal(parseMusicSearchIntent("周传雄 - 黄昏").kind, "song");
assert.equal(parseMusicSearchIntent("陆虎").kind, "artist");
assert.equal(parseMusicSearchIntent("路虎").artist, "陆虎");
assert.equal(VERIFIED_RECORDINGS.length, 4);

const appleFixture = (title, artist, duration = 200, id = 1) => ({
  wrapperType: "track", kind: "song", trackId: id, trackName: title, artistName: artist,
  collectionName: "测试目录专辑", trackTimeMillis: duration * 1000, releaseDate: "2020-01-01T00:00:00Z",
  trackViewUrl: "https://music.apple.com/test", artworkUrl100: "https://example.com/cover.png",
});
const mockedFetch = async (url) => {
  const parsed = new URL(String(url));
  assert.equal(parsed.hostname, "itunes.apple.com");
  const q = (parsed.searchParams.get("term") || "").toLowerCase();
  let results = [];
  if (/звезда|zvezda|vitas/.test(q)) results = [appleFixture("Звезда", "Vitas", 210), appleFixture("Звезда", "Other Singer", 210, 2)];
  else if (q.includes("庙堂") || q.includes("陈楚生")) results = [appleFixture("庙堂之外", "Other Singer", 282, 3), appleFixture("庙堂之外", "陈楚生", 282, 4)];
  else if (q.includes("黄昏") || q.includes("周传雄")) results = [appleFixture("黄昏", "小阿七", 341, 5), appleFixture("黃昏", "Steve Chou", 344, 6)];
  else if (q.includes("陆虎")) results = [appleFixture("雪落下的声音", "陆虎", 240, 7), appleFixture("路虎", "汽車頻道", 180, 8)];
  return { ok: true, status: 200, json: async () => ({ resultCount: results.length, results }) };
};
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = mockedFetch;
  for (const scenario of SCENARIOS) {
    const result = await searchAppleCatalog(scenario.search);
    assert.ok(result.tracks.length, `Apple + verified search should contain ${scenario.search}`);
    assert.equal(result.tracks[0].title, scenario.title, `top title for ${scenario.search}`);
    assert.equal(result.tracks[0].artist, scenario.artist, `top singer for ${scenario.search}`);
    assert.ok(result.tracks.every((item) => item.artist !== "Other Singer" && item.artist !== "小阿七"), "wrong-singer rows must not leak into an explicit original-singer query");
  }
} finally { globalThis.fetch = originalFetch; }

// Offline mode: the verified catalog remains useful metadata, but audio stays unavailable.
const offline = verifiedCatalogTracks("星星（俄罗斯高音的）")[0];
const noSource = await resolveCatalogAudio(offline, [], async () => ({ tracks: [], warnings: ["offline"] }));
assert.equal(noSource.matched, undefined);
assert.equal(noSource.candidates.length, 0);
assert.ok(noSource.warnings.includes("offline"));

const target = verifiedCatalogTracks("黄昏 - 周传雄")[0];
const playable = (id, title, artist, duration = 344) => ({
  id, title, artist, duration, kind: "remote-audio", provider: "audius",
  remoteUrl: `https://audio.example/${id}.mp3`, addedAt: 1,
});
const original = playable("official", "黃昏", "Steve Chou");
const wrongSinger = playable("wrong", "黄昏", "小阿七");
const singerMissing = playable("missing", "黄昏", "");
const liveInstead = { ...playable("live", "黄昏 (Live)", "周传雄"), versionKind: "live" };
const wrongSong = playable("other", "五十年以后", "小阿七");
const result = await resolveCatalogAudio(target, [], async () => ({ tracks: [wrongSinger, singerMissing, liveInstead, wrongSong, original], warnings: [] }));
assert.equal(result.matched?.id, "official");
assert.deepEqual(result.candidates.map((x) => x.id), ["official"]);
assert.equal(sameTrackIdentity(original, wrongSinger), false);
assert.equal(matchesCatalogIdentity(target, wrongSinger), false);
assert.equal(matchesCatalogIdentity(target, liveInstead), false);
assert.equal(matchesCatalogIdentity(target, original), true);

const events = [];
const buffered = await startBufferedPlayback(
  async () => { events.push("play()"); await new Promise((resolve) => setTimeout(resolve, 5)); events.push("playing"); },
  async () => { events.push("buffer"); await new Promise((resolve) => setTimeout(resolve, 10)); return { bufferedSeconds: 3 }; },
);
assert.equal(events[0], "play()", "play() must be called immediately within the click handler");
assert.equal(buffered.bufferedSeconds, 3);
await assert.rejects(() => startBufferedPlayback(async () => { throw new Error("Autoplay blocked"); }, () => new Promise(() => {})), /Autoplay blocked/);

console.log("Music Free V4.1.1: four named search scenarios, offline/no-substitution, Apple mock, and playback ordering passed.");
