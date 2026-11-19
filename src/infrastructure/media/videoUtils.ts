export function fileTitle(name: string) { return name.replace(/\.[^/.]+$/, ""); }
export function bytesLabel(value = 0) {
  if (!value) return "0 MB";
  const mb = value / 1024 / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
export function timeLabel(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
}
