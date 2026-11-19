import type { MusicLanguage, MusicRegion } from "./types.ts";

export type RegionOption = { id: MusicRegion; label: string; language: MusicLanguage; queries: string[] };
export const MUSIC_REGIONS: RegionOption[] = [
  { id: "CN", label: "中国 / 华语", language: "zh", queries: ["Mandopop", "Chinese pop", "华语流行"] },
  { id: "HK", label: "香港 / 粤语", language: "yue", queries: ["Cantopop", "Cantonese pop"] },
  { id: "TW", label: "台湾", language: "zh", queries: ["Taiwan Mandopop", "Taiwan pop"] },
  { id: "SG", label: "新加坡", language: "zh", queries: ["Singapore pop", "Singaporean Mandopop"] },
  { id: "MY", label: "马来西亚", language: "zh", queries: ["Malaysian pop", "Mandopop Malaysia", "Malay pop"] },
  { id: "TH", label: "泰国", language: "th", queries: ["Thai pop", "T-pop"] },
  { id: "ID", label: "印尼", language: "id", queries: ["Indonesian pop", "Indo pop"] },
  { id: "VN", label: "越南", language: "vi", queries: ["V-pop", "Vietnamese pop"] },
  { id: "PH", label: "菲律宾", language: "tl", queries: ["Filipino pop", "OPM"] },
  { id: "JP", label: "日本", language: "ja", queries: ["J-pop", "Japanese pop"] },
  { id: "KR", label: "韩国", language: "ko", queries: ["K-pop", "Korean pop"] },
  { id: "US", label: "美国 / 欧美", language: "en", queries: ["Western pop", "US pop", "R&B soul"] },
  { id: "EU", label: "欧洲", language: "en", queries: ["UK pop", "European pop", "Britpop"] },
];

export function getRegionOption(region: MusicRegion): RegionOption | undefined {
  return MUSIC_REGIONS.find((item) => item.id === region);
}

export function getRegionQueries(region: MusicRegion): string[] {
  return getRegionOption(region)?.queries || [];
}
