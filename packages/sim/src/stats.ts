export { clamp01 } from "@thenetwork/core";

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function medianOrNull(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function median(xs: readonly number[], empty = 0): number {
  const m = medianOrNull(xs);
  return m === null ? empty : m;
}

export function topShare(values: readonly number[], frac = 0.1): number {
  const xs = [...values].sort((a, b) => b - a);
  const sum = xs.reduce((s, x) => s + x, 0);
  if (!sum) return 0;
  const k = Math.max(1, Math.round(xs.length * frac));
  return xs.slice(0, k).reduce((s, x) => s + x, 0) / sum;
}

export function safeDiv(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}
