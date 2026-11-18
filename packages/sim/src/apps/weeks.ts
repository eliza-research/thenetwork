/** Weekly app worlds execute whole rounds and use the same duration in their metrics. */
export function simulationWeeks(value: number | undefined, fallback: number): number {
  const weeks = value ?? fallback;
  if (!Number.isSafeInteger(weeks) || weeks <= 0) throw new Error(`invalid weeks ${String(weeks)}; expected a positive safe integer`);
  return weeks;
}
