/** Gini coefficient of non-negative values. Empty and all-zero populations have no inequality. */
export function gini(values: readonly number[]): number {
  const n = values.length;
  if (!n) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (2 * (i + 1) - n - 1) * sorted[i]!;
  return weighted / (n * sum);
}
