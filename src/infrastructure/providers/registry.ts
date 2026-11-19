import type { MusicProviderPort } from "../../application/ports/musicProvider";
import { searchAudius, getAudiusTrending } from "./audius";
import { searchOpenverse } from "./openverse";
import { searchInternetArchive } from "./internetArchive";

export type MusicProviderId = "audius" | "openverse" | "internet-archive";
export type MusicProviderCapabilities = MusicProviderPort["capabilities"];
export type MusicProviderAdapter = MusicProviderPort & { id: MusicProviderId };

const providers = new Map<MusicProviderId, MusicProviderAdapter>();

export function registerMusicProvider(provider: MusicProviderAdapter): void {
  if (providers.has(provider.id)) throw new Error(`Music provider already registered: ${provider.id}`);
  providers.set(provider.id, provider);
}

registerMusicProvider({
  id: "audius", name: "Audius", requiresApiKey: false,
  capabilities: { search: true, trending: true, independentAudio: true, licenseMetadata: false, videoSearch: false, officialEmbed: false },
  search: searchAudius, trending: getAudiusTrending,
});
registerMusicProvider({
  id: "openverse", name: "Openverse", requiresApiKey: false,
  capabilities: { search: true, trending: false, independentAudio: true, licenseMetadata: true, videoSearch: false, officialEmbed: false },
  search: searchOpenverse,
});
registerMusicProvider({
  id: "internet-archive", name: "Internet Archive", requiresApiKey: false,
  capabilities: { search: true, trending: false, independentAudio: true, licenseMetadata: true, videoSearch: false, officialEmbed: false },
  search: searchInternetArchive,
});

export function getMusicProvider(id: MusicProviderId): MusicProviderAdapter | undefined {
  return providers.get(id);
}

export function listMusicProviders(): MusicProviderAdapter[] {
  return [...providers.values()];
}
