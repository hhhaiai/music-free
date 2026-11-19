import { fetchJsonWithRetry } from "./http.mjs";

const AUDIO_EXTENSIONS = new Set(["mp3", "ogg", "oga", "flac", "wav", "m4a", "aac", "opus"]);
const text = (v) => Array.isArray(v) ? v.map(String).join(", ") : typeof v === "string" ? v.trim() : "";
const allowedLicense = (v) => /creativecommons\.org\/licenses\/|creativecommons\.org\/publicdomain\/|publicdomain/i.test(v);
const extension = (v) => String(v || "").split(".").pop()?.toLowerCase() || "";

async function resolveItem(doc, signal) {
  if (!doc.identifier) return null;
  const metaUrl = `https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`;
  const metadata = await fetchJsonWithRetry(metaUrl, { signal, timeoutMs: 10_000, retries: 1 });
  const meta = metadata.metadata || {};
  const licenseUrl = text(meta.licenseurl) || text(doc.licenseurl);
  if (!allowedLicense(licenseUrl)) return null;
  const file = (metadata.files || []).find((f) => f.name && AUDIO_EXTENSIONS.has(extension(f.name)) && f.private !== "true");
  if (!file?.name) return null;
  const title = text(meta.title) || text(doc.title) || doc.identifier;
  const artist = text(meta.creator) || text(doc.creator) || "Internet Archive";
  const length = Number(file.length);
  const remoteUrl = `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(file.name)}`;
  return {
    id: `archive:${doc.identifier}:${file.name}`, title, artist, kind: "remote-audio", provider: "internet-archive",
    remoteUrl, sourceUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
    coverUrl: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
    duration: Number.isFinite(length) && length > 0 ? length : undefined,
    license: /publicdomain/i.test(licenseUrl) ? "Public Domain" : "Creative Commons（请查看具体条款）",
    licenseUrl, attribution: artist, addedAt: Date.now(),
  };
}

export async function fetchInternetArchiveAudio(query, { limit = 8, timeoutMs = 12_000, signal } = {}) {
  const safe = String(query || "").replace(/["\\]/g, " ").trim();
  if (!safe) return [];
  const url = new URL("https://archive.org/advancedsearch.php");
  url.searchParams.set("q", `mediatype:audio AND (title:"${safe}" OR creator:"${safe}")`);
  for (const field of ["identifier", "title", "creator", "date", "licenseurl"]) url.searchParams.append("fl[]", field);
  url.searchParams.set("rows", String(Math.min(Math.max(limit, 1), 10)));
  url.searchParams.set("page", "1");
  url.searchParams.set("output", "json");
  const payload = await fetchJsonWithRetry(url, { signal, timeoutMs, retries: 1 });
  const docs = payload.response?.docs || [];
  const settled = await Promise.allSettled(docs.map((doc) => resolveItem(doc, signal)));
  return settled.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
}
