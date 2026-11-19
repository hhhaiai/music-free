import type { TrackRecord } from "../../domain/music/types";

const ENDPOINT = "https://api.openverse.org/v1/audio/";
const LICENSES = "cc0,pdm,by,by-sa,by-nc,by-nc-sa,by-nd,by-nc-nd";

type OpenverseItem = {
  id?: string;
  title?: string;
  creator?: string;
  creator_url?: string;
  url?: string;
  foreign_landing_url?: string;
  thumbnail?: string;
  duration?: number;
  license?: string;
  license_version?: string;
  license_url?: string;
  filetype?: string;
};

function clean(value?: string) {
  return (value || "").replace(/\s+/g, " ").trim();
}

export async function searchOpenverse(query: string, limit = 18, signal?: AbortSignal): Promise<TrackRecord[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("page_size", String(Math.min(Math.max(limit, 1), 20)));
  url.searchParams.set("license", LICENSES);
  url.searchParams.set("filter_dead", "true");

  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Openverse 请求失败（${response.status}）`);
  const payload = await response.json() as { results?: OpenverseItem[] };

  return (payload.results || []).flatMap((item): TrackRecord[] => {
    const audioUrl = clean(item.url);
    const license = clean(item.license).toLowerCase();
    const licenseUrl = clean(item.license_url);
    if (!audioUrl.startsWith("https://") || !license || !licenseUrl) return [];
    if (!/^(cc0|pdm|by|by-sa|by-nc|by-nc-sa|by-nd|by-nc-nd)$/.test(license)) return [];
    const title = clean(item.title) || "未命名音频";
    const creator = clean(item.creator) || "未知创作者";
    return [{
      id: `openverse:${item.id || encodeURIComponent(`${title}:${creator}`)}`,
      title,
      artist: creator,
      kind: "remote-audio",
      provider: "openverse",
      remoteUrl: audioUrl,
      sourceUrl: clean(item.foreign_landing_url) || audioUrl,
      coverUrl: clean(item.thumbnail) || undefined,
      duration: Number.isFinite(item.duration) ? item.duration : undefined,
      license: `CC ${license.toUpperCase()}${item.license_version ? ` ${item.license_version}` : ""}`,
      licenseUrl,
      attribution: creator,
      addedAt: Date.now(),
    }];
  });
}
