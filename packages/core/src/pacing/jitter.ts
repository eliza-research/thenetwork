import { fnv1a, hash32, Rng } from "../rng.ts";

export const DEFAULT_QUIET_SPREAD_WINDOW_MS = 75 * 60_000;

export function fullJitterDelayMs(
  seed: string | number,
  attempt: number,
  baseMs: number,
  maxMs: number,
): number {
  const safeBase = Math.max(1, Math.floor(baseMs));
  const safeMax = Math.max(safeBase, Math.floor(maxMs));
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const ceiling = Math.min(safeMax, safeBase * 2 ** Math.min(safeAttempt - 1, 20));
  const rng = new Rng(hash32("full-jitter", seed, safeAttempt));
  return Math.floor(rng.next() * (ceiling + 1));
}

export function decorrelatedJitterDelayMs(
  seed: string | number,
  prevDelayMs: number,
  baseMs: number,
  maxMs: number,
  step = 1,
): number {
  const safeBase = Math.max(1, Math.floor(baseMs));
  const safeMax = Math.max(safeBase, Math.floor(maxMs));
  const safePrev = Math.max(safeBase, Math.floor(prevDelayMs));
  const high = Math.min(safeMax, safePrev * 3);
  const rng = new Rng(hash32("decorrelated-jitter", seed, safePrev, step));
  return safeBase + Math.floor(rng.next() * (high - safeBase + 1));
}

export function quietHoursSpreadOffsetMs(
  key: string,
  spreadWindowMs = DEFAULT_QUIET_SPREAD_WINDOW_MS,
): number {
  if (!Number.isFinite(spreadWindowMs) || spreadWindowMs <= 0) return 0;
  const windowSec = Math.floor(spreadWindowMs / 1000);
  if (windowSec <= 0) return fnv1a(key) % Math.max(1, Math.floor(spreadWindowMs));
  return (fnv1a(key) % (windowSec + 1)) * 1000;
}

export function applyQuietHoursSpread(
  nextAllowedMs: number,
  key: string,
  spreadWindowMs = DEFAULT_QUIET_SPREAD_WINDOW_MS,
): number {
  return nextAllowedMs + quietHoursSpreadOffsetMs(key, spreadWindowMs);
}

export function poissonSpacingMs(
  rng: Rng,
  meanIntervalMs: number,
  minFactor = 0.4,
  maxFactor = 2.5,
): number {
  const safeMean = Math.max(1, meanIntervalMs);
  const lo = Math.max(0.05, minFactor);
  const hi = Math.max(lo, maxFactor);
  const u = Math.min(1 - 1e-12, Math.max(1e-12, rng.next()));
  const raw = -Math.log(1 - u) * safeMean;
  return Math.round(Math.max(safeMean * lo, Math.min(safeMean * hi, raw)));
}
