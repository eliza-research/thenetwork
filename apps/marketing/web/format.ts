export function formatUsdCents(cents: number | undefined | null): string {
  const val = typeof cents === "number" && Number.isFinite(cents) ? cents / 100 : 0;
  return `$${val.toLocaleString("en-US", { minimumFractionDigits: val < 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function formatMicrosUsd(micros: number | undefined | null): string {
  const usd = typeof micros === "number" && Number.isFinite(micros) ? micros / 1_000_000 : 0;
  return `$${usd.toFixed(usd === 0 || usd >= 1 ? 2 : 4)}`;
}

export function formatDurationMs(ms: number | null | undefined): string | undefined {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return undefined;
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

export function formatPct(fraction: number): string {
  if (!Number.isFinite(fraction)) return "0%";
  return `${Math.round(fraction * 1000) / 10}%`;
}

export function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function triggerDownload(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
