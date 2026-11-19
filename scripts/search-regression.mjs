import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const app = read("src/presentation/App.tsx");
const catalog = read("src/infrastructure/providers/appleCatalog.ts");
const discovery = read("src/application/use-cases/musicDiscovery.ts");
const registry = read("src/infrastructure/providers/registry.ts");
const identity = read("src/domain/music/identity.ts");
const resolver = read("src/application/use-cases/resolveCatalogAudio.ts");
const sourceRanking = read("src/domain/music/sourceRanking.ts");

assert.match(app, /searchAppleCatalog\(term, controller.signal\)/, "Search page must query the public song catalog.");
assert.match(app, /setCatalogResults\(catalogResult\.tracks\)/, "Catalog metadata must remain separate from playable audio.");
assert.match(app, /resolveCatalogAudio\(track, tracks, searchMusic, controller.signal, healthById\)/, "Catalog audio resolution must use the application use-case and source-health context.");
assert.match(app, /sameTrackIdentity\(track, item\)/, "Playback fallback must use strict identity matching.");
assert.doesNotMatch(app, /!track\.artist \|\| !item\.artist/, "Unknown artist metadata must not be accepted as a fallback match.");
assert.match(app, /localCore\.health/, "Settings should expose local-core diagnostics.");
assert.match(app, /Music Free V4\.1\.1/, "Footer version should be updated.");

assert.match(catalog, /itunes\.apple\.com\/search/, "Apple public catalog endpoint is missing.");
assert.match(catalog, /CANONICAL_RECORDINGS/, "Known original recording hints must remain available.");
assert.match(catalog, /周传雄/, "Zhou Chuanxiong original hint must remain available.");
assert.match(catalog, /陈升/, "Chen Sheng original hint must remain available.");

assert.match(discovery, /MusicProviderPort/, "Discovery must depend on the application provider port.");
assert.match(discovery, /createMusicDiscoveryUseCases/, "Discovery use-cases must be injectable for provider adaptation.");
assert.match(registry, /registerMusicProvider/, "Audio provider registration API is missing.");
for (const id of ["audius", "openverse", "internet-archive"]) assert.match(registry, new RegExp(`id: "${id}"`), `${id} must be registered`);

assert.match(identity, /artistNamesMatch/, "Strict artist identity matching must be centralized.");
assert.match(identity, /sameTrackIdentity/, "Recording identity comparison must be centralized.");
assert.match(identity, /classifyTrackVersion/, "Track version classification must be centralized.");
assert.match(resolver, /matchesCatalogIdentity/, "Resolver must reject same-title wrong-artist tracks.");
assert.match(sourceRanking, /candidate\.kind !== "remote-audio"/, "Only independent audio sources may be returned by the audio resolver.");
assert.match(resolver, /rankSourceCandidates/, "Catalog resolver must use explainable multi-source ranking.");

assert.match(read("src/infrastructure/providers/video/registry.ts"), /registerVideoProvider/, "Video Provider contract must be present.");
assert.match(read("src/infrastructure/providers/video/platformPlan.ts"), /youtube/);
assert.match(read("src/infrastructure/providers/video/platformPlan.ts"), /bilibili/);
assert.match(read("src/infrastructure/providers/video/registry.ts"), /youtubeProvider/);
assert.match(read("src/infrastructure/providers/video/registry.ts"), /bilibiliProvider/);
assert.match(read("src/infrastructure/providers/video/platformPlan.ts"), /implemented/);
assert.match(read("src/presentation/components/VideoSearchPanel.tsx"), /官方搜索/);
assert.match(read("src/presentation/components/VideoSearchPanel.tsx"), /ConcertSetlistPanel/);
assert.match(read("src/domain/music/sourceRanking.ts"), /rankSourceCandidates/);

console.log("Music Free V4.1.1 search/provider architecture regression passed.");
