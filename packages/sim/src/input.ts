// Simulation inputs are checked before they affect the recorded population or horizon.
export const simulationNumber = (value: string | undefined): number => Number(value?.trim() || NaN);

export function requireSimulationCount(value: number, field: string, minimum: 0 | 1): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${field} must be a ${minimum === 0 ? "non-negative" : "positive"} safe integer.`);
  }
}

export function requirePositiveSimulationValue(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${field} must be a positive finite number.`);
}

export function requireSimulationShare(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
    throw new RangeError(`${field} must be a finite number between 0 and 1.`);
  }
}
