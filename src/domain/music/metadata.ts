import type { MetadataConfidence, MusicLanguage, MusicRegion, OriginalityStatus, TrackRecord, TrackVersionKind } from "./types.ts";

export type VersionClassification = {
  kind: TrackVersionKind;
  confidence: MetadataConfidence;
  evidence: string[];
};

const VERSION_RULES: Array<{ kind: TrackVersionKind; pattern: RegExp; label: string }> = [
  { kind: "karaoke", pattern: /\b(karaoke|minus one|伴奏版|卡拉ok|卡拉ＯＫ)\b|伴奏|卡拉[ＯO0]?K/i, label: "卡拉 OK / 伴奏标记" },
  { kind: "instrumental", pattern: /\b(instrumental|no vocal|backing track|piano solo)\b|纯音乐|純音樂|纯享|純享|纯伴奏|純伴奏/i, label: "纯音乐 / 无人声标记" },
  { kind: "live", pattern: /\b(live|concert|unplugged|on stage|live at)\b|现场|現場|演唱会|演唱會|音乐会|音樂會/i, label: "现场 / 演唱会标记" },
  { kind: "cover", pattern: /\b(cover|covered by|tribute|re-recorded by)\b|翻唱|翻唱版|致敬版|改编演唱/i, label: "翻唱 / 致敬标记" },
  { kind: "remix", pattern: /\b(remix|dj mix|mashup|sped up|slowed|nightcore|bootleg)\b|混音|串烧|串燒|加速版|慢速版|DJ版|电音版|電音版/i, label: "Remix / 混音标记" },
  { kind: "studio", pattern: /\b(studio version|studio recording|original soundtrack|album version)\b|录音室版|錄音室版|专辑版|專輯版/i, label: "录音室 / 专辑版本标记" },
];

export function classifyTrackVersion(track: Pick<TrackRecord, "title" | "album" | "versionKind" | "tags">): VersionClassification {
  if (track.versionKind && track.versionKind !== "unknown") {
    return { kind: track.versionKind, confidence: "high", evidence: ["已保存的版本标签"] };
  }
  const text = [track.title, track.album, ...(track.tags || [])].filter(Boolean).join(" ");
  for (const rule of VERSION_RULES) {
    if (rule.pattern.test(text)) return { kind: rule.kind, confidence: "medium", evidence: [rule.label] };
  }
  return { kind: "unknown", confidence: "low", evidence: [] };
}

const REGION_RULES: Array<{ region: MusicRegion; pattern: RegExp; language: MusicLanguage; evidence: string }> = [
  { region: "HK", pattern: /cantopop|cantonese|hong kong|香港|粤语|粵語/i, language: "yue", evidence: "粤语 / Cantopop 标签" },
  { region: "TW", pattern: /taiwan|taiwanese|台湾|臺灣|台湾流行|台灣流行/i, language: "zh", evidence: "台湾地区标签" },
  { region: "SG", pattern: /singapore|新加坡|sg pop/i, language: "zh", evidence: "新加坡地区标签" },
  { region: "MY", pattern: /malaysia|malaysian|马来西亚|馬來西亞|新马|新馬/i, language: "zh", evidence: "马来西亚 / 新马标签" },
  { region: "TH", pattern: /thai pop|t-pop|thailand|泰国|泰國/i, language: "th", evidence: "泰语 / 泰国流行标签" },
  { region: "ID", pattern: /indonesian|indo pop|indonesia|印尼/i, language: "id", evidence: "印尼流行标签" },
  { region: "VN", pattern: /v-pop|vietnamese|vietnam|越南/i, language: "vi", evidence: "越南流行标签" },
  { region: "PH", pattern: /filipino|opm|philippines|菲律宾|菲律賓/i, language: "tl", evidence: "菲律宾 / OPM 标签" },
  { region: "JP", pattern: /j-pop|jpop|japanese|japan|日本流行|日语|日語/i, language: "ja", evidence: "日语 / J-pop 标签" },
  { region: "KR", pattern: /k-pop|kpop|korean|korea|韩国流行|韓國流行|韩语|韓語/i, language: "ko", evidence: "韩语 / K-pop 标签" },
  { region: "CN", pattern: /mandopop|mandarin pop|chinese pop|华语|華語|国语流行|國語流行|中国流行|中國流行/i, language: "zh", evidence: "华语 / Mandopop 标签" },
  { region: "US", pattern: /american pop|united states|usa|us pop/i, language: "en", evidence: "美国地区标签" },
  { region: "EU", pattern: /britpop|uk pop|european|united kingdom|british pop/i, language: "en", evidence: "欧美 / 英语流行标签" },
];

export type RegionLanguageClassification = {
  region: MusicRegion;
  language: MusicLanguage;
  regionConfidence: MetadataConfidence;
  languageConfidence: MetadataConfidence;
  evidence: string[];
};

export function classifyRegionAndLanguage(track: Pick<TrackRecord, "genre" | "tags" | "title" | "artist" | "vocalType" | "region" | "language">): RegionLanguageClassification {
  if (track.region && track.region !== "UNKNOWN") {
    return {
      region: track.region,
      language: track.language || "unknown",
      regionConfidence: "high",
      languageConfidence: track.language ? "high" : "low",
      evidence: ["来源已提供地区信息"],
    };
  }
  const haystack = [track.genre, ...(track.tags || [])].filter(Boolean).join(" ");
  for (const rule of REGION_RULES) {
    if (rule.pattern.test(haystack)) {
      return {
        region: rule.region,
        language: track.language || rule.language,
        regionConfidence: "medium",
        languageConfidence: track.language ? "high" : "medium",
        evidence: [rule.evidence],
      };
    }
  }
  if (track.vocalType === "instrumental") {
    return { region: "UNKNOWN", language: "instrumental", regionConfidence: "low", languageConfidence: "high", evidence: ["已识别为纯音乐"] };
  }
  return { region: "UNKNOWN", language: track.language || "unknown", regionConfidence: "low", languageConfidence: "low", evidence: [] };
}

export function classifyVocalType(track: Pick<TrackRecord, "title" | "album" | "genre" | "tags" | "vocalType">): TrackRecord["vocalType"] {
  if (track.vocalType && track.vocalType !== "unknown") return track.vocalType;
  const text = [track.title, track.album, track.genre, ...(track.tags || [])].filter(Boolean).join(" ");
  if (/\b(instrumental|karaoke|no vocal|backing track|piano solo)\b|纯音乐|純音樂|伴奏|卡拉ok/i.test(text)) return "instrumental";
  if (/\b(vocal|singer|feat\.?|ft\.?)\b|演唱|人声|人聲/i.test(text)) return "vocal";
  return "unknown";
}

export function classifyOriginality(input: {
  curatedOriginal?: boolean;
  trustedOriginalCredit?: boolean;
  versionKind?: TrackVersionKind;
  earliestReleaseOnly?: boolean;
}): { status: OriginalityStatus; confidence: number; evidence: string[] } {
  if (input.curatedOriginal) return { status: "known-original", confidence: 0.98, evidence: ["人工维护的原唱资料库匹配"] };
  if (["live", "cover", "remix", "karaoke", "instrumental"].includes(input.versionKind || "unknown")) {
    return { status: "alternate-version", confidence: 0.86, evidence: ["标题或目录明确标记为特殊版本"] };
  }
  if (input.trustedOriginalCredit) return { status: "likely-original", confidence: 0.72, evidence: ["可信目录提供了原唱署名线索，仍需人工核验"] };
  if (input.earliestReleaseOnly) return { status: "unconfirmed", confidence: 0.35, evidence: ["目录中较早发行不等于原唱证明"] };
  return { status: "unconfirmed", confidence: 0.1, evidence: ["缺少足够的原唱证据"] };
}

export function enrichTrackMetadata(track: TrackRecord): TrackRecord {
  const version = classifyTrackVersion(track);
  const region = classifyRegionAndLanguage(track);
  const vocalType = classifyVocalType(track);
  const originality = track.originalityStatus ? null : classifyOriginality({ versionKind: version.kind });
  return {
    ...track,
    versionKind: track.versionKind && track.versionKind !== "unknown" ? track.versionKind : version.kind,
    versionConfidence: track.versionConfidence || version.confidence,
    versionEvidence: track.versionEvidence || version.evidence,
    vocalType,
    region: track.region && track.region !== "UNKNOWN" ? track.region : region.region,
    language: track.language && track.language !== "unknown" ? track.language : region.language,
    regionConfidence: track.regionConfidence || region.regionConfidence,
    languageConfidence: track.languageConfidence || region.languageConfidence,
    originalityStatus: track.originalityStatus || originality?.status,
    originalityConfidence: track.originalityConfidence ?? originality?.confidence,
    originalityEvidence: track.originalityEvidence || originality?.evidence,
  };
}


export const VERSION_LABELS: Record<TrackVersionKind, string> = {
  studio: "录音室版", live: "Live 现场", cover: "翻唱", remix: "Remix", karaoke: "伴奏", instrumental: "纯音乐", unknown: "版本待确认",
};
export const REGION_LABELS: Record<MusicRegion, string> = {
  CN: "中国 / 华语", HK: "香港 / 粤语", TW: "台湾", SG: "新加坡", MY: "马来西亚", TH: "泰国", ID: "印尼", VN: "越南", PH: "菲律宾", JP: "日本", KR: "韩国", US: "美国", EU: "欧洲", OTHER: "其他地区", UNKNOWN: "地区待识别",
};
export const LANGUAGE_LABELS: Record<MusicLanguage, string> = {
  zh: "中文", yue: "粤语", en: "英语", ja: "日语", ko: "韩语", th: "泰语", ms: "马来语", id: "印尼语", vi: "越南语", tl: "菲律宾语", instrumental: "纯音乐", unknown: "语言待识别",
};
