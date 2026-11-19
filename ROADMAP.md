# Music Free Roadmap: V3.8.0 → V4.1

## V3.8.0 — Multi-Platform Discovery
- Separate audio and video provider contracts.
- Optional YouTube Data API search with local-only API key.
- Keyless YouTube official search page + oEmbed link resolution.
- YouTube official privacy-enhanced iframe playback.
- Optional 12-hour YouTube Music category trending metadata task.
- Bilibili official search page + BV link recognition + official player iframe.
- Provider capability and configuration status endpoints.
- No media-file extraction or download from YouTube/Bilibili.

## V3.9 — Local Media Pipeline
- Native local service media-job interface.
- User-selected local file ingestion and persistent file handles.
- FFmpeg capability detection and reliable local demux for user-owned/authorized media.
- Source health checks, playback recovery and queue state machine.
- Optional local media library storage policy with explicit user opt-in.

## V4.0 — Music Intelligence
- Recording identity model (ISRC/MusicBrainz IDs where available).
- Artist aliases and original/cover/live/remix classification.
- Public metadata enrichment for concert chapters and timestamps.
- Multi-region discovery and personal recommendations.
- Stale-while-revalidate and provider reliability ranking.

## V4.1 — Immersive Experience
- Album-card and full-screen player layouts.
- Audio/Video/Concert/Lyrics modes.
- Synchronized lyrics and floating lyric panel.
- Real Web Audio spectrum where CORS permits.
- Theme and motion settings, reduced-motion support.
- End-to-end macOS release checklist.

## Release gates
1. Existing IndexedDB and SQLite data remain readable.
2. `npm run verify` passes.
3. Local Core only binds to loopback.
4. API keys stay in local server environment and never enter frontend bundles.
5. Audio results and video results remain different data types.
6. Platform restrictions are respected; no DRM bypass or unsupported stream extraction.
7. Provider failures do not clear last-known-good snapshots.


## V3.9.0 — Local Media Engine & Playback Reliability
- FFmpeg.wasm track probe and selectable stream extraction for explicitly selected local files.
- Memory-only audio/video preview with cancellation and size cap.
- Unified playback controller for HTMLMediaElement operations.
- Persistent per-source playback health and exponential cooldown.
- Local media capability diagnostics.

## V4.1 delivered / further work
- V4.0: layered domain metadata and search/playback identity use-cases.
- V4.0.1: composition root and adapter/presentation boundary.
- V4.1: immersive album-card, lyrics and animated visual scenes, concert chapter UI.
- Future: true Web Audio analyser with CORS-aware fallback; smaller React page modules; native macOS desktop always-on-top lyrics; end-to-end browser tests; optional authorized commercial catalog sources.
