import { fetchJsonWithRetry } from "./http.mjs";

const LICENSES = "cc0,pdm,by,by-sa,by-nc,by-nc-sa,by-nd,by-nc-nd";
const ALLOWED = /^(cc0|pdm|by|by-sa|by-nc|by-nc-sa|by-nd|by-nc-nd)$/i;
const clean = (v) => typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";

export async function fetchOpenverseAudio(query, { limit = 12, timeoutMs = 12_000, signal } = {}) {
  const url = new URL("https://api.openverse.org/v1/audio/");
  url.searchParams.set("q", query);
  url.searchParams.set("page_size", String(Math.min(Math.max(limit, 1), 20)));
  url.searchParams.set("license", LICENSES);
  url.searchParams.set("filter_dead", "true");
  const payload = await fetchJsonWithRetry(url, { timeoutMs, retries: 1, signal });
  return (payload.results || []).flatMap((item) => {
    const remoteUrl = clean(item.url);
    const license = clean(item.license).toLowerCase();
    const licenseUrl = clean(item.license_url);
    if (!remoteUrl.startsWith("https://") || !ALLOWED.test(license) || !licenseUrl.startsWith("https://")) return [];
    const title = clean(item.title) || "未命名音频";
    const artist = clean(item.creator) || "未知创作者";
    return [{
      id: `openverse:${item.id || encodeURIComponent(`${title}:${artist}`)}`,
      title, artist, kind: "remote-audio", provider: "openverse", remoteUrl,
      sourceUrl: clean(item.foreign_landing_url) || remoteUrl,
      coverUrl: clean(item.thumbnail) || undefined,
      duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : undefined,
      license: `CC ${license.toUpperCase()}${item.license_version ? ` ${item.license_version}` : ""}`,
      licenseUrl, attribution: artist, addedAt: Date.now(),
    }];
  });
}
