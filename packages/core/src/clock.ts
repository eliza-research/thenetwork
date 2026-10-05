// All Network code reads time from a Clock (PRD 31.1, 32.18). Never call Date.now() directly.
export interface Clock { now(): number }
export class RealClock implements Clock { now() { return Date.now(); } }
export class SimClock implements Clock {
  constructor(private t: number = Date.UTC(2026, 9, 5, 16)) {}
  now() { return this.t; }
  advance(ms: number) { if (ms < 0) throw new Error("time cannot go backwards"); this.t += ms; }
  set(t: number) { if (t < this.t) throw new Error("time cannot go backwards"); this.t = t; }
}
export const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
