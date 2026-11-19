/**
 * Pure, deterministic music-query interpretation. Do not fetch from providers here.
 * Curated aliases are deliberately narrow; avoid generic substring guesses.
 */
export type MusicSearchIntent = {
  raw: string;
  normalizedQuery: string;
  kind: "song" | "artist" | "free-text";
  title?: string;
  artist?: string;
  originalHint?: boolean;
  confidence: "curated" | "parsed" | "unknown";
  note?: string;
};

function compact(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

const ARTISTS: ReadonlyArray<{ name: string; aliases: string[] }> = [
  { name: "周传雄", aliases: ["周傳雄", "Steve Chou", "Zhou Chuanxiong", "小刚", "小剛", "Xiao Gang"] },
  { name: "陈楚生", aliases: ["陳楚生", "Chen Chusheng"] },
  { name: "维塔斯", aliases: ["維塔斯", "Vitas", "Витас"] },
  { name: "陆虎", aliases: ["陸虎", "路虎", "Lu Hu", "Tiger Lu"] },
  { name: "陈升", aliases: ["陳升", "Bobby Chen", "Chen Sheng"] },
];

const TITLES: ReadonlyArray<{ title: string; aliases: string[]; artist: string }> = [
  { title: "星星", aliases: ["Звезда", "Zvezda", "Vitas Star", "维塔斯星星", "維塔斯星星"], artist: "维塔斯" },
  { title: "庙堂之外", aliases: ["廟堂之外"], artist: "陈楚生" },
  { title: "黄昏", aliases: ["黃昏", "Huang Hun", "Huanghun"], artist: "周传雄" },
  { title: "雪落下的声音", aliases: ["雪落下的聲音"], artist: "陆虎" },
];

function canonicalArtist(value: string): string | undefined {
  const key = compact(value);
  return ARTISTS.find((person) => [person.name, ...person.aliases].some((alias) => compact(alias) === key))?.name;
}
function canonicalTitle(value: string): typeof TITLES[number] | undefined {
  const key = compact(value);
  return TITLES.find((track) => [track.title, ...track.aliases].some((alias) => compact(alias) === key));
}

export function parseMusicSearchIntent(rawQuery: string): MusicSearchIntent {
  const raw = rawQuery.trim().slice(0, 160);
  const base: MusicSearchIntent = { raw, normalizedQuery: raw, kind: "free-text", confidence: "unknown" };
  if (!raw) return base;

  // Unmistakably identifiable descriptive query, not a bare ambiguous title.
  if (/星星|зве[зз]да|zvezda/i.test(raw) && /俄罗斯|俄羅斯|俄语|俄語|高音|男高音|vitas|витас|维塔斯|維塔斯/i.test(raw)) {
    return { ...base, normalizedQuery: "Звезда Vitas", kind: "song", title: "星星", artist: "维塔斯", confidence: "curated", originalHint: true, note: "已识别为 Vitas《Звезда》（中文常译《星星》）" };
  }

  // Handles 陈楚生-庙堂之外, 黄昏 - 周传雄, and their inverses.
  const split = raw.split(/\s*(?:\s[-–—·|]\s|\s+-\s+|\s+[：:]\s+)\s*/).map((part) => part.trim()).filter(Boolean);
  if (split.length === 2) {
    const [one, two] = split;
    const firstArtist = canonicalArtist(one);
    const secondArtist = canonicalArtist(two);
    const firstSong = canonicalTitle(one);
    const secondSong = canonicalTitle(two);
    if (firstArtist && (secondSong || !secondArtist)) {
      const title = secondSong?.title || two;
      return { ...base, kind: "song", title, artist: firstArtist, normalizedQuery: `${title} ${firstArtist}`, confidence: secondSong ? "curated" : "parsed", originalHint: Boolean(secondSong && secondSong.artist === firstArtist) };
    }
    if (secondArtist && (firstSong || !firstArtist)) {
      const title = firstSong?.title || one;
      return { ...base, kind: "song", title, artist: secondArtist, normalizedQuery: `${title} ${secondArtist}`, confidence: firstSong ? "curated" : "parsed", originalHint: Boolean(firstSong && firstSong.artist === secondArtist) };
    }
  }

  // Full-text artist + song (without separators): handle only exact curated tokens.
  const simplified = compact(raw);
  for (const person of ARTISTS) {
    for (const alias of [person.name, ...person.aliases]) {
      const a = compact(alias);
      if (!a || !simplified.includes(a)) continue;
      const remaining = simplified.replace(a, "");
      if (!remaining) {
        return { ...base, kind: "artist", artist: person.name, normalizedQuery: person.name, confidence: "curated", note: alias === "路虎" ? "按音乐人物「陆虎」检索；原始输入保留" : undefined };
      }
      const song = TITLES.find((track) => [track.title, ...track.aliases].some((title) => compact(title) === remaining));
      if (song) return { ...base, kind: "song", title: song.title, artist: person.name, normalizedQuery: `${song.title} ${person.name}`, confidence: "curated", originalHint: song.artist === person.name };
    }
  }

  const fullTitle = canonicalTitle(raw);
  if (fullTitle) {
    // A bare "星星" is ambiguous; don't assert Vitas without further context.
    if (compact(raw) === compact("星星")) return base;
    return { ...base, kind: "song", title: fullTitle.title, artist: fullTitle.artist, normalizedQuery: `${fullTitle.title} ${fullTitle.artist}`, confidence: "curated", originalHint: true };
  }
  const artist = canonicalArtist(raw);
  if (artist) return { ...base, kind: "artist", artist, normalizedQuery: artist, confidence: "curated", note: compact(raw) === compact("路虎") ? "已按歌手「陆虎」检索" : undefined };
  return base;
}

export function musicCatalogQueries(intent: MusicSearchIntent): string[] {
  if (intent.kind === "song" && intent.title && intent.artist) {
    const variants = intent.artist === "维塔斯" ? ["Звезда Vitas", "Vitas Zvezda", "Звезда"] : [`${intent.title} ${intent.artist}`, intent.title];
    return [...new Set(variants)];
  }
  if (intent.kind === "artist" && intent.artist) {
    return intent.artist === "维塔斯" ? ["Vitas"] : [intent.artist];
  }
  return [intent.normalizedQuery];
}
