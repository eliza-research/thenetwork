// All Network code reads time from a Clock (PRD 31.1, 32.18). Never call Date.now() directly.
export interface Clock { now(): number }
export class RealClock implements Clock { now() { return Date.now(); } }
const finite = (v: number, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`SimClock ${what} must be a finite number, got ${v}`);
  return v;
};
export class SimClock implements Clock {
  private t: number;
  constructor(t: number = Date.UTC(2026, 9, 5, 16)) { this.t = finite(t, "start time"); }
  now() { return this.t; }
  advance(ms: number) { finite(ms, "advance"); if (ms < 0) throw new Error("time cannot go backwards"); this.t += ms; }
  set(t: number) { finite(t, "time"); if (t < this.t) throw new Error("time cannot go backwards"); this.t = t; }
}
export const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
