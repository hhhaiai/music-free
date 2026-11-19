import type { TrackRecord } from "../../domain/music/types.ts";

export type MusicProviderCapabilities = {
  search: boolean;
  trending: boolean;
  independentAudio: boolean;
  licenseMetadata: boolean;
  videoSearch: boolean;
  officialEmbed: boolean;
};

/** Infrastructure adapters implement this port; application use-cases depend only on this contract. */
export type MusicProviderPort = {
  id: string;
  name: string;
  requiresApiKey: boolean;
  capabilities: MusicProviderCapabilities;
  search(query: string, limit?: number, signal?: AbortSignal): Promise<TrackRecord[]>;
  trending?(limit?: number, signal?: AbortSignal): Promise<TrackRecord[]>;
};

export type MusicSearchResult = { tracks: TrackRecord[]; warnings: string[] };
