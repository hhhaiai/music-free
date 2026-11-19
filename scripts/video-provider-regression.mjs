import assert from "node:assert/strict";
import {
  parseYouTubeVideoId,
  parseMediaStartSeconds,
  parseIsoDuration,
  resolveYouTubeVideoUrl,
  searchYouTubeVideos,
  fetchYouTubeTrendingMusic,
} from "../server/providers/youtube.mjs";
import { resolveBilibiliVideoUrl } from "../server/providers/bilibili.mjs";
import { createDiscoveryTasks } from "../server/tasks/discovery.mjs";

assert.equal(parseYouTubeVideoId("https://www.youtube.com/watch?v=abcdefghijk"), "abcdefghijk");
assert.equal(parseYouTubeVideoId("https://youtu.be/abcdefghijk?t=90"), "abcdefghijk");
assert.equal(parseYouTubeVideoId("https://youtube.com/shorts/abcdefghijk"), "abcdefghijk");
assert.equal(parseYouTubeVideoId("https://youtube.com.evil.example/watch?v=abcdefghijk"), null);
assert.equal(parseYouTubeVideoId("javascript:alert(1)"), null);
assert.equal(parseMediaStartSeconds("https://youtu.be/abcdefghijk?t=1m30s"), 90);
assert.equal(parseMediaStartSeconds("https://youtu.be/abcdefghijk?start=125"), 125);
assert.equal(parseIsoDuration("PT1H2M3S"), 3723);
assert.equal(parseIsoDuration("PT4M"), 240);
assert.equal(parseIsoDuration("P1D"), 0);

const calls = [];
const fakeFetch = async (url) => {
  const parsed = new URL(url);
  calls.push(parsed);
  if (parsed.pathname.endsWith("/search")) return new Response(JSON.stringify({ items: [
    { id: { kind: "youtube#video", videoId: "abcdefghijk" }, snippet: { title: "Full Song", channelTitle: "Artist", publishedAt: "2026-01-01T00:00:00Z", thumbnails: { high: { url: "https://img.example/full.jpg" } } } },
    { id: { kind: "youtube#video", videoId: "lmnopqrstuv" }, snippet: { title: "Short Clip", channelTitle: "Artist" } },
    { id: { kind: "youtube#video", videoId: "zyxwvutsrqp" }, snippet: { title: "Not Embeddable", channelTitle: "Artist" } },
  ] }), { status: 200, headers: { "content-type": "application/json" } });
  if (parsed.pathname.endsWith("/videos")) return new Response(JSON.stringify({ items: [
    { id: "abcdefghijk", contentDetails: { duration: "PT4M" }, status: { embeddable: true }, statistics: { viewCount: "12345" }, snippet: { title: "Full Song", channelTitle: "Artist", thumbnails: { high: { url: "https://img.example/full.jpg" } } } },
    { id: "lmnopqrstuv", contentDetails: { duration: "PT45S" }, status: { embeddable: true } },
    { id: "zyxwvutsrqp", contentDetails: { duration: "PT5M" }, status: { embeddable: false } },
  ] }), { status: 200, headers: { "content-type": "application/json" } });
  if (parsed.hostname === "www.youtube.com" && parsed.pathname === "/oembed") return new Response(JSON.stringify({ title: "Resolved Video", author_name: "Creator", thumbnail_url: "https://img.example/thumb.jpg" }), { status: 200, headers: { "content-type": "application/json" } });
  throw new Error(`Unexpected request: ${parsed}`);
};

const results = await searchYouTubeVideos("test song", { apiKey: "test-key", region: "SG", limit: 10, fetchImpl: fakeFetch });
assert.equal(results.length, 1, "only embeddable videos at least two minutes long should be returned");
assert.equal(results[0].id, "youtube:abcdefghijk");
assert.equal(results[0].durationSeconds, 240);
assert.equal(results[0].viewCount, 12345);
assert.match(results[0].embed.url, /^https:\/\/www\.youtube-nocookie\.com\/embed\//);
assert.equal(calls.length, 2, "search results must be hydrated with video details before being shown");
const trending = await fetchYouTubeTrendingMusic({ apiKey: "test-key", region: "SG", limit: 20, fetchImpl: fakeFetch });
assert.equal(trending.length, 1, "trending feed must apply the same duration and embeddability filters");
assert.equal(new URL(calls.at(-1)).searchParams.get("chart"), "mostPopular");
assert.equal(createDiscoveryTasks().length, 4, "no-key install must not register a YouTube API task");
const configuredTasks = createDiscoveryTasks({ youtubeApiKey: "local-test-key" });
assert.equal(configuredTasks.length, 5, "YouTube trending task is opt-in and registered when a key exists");
assert.equal(configuredTasks.at(-1).id, "youtube-music-trending");

await assert.rejects(() => searchYouTubeVideos("test", { apiKey: "", fetchImpl: fakeFetch }), /API Key/);
const resolved = await resolveYouTubeVideoUrl("https://youtu.be/abcdefghijk?t=90", { fetchImpl: fakeFetch });
assert.equal(resolved.title, "Resolved Video");
assert.equal(resolved.creator, "Creator");
assert.equal(resolved.embed.startSeconds, 90);
assert.match(resolved.embed.url, /start=90/);
await assert.rejects(() => resolveYouTubeVideoUrl("https://example.com/watch?v=abcdefghijk", { fetchImpl: fakeFetch }), /有效的 YouTube/);

const bilibili = resolveBilibiliVideoUrl("https://www.bilibili.com/video/BV1xx411c7mD/?p=2&t=45");
assert.equal(bilibili.videoId, "BV1xx411c7mD");
assert.match(bilibili.embed.url, /bvid=BV1xx411c7mD/);
assert.match(bilibili.embed.url, /p=2/);
assert.match(bilibili.embed.url, /t=45/);
assert.equal(bilibili.metadataAvailable, false, "do not fabricate metadata not supplied by an authorized source");
assert.throws(() => resolveBilibiliVideoUrl("https://example.com/video/BV1xx411c7mD"), /官方域名/);
assert.throws(() => resolveBilibiliVideoUrl("https://www.bilibili.com/video/av123456"), /BV 号/);

console.log("Music Free V4.1.1 video provider regression passed.");
