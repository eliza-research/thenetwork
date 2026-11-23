// A reported app-world gate. The app owns its threshold and scoring rules.
export interface GateResult { id: string; gate: string; value: string; pass: boolean }

/** No finite ratio means the run did not measure this comparison. */
export function minimumObservedRatio(ratios: number[]): number {
  const observed = ratios.filter(Number.isFinite);
  return observed.length === 0 ? NaN : Math.min(...observed);
}
