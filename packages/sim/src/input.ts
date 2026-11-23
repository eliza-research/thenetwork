// Simulation inputs are checked before they affect the recorded population or horizon.
export const simulationNumber = (value: string | undefined): number => Number(value?.trim() || NaN);

export function simulationSeed(value: string | undefined): number {
  const seed = simulationNumber(value);
  if (!Number.isFinite(seed)) throw new RangeError("--seed must be a finite number.");
  return seed;
}

const MAX_REPORTED_SEEDS = 10_000;
const RANGE_BOUND = "(?:[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?|0(?:x[0-9a-f]+|o[0-7]+|b[01]+))";
const SEED_RANGE = new RegExp("^(" + RANGE_BOUND + ")\\s*-\\s*(" + RANGE_BOUND + ")$", "i");

export function simulationSeeds(value: string | undefined, commaList = false): number[] {
  const selections = commaList ? (value ?? "").split(",") : [value ?? ""];
  const seeds: number[] = [];
  for (const selection of selections) {
    const pair = SEED_RANGE.exec(selection.trim());
    const first = simulationNumber(pair?.[1] ?? selection);
    const last = pair ? simulationNumber(pair[2]) : first;
    const count = Math.floor(last - first) + 1;
    if (!Number.isFinite(first) || !Number.isFinite(last) || count < 1 || count > MAX_REPORTED_SEEDS - seeds.length) {
      throw new RangeError("--seeds must select finite numbers or ascending ranges, up to 10,000 seeds.");
    }
    for (let offset = 0; offset < count; offset++) seeds.push(first + offset);
  }
  return seeds;
}

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
