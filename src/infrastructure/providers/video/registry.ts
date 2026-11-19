import type { VideoPlatformId, VideoPlatformProvider } from "./types";
import { youtubeProvider } from "./youtube";
import { bilibiliProvider } from "./bilibili";

const providers = new Map<VideoPlatformId, VideoPlatformProvider>();

export function registerVideoProvider(provider: VideoPlatformProvider): void {
  if (providers.has(provider.id)) throw new Error(`Video provider already registered: ${provider.id}`);
  providers.set(provider.id, provider);
}

registerVideoProvider(youtubeProvider);
registerVideoProvider(bilibiliProvider);

export function getVideoProvider(id: VideoPlatformId): VideoPlatformProvider | undefined {
  return providers.get(id);
}

export function listVideoProviders(): VideoPlatformProvider[] {
  return [...providers.values()];
}
