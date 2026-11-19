export type MediaStreamInfo = {
  index: number;
  type: "audio" | "video";
  codec: string;
  description: string;
};
export type MediaProbe = {
  durationSeconds: number | null;
  streams: MediaStreamInfo[];
  hasAudio: boolean;
  hasVideo: boolean;
};

function parseDuration(logs: string[]): number | null {
  const line = logs.find((entry) => /Duration:\s*\d{2}:\d{2}:\d{2}/i.test(entry));
  const match = line?.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/i);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || 0}`);
}

export function parseMediaProbeLogs(logs: string[]): MediaProbe {
  const streams: MediaStreamInfo[] = [];
  for (const line of logs) {
    const match = line.match(/Stream #0:(\d+)(?:\[[^\]]+\])?(?:\([^)]*\))?:\s*(Video|Audio):\s*([^,\s]+)/i);
    if (!match) continue;
    const index = Number(match[1]);
    const type = match[2].toLowerCase() as "video" | "audio";
    if (!streams.some((stream) => stream.index === index)) {
      streams.push({ index, type, codec: match[3], description: line.trim().slice(0, 240) });
    }
  }
  return {
    durationSeconds: parseDuration(logs),
    streams,
    hasAudio: streams.some((stream) => stream.type === "audio"),
    hasVideo: streams.some((stream) => stream.type === "video"),
  };
}

export function outputVideoFormat(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (["mp4", "mov", "m4v"].includes(ext)) return { ext: "mp4", mime: "video/mp4" };
  if (ext === "webm") return { ext: "webm", mime: "video/webm" };
  return { ext: "mkv", mime: "video/x-matroska" };
}
