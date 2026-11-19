import type { TrackRecord } from "../../domain/music/types";

const SEARCH_ENDPOINT = "https://archive.org/advancedsearch.php";
const AUDIO_EXTENSIONS = new Set(["mp3", "ogg", "oga", "flac", "wav", "m4a", "aac", "opus"]);

type SearchDoc = { identifier?: string; title?: string; creator?: string; date?: string; licenseurl?: string };
type MetadataFile = { name?: string; format?: string; size?: string; length?: string; private?: string };
type MetadataResponse = {
  metadata?: { identifier?: string; title?: string; creator?: string | string[]; date?: string; licenseurl?: string; rights?: string };
  files?: MetadataFile[];
};

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  return typeof value === "string" ? value.trim() : "";
}

function licenseAllowed(value: string): boolean {
  const v = value.toLowerCase();
  return v.includes("creativecommons.org/licenses/") ||
    v.includes("creativecommons.org/publicdomain/") ||
    v.includes("publicdomain");
}

function extension(name: string) {
  return name.split(".").pop()?.toLowerCase() || "";
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Internet Archive 请求失败（${response.status}）`);
  return response.json() as Promise<T>;
}

async function resolveItem(doc: SearchDoc, signal?: AbortSignal): Promise<TrackRecord | null> {
  if (!doc.identifier) return null;
  const identifier = doc.identifier;
  const metadata = await fetchJson<MetadataResponse>(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, signal);
  const meta = metadata.metadata || {};
  const licenseUrl = text(meta.licenseurl) || text(doc.licenseurl);
  if (!licenseAllowed(licenseUrl)) return null;

  const file = (metadata.files || []).find((candidate) => {
    const name = text(candidate.name);
    return name && AUDIO_EXTENSIONS.has(extension(name)) && candidate.private !== "true";
  });
  if (!file?.name) return null;

  const creator = text(meta.creator) || text(doc.creator) || "Internet Archive";
  const title = text(meta.title) || text(doc.title) || identifier;
  const fileUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name)}`;
  const length = Number(file.length);
  return {
    id: `archive:${identifier}:${file.name}`,
    title,
    artist: creator,
    kind: "remote-audio",
    provider: "internet-archive",
    remoteUrl: fileUrl,
    sourceUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    coverUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
    duration: Number.isFinite(length) && length > 0 ? length : undefined,
    license: licenseUrl.includes("publicdomain") ? "Public Domain" : "Creative Commons（请查看具体条款）",
    licenseUrl,
    attribution: creator,
    addedAt: Date.now(),
  };
}

export async function searchInternetArchive(query: string, limit = 8, signal?: AbortSignal): Promise<TrackRecord[]> {
  const url = new URL(SEARCH_ENDPOINT);
  const safeQuery = query.replace(/["\\]/g, " ").trim();
  url.searchParams.set("q", `mediatype:audio AND (title:"${safeQuery}" OR creator:"${safeQuery}")`);
  url.searchParams.append("fl[]", "identifier");
  url.searchParams.append("fl[]", "title");
  url.searchParams.append("fl[]", "creator");
  url.searchParams.append("fl[]", "date");
  url.searchParams.append("fl[]", "licenseurl");
  url.searchParams.set("rows", String(Math.min(Math.max(limit, 1), 12)));
  url.searchParams.set("page", "1");
  url.searchParams.set("output", "json");

  const payload = await fetchJson<{ response?: { docs?: SearchDoc[] } }>(url.toString(), signal);
  const docs = payload.response?.docs || [];
  const settled = await Promise.allSettled(docs.map((doc) => resolveItem(doc, signal)));
  return settled.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
}
