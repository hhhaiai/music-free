export type VideoPlatformId = "youtube" | "bilibili";
export type VideoChapter = { title: string; startSeconds: number };
export type VideoSearchResult = {
  id: string;
  videoId: string;
  platform: VideoPlatformId;
  title: string;
  creator: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  watchUrl: string;
  publishedAt?: string;
  viewCount?: number;
  liveBroadcastContent?: string;
  chapters?: VideoChapter[];
  metadataAvailable?: boolean;
  /** Platform-authorized in-page player descriptor; never a media-file extraction URL. */
  embed: { kind: "official-embed"; url: string; startSeconds?: number };
};
export type VideoSearchOptions = { limit?: number; region?: string; signal?: AbortSignal; order?: "relevance" | "date" | "viewCount" | "rating" };
export interface VideoPlatformProvider {
  id: VideoPlatformId;
  name: string;
  searchMode: "api" | "external";
  requiresCredential: boolean;
  search?(query: string, options?: VideoSearchOptions): Promise<VideoSearchResult[]>;
  resolveUrl(input: string, options?: VideoSearchOptions): Promise<VideoSearchResult | null>;
  buildSearchUrl(query: string): string;
  buildEmbed(video: VideoSearchResult, startSeconds?: number): string;
}
