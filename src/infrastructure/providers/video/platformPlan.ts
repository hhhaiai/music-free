import type { VideoPlatformId } from "./types";

export type VideoPlatformPlan = {
  id: VideoPlatformId;
  discovery: string;
  playback: "official-embed";
  credential: "optional-local-api-key" | "no-key-official-search";
  status: "implemented" | "limited-official-search";
};

export const VIDEO_PLATFORM_PLAN: VideoPlatformPlan[] = [
  { id: "youtube", discovery: "YouTube Data API search (optional local key) + official search URL + oEmbed link resolution", playback: "official-embed", credential: "optional-local-api-key", status: "implemented" },
  { id: "bilibili", discovery: "Official Bilibili search page + BV link recognition; no undocumented search API", playback: "official-embed", credential: "no-key-official-search", status: "limited-official-search" },
];
