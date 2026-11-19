import assert from "node:assert/strict";
import * as identity from "../src/domain/music/identity.ts";
import { classifyTrackVersion, classifyRegionAndLanguage, classifyOriginality, enrichTrackMetadata } from "../src/domain/music/metadata.ts";
import { rankSourceCandidates } from "../src/domain/music/sourceRanking.ts";
import { rankRecommendations } from "../src/domain/music/recommendation.ts";
import { buildArtistEntities, buildReleaseEntities, buildRecordingEntities } from "../src/domain/music/entities.ts";
import { parseConcertChapters } from "../src/domain/music/concertChapters.ts";

assert.equal(identity.normalizeMusicTitle("黃昏"), identity.normalizeMusicTitle("黄昏"));
assert.equal(identity.artistNamesMatch("周传雄", "Steve Chou"), true);
assert.equal(identity.artistNamesMatch("周传雄", "小阿七"), false);
assert.equal(identity.artistNamesMatch("陈升", "Bobby Chen"), true);
assert.equal(identity.artistNamesMatch("周传雄", "周传"), false, "substring-only artist matches must be rejected");
assert.equal(identity.classifyTrackVersion({ title: "黄昏 Live 现场" }), "live");
assert.equal(identity.classifyTrackVersion({ title: "黄昏 DJ Remix" }), "remix");
assert.equal(identity.classifyTrackVersion({ title: "黄昏 Cover" }), "cover");
assert.equal(identity.classifyTrackVersion({ title: "黄昏 Karaoke" }), "karaoke");
assert.equal(identity.classifyTrackVersion({ title: "黄昏 Instrumental" }), "instrumental");
assert.equal(identity.classifyTrackVersion({ title: "黄昏 Studio Version" }), "studio");

const korean = classifyRegionAndLanguage({ genre: "K-pop" });
assert.equal(korean.region, "KR");
assert.equal(korean.language, "ko");
const cantonese = classifyRegionAndLanguage({ tags: ["Cantopop"] });
assert.equal(cantonese.region, "HK");
assert.equal(cantonese.language, "yue");
const enriched = enrichTrackMetadata({ id: "meta", title: "Test", genre: "J-pop", kind: "remote-audio", provider: "audius", addedAt: 1 });
assert.equal(enriched.region, "JP");
assert.equal(enriched.language, "ja");
assert.equal(classifyOriginality({ earliestReleaseOnly: true }).status, "unconfirmed", "earliest catalog date is not proof of original singer");
assert.equal(classifyOriginality({ versionKind: "cover" }).status, "alternate-version");

const catalog = { id: "catalog:1", title: "黄昏", artist: "周传雄", duration: 340, storefront: "TW" };
const base = { kind: "remote-audio", remoteUrl: "https://audio.example/a.mp3", duration: 340, addedAt: 1, title: "黄昏" };
const wrongSinger = { ...base, id: "wrong", artist: "小阿七", provider: "audius" };
const rightSinger = { ...base, id: "right", artist: "Steve Chou", provider: "audius", versionKind: "studio", album: "黄昏" };
const noArtist = { ...base, id: "unknown", title: "黄昏", provider: "audius" };
assert.equal(identity.matchCatalogCandidate(catalog, [wrongSinger, noArtist, rightSinger])?.id, "right");
assert.equal(identity.matchCatalogCandidate(catalog, [wrongSinger, noArtist]), undefined);
const otherVersion = { ...rightSinger, id: "live", title: "黄昏 Live", versionKind: "live" };
assert.equal(identity.sameTrackIdentity(rightSinger, otherVersion), false);
assert.equal(identity.sameTrackIdentity({ ...rightSinger, recordingId: "recording-a" }, { ...rightSinger, recordingId: "recording-b" }), false, "different trusted recording IDs must never fall back to one another");
assert.equal(identity.recordingIdentityKey(rightSinger), identity.recordingIdentityKey({ ...rightSinger, id: "other-source", provider: "openverse" }));

const sourceA = { ...rightSinger, id: "source-a", provider: "audius", coverUrl: "https://img.example/a.jpg", sourceUrl: "https://audius.co/a" };
const sourceB = { ...rightSinger, id: "source-b", provider: "openverse", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", sourceUrl: "https://openverse.org/b" };
const ranked = rankSourceCandidates(catalog, [wrongSinger, sourceA, sourceB]);
assert.equal(ranked.length, 2, "wrong artist must be excluded from source ranking");
const healthyScore = ranked.find((item) => item.track.id === "source-a").score;
const degraded = rankSourceCandidates(catalog, [sourceA], new Map([["source-a", { failureCount: 3, retryAt: Date.now() + 60000 }]]))[0];
assert.ok(degraded.score < healthyScore, "known degraded sources should be ranked lower");

const tracks = [
  { ...rightSinger, id: "artist-1", album: "黄昏", artist: "周传雄", provider: "audius" },
  { ...rightSinger, id: "artist-2", album: "黄昏", artist: "Steve Chou", provider: "openverse" },
  { ...rightSinger, id: "artist-3", title: "另一首歌", album: "另一张专辑", artist: "陈升", provider: "audius" },
];
assert.equal(buildArtistEntities(tracks).find((item) => item.name === "周传雄").trackCount, 2, "curated artist aliases should share one entity");
assert.equal(buildReleaseEntities(tracks).length, 2);
assert.equal(buildRecordingEntities(tracks).length, 2);
const recommendations = rankRecommendations(tracks, [], [], [], { preferredRegions: ["TW"], maxPerArtist: 3 });
assert.ok(recommendations.length >= 1);

const chapters = parseConcertChapters("00:00 开场\n03:24 - 第一首歌\n07:18 第二首歌\n1:02:15 Encore\n[03:24] 重复时间戳");
assert.deepEqual(chapters.map((item) => item.startSeconds), [0, 204, 438, 3735]);
assert.equal(chapters[1].title, "第一首歌");

console.log("Music Free V4.1 domain, identity, metadata, source ranking, entities and concert chapters regression passed.");
