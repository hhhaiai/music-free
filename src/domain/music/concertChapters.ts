export type ConcertChapter = { title: string; startSeconds: number };

/** Parse chapter timestamps pasted from an official video description. */
export function parseConcertChapters(text: string): ConcertChapter[] {
  const output: ConcertChapter[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*•]\s*/, "").replace(/^\[/, "");
    const match = line.match(/^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)\s*(?:\]|[-–—:|])?\s*(.+?)\s*$/);
    if (!match) continue;
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const title = match[4].replace(/^[-–—:|]+\s*/, "").trim();
    if (!title || (match[1] && minutes > 59)) continue;
    output.push({ title, startSeconds: hours * 3600 + minutes * 60 + seconds });
  }
  const unique = new Map<number, ConcertChapter>();
  output.sort((a, b) => a.startSeconds - b.startSeconds).forEach((chapter) => {
    if (!unique.has(chapter.startSeconds)) unique.set(chapter.startSeconds, chapter);
  });
  return [...unique.values()];
}
