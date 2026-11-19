import { createMusicDiscoveryUseCases } from "../application/use-cases/musicDiscovery";
import { listMusicProviders } from "../infrastructure/providers/registry";
import { searchAppleCatalog } from "../infrastructure/providers/appleCatalog";
import { findLyrics, parseLrc } from "../infrastructure/providers/lyrics";

/**
 * Composition Root: all concrete provider adapters are assembled here.
 * UI components consume these application-facing functions instead of
 * instantiating or importing individual adapters themselves.
 */
export const musicApplication = createMusicDiscoveryUseCases(listMusicProviders());
export const { searchMusic, discoverMusic } = musicApplication;
export { searchAppleCatalog, findLyrics, parseLrc };
