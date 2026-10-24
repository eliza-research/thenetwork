/** Shared descriptive statistics for the app-world CLI tables. Empty samples remain NaN. */
export const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export function standardError(xs: readonly number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1) / xs.length);
}
export function formatEstimate(xs: readonly number[], pct = false, digits = 2): string {
  return pct ? `${(mean(xs) * 100).toFixed(1)}% ± ${(standardError(xs) * 100).toFixed(1)}`
    : `${mean(xs).toFixed(digits)} ± ${standardError(xs).toFixed(digits)}`;
}
