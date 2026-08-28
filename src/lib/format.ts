export const nf = new Intl.NumberFormat("en-US");

export function num(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "0";
  return nf.format(typeof n === "string" ? Number(n) : n);
}

export function pct(part: number, total: number, dp = 0): string {
  if (!total) return "0%";
  return `${((part / total) * 100).toFixed(dp)}%`;
}

export function ago(d: Date | string | null | undefined): string {
  if (!d) return "Never";
  const t = typeof d === "string" ? new Date(d) : d;
  const s = Math.floor((Date.now() - t.getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  return t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function dubaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
}
