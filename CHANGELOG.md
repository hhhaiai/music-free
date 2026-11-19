# V4.1.1 — Search Accuracy & In-Page Playback (2026-11-12)

- Domain: added `searchIntent.ts` for user input interpretation and curated artist/title aliases, including Vitas, Chen Chusheng, Steve Chou, Lu Hu.
- Domain: added `verifiedCatalog.ts` with references to four official music videos (reference metadata only; not downloadable audio).
- Application: added `catalogSearch.ts` for strict singer/title filtering and verified-first ranking; added `startBufferedPlayback.ts` to request play before waiting for buffer.
- Infrastructure: narrowed Apple catalog calls and added responsive offline reference fallback; disallowed mismatched versions as automatic audio substitutes.
- Presentation: verified catalog metadata appears immediately; stale search requests are cancelled; official videos open inline if independent audio is unavailable; failed playback clears old audio state.
- Local Core: shortened initial scheduler poll for cold start, preserving disk cache and provider separation.
- Tests: added four user-specified song/artist regressions, Apple mock, strict wrong-singer rejection, offline match failure, playback order and buffer readiness tests.
- Limitation: external commercial original audio and live embedded-video availability are **not verified** by offline tests. npm registry access was unavailable in the build environment; full Vite build and real browser playback require macOS acceptance.

---

# Changelog

## V3.5.0 — Search Repair & Catalog Discovery
- 新增 Apple/iTunes 公开歌曲目录搜索，无需 API Key。
- 搜索拆分歌曲元数据与完整独立音频，避免把目录结果误认为可播放。
- 增加地区商店回退查询：SG/CN/TW、JP/SG、KR/SG、SG/US/MY。
- 新增「匹配完整音源」操作，按歌曲名继续搜索开放音源。
- 不使用 Apple 30 秒 previewUrl。
- 修复 Audius 对缺失 streamability 字段和未知时长的过度过滤。
- 完整歌曲筛选改为仅过滤已知短片段，未知时长保留待确认。

## V3.4.0 — Vocal & Regional Discovery
- Audius 公开音乐搜索、趋势与独立音频流。
- 人声优先、地区分类和完整歌曲筛选。


## 3.6.1
- Fixed the missing `test:search` npm script from the V3.6 handoff.
- Added `scripts/search-regression.mjs` as a static search integration regression check.
- Added `npm test` alias.
- Updated `npm run verify` to include the search regression check.
- Synchronized package version and README instructions.


## 3.6.2
- Fixed CJK catalog search short-circuiting after the first storefront.
- Added Taiwan/Mainland China/Hong Kong/Singapore/Malaysia regional aggregation and canonical artist ranking for the user's example tracks.
- Added visible one-click playback action to catalog results.
- Audio matching now searches title+artist first and requires exact title/artist matching before auto-play.
- No Apple preview clips or unrelated same-title tracks are used as full-track playback.


## 3.6.3
- Corrected Unicode property escaping in artist/title normalization; Chinese characters are preserved during matching.
- Added canonical original-performer ranking for known tracks, including Zhou Chuanxiong on "黄昏" and Chen Sheng on "北京一夜".
- Searches canonical artist+title across Taiwan, Hong Kong and Mainland China storefronts.
- Added simplified/traditional title and artist aliases.
- Down-ranks live, cover, karaoke, instrumental, DJ, remix and demo versions.
- Uses earliest known release date only as a weak fallback and labels it as unconfirmed, not as proof of the original singer.
- Added visible originality badges to catalog results.


## 3.6.4
- Changed catalog "One-click Play" into an in-place action: no tab switch, no query rewrite, and no replacement of current search results.
- Preserves the catalog list while matching an independent audio source.
- Starts the persistent bottom audio player directly after a valid title+artist match.
- Shows matching/buffering progress on the clicked row.
- The row toggles pause/resume when the corresponding track is the current track.
- Renamed the external catalog link to "资料" to distinguish it from playback.


## 3.6.5
- Fixed the catalog one-click flow so the previously playing track is paused and cleared before a new catalog item is resolved.
- Search result candidates are filtered to exact title+artist matches for the selected catalog item.
- Removed unrelated broad-search results from the catalog one-click flow, preventing the user from having to pick a different song manually.
- A valid match starts the bottom player automatically; a missing match shows a clear message and never substitutes another song.
- Clears the persisted previous playback snapshot when a catalog direct-play request starts.


## 3.7.0
- Refactored catalog identity and version classification into domain modules.
- Added strict catalog-to-audio resolver and removed unsafe same-title/unknown-artist fallback matching.
- Added a capability-based audio Provider registry and a separate video Provider contract for future platform adapters.
- Added a loopback-only Node.js local core with a six-hour Audius trending metadata scheduler and atomic local JSON persistence.
- Added local core health/discovery endpoints and settings diagnostics.
- Added domain and local-core regression checks.
- Preserved the existing IndexedDB stores and user music data.


## 3.7.1 — Durable Local Cache & Multi-Provider Discovery
- Added SQLite WAL disk storage under `~/.music-free/music-free.sqlite`, independent of browser IndexedDB/cache.
- Added persistent metadata cache, discovery snapshots, task state and provider health.
- Added non-destructive migration from V3.7.0 `discovery-cache.json`.
- Replaced the single interval task with persisted per-provider schedules, concurrency limits, request timeouts, bounded retries and exponential backoff.
- Added scheduled Audius trending and regional searches, Openverse licensed audio discovery, and Internet Archive CC/Public Domain discovery.
- Added `/api/local/tasks` and `/api/local/cache/stats` diagnostics plus expired metadata pruning.
- Settings now reports local disk database size and WAL size.
- Remote audio/video bytes are still not persisted; local disk cache is metadata/task state only.


## 3.8.0 — Multi-Platform Discovery
- Added a dedicated VideoSearchPanel isolated from independent audio playback.
- Added the VideoPlatformProvider contract and registered YouTube and Bilibili adapters.
- Added optional YouTube Data API search through the local Node service; the API key is loaded from a local `.env` file and never exposed to the browser.
- Added keyless YouTube official search URL and oEmbed link resolution.
- Added YouTube official privacy-enhanced iframe playback and 2-minute/embeddability filtering for API search.
- Added optional YouTube Music category trending task every 12 hours when a local API key is configured.
- Added Bilibili official search-page fallback, BV link validation and official external-player embed.
- Added SQLite caching for YouTube search results and a persisted trending snapshot.
- Kept video platform content out of the independent audio playback resolver; no YouTube/Bilibili media extraction or downloads.


## 3.9.0 — Local Media Engine & Playback Reliability
- Added a serialized FFmpeg.wasm job engine with track probing, selectable audio/video stream indices, local audio extraction and video-only stream copy.
- Added a local media workbench with audio/video preview, progress, cancellation, 250 MB safety cap and memory-only output.
- Kept all selected media inside the browser; no media upload endpoint or persistent remote media cache was added.
- Added a unified HTMLMediaElement PlaybackController and routed core play/pause/seek/volume operations through it.
- Added client-side source health tracking with exponential cooldown and persistent local source-health reports in SQLite/JSON fallback.
- Added local media capability diagnostics, including optional native ffmpeg/ffprobe detection.
- Preserved the V3.8 video-provider boundary: YouTube/Bilibili remain official embedded playback only.

## 4.0.0 — Domain & Application Foundations
- Introduced source-agnostic music identity and metadata classification (artist aliases, version, region, language, originality confidence).
- Introduced artist/release/recording entity aggregation, source-candidate ranking, recommendation rules, concert chapter parsing.
- Added the MusicProviderPort interface and injectable discovery/recording-resolution use cases.

## 4.0.1 — Layer Integration & Compatibility
- Migrated presentation and infrastructure modules into explicit layer directories.
- Added the Composition Root to instantiate providers outside UI components.
- Kept compatibility re-exports for legacy callers and browser music storage.
- Integrated concert chapters, region preferences and identity-based source resolution into the UI.

## 4.1.0 — Immersive UI & Traceable Releases
- Added album-card, synchronized lyrics stage and animated visual scene to a dedicated immersive player component.
- Preserved official video embeds and isolated local FFmpeg processing paths.
- Added architecture/installation/release-test documentation and real bundled Git version history.
- Dynamic visual bars are an animation; true audio FFT analysis is not claimed as implemented.
