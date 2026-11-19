const BVID = /^BV[0-9A-Za-z]{10}$/;

export function resolveBilibiliVideoUrl(input) {
  let url;
  try { url = new URL(String(input || "").trim()); } catch { throw new Error("请输入有效的 Bilibili 视频链接。"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Bilibili 链接协议无效。");
  const host = url.hostname.toLowerCase();
  if (!/(^|\.)bilibili\.com$/.test(host) && host !== "b23.tv") throw new Error("链接不是 Bilibili 官方域名。");
  const match = url.pathname.match(/\/(BV[0-9A-Za-z]{10})(?:\/|$)/);
  if (!match || !BVID.test(match[1])) throw new Error("未识别到 BV 号。短链请先在浏览器打开，再复制完整视频链接。");
  const bvid = match[1];
  const page = Math.min(Math.max(Number(url.searchParams.get("p") || 1), 1), 999);
  const rawTime = url.searchParams.get("t") || "0";
  const startSeconds = /^\d+$/.test(rawTime) ? Number(rawTime) : 0;
  const embed = new URL("https://player.bilibili.com/player.html");
  embed.searchParams.set("bvid", bvid);
  embed.searchParams.set("autoplay", "0");
  embed.searchParams.set("danmaku", "0");
  embed.searchParams.set("p", String(page));
  if (startSeconds) embed.searchParams.set("t", String(startSeconds));
  return {
    id: `bilibili:${bvid}:${page}`,
    videoId: bvid,
    platform: "bilibili",
    title: `Bilibili 视频 ${bvid}`,
    creator: "Bilibili 创作者",
    watchUrl: `https://www.bilibili.com/video/${bvid}/?p=${page}`,
    embed: { kind: "official-embed", url: embed.toString(), startSeconds },
    metadataAvailable: false,
  };
}
