// Seeded, splittable pseudo-random numbers: the one home for the repo's PRNGs and string hashes.
// Everything random in the simulators flows through an Rng derived from the run seed so every run
// is replayable (PRD 34.3); the engine's runs are reproducible from seed + inputs (ME-004).

/** 32-bit FNV-1a hash of any number of string/number parts. */
export function hash32(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x7c; // separator so ("ab","c") != ("a","bc")
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private s: number;
  constructor(seed: number | string) {
    this.s = (typeof seed === "number" ? seed : hash32(seed)) >>> 0 || 0x9e3779b9;
  }
  /** Derive an independent stream for a named purpose (does not advance this one). */
  fork(...label: (string | number)[]): Rng {
    return new Rng(hash32(this.s, ...label));
  }
  /** mulberry32: uniform in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  bool(p = 0.5): boolean { return this.next() < p; }
  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }
  range(min: number, max: number): number { return min + this.next() * (max - min); }
  pick<T>(arr: readonly T[]): T {
    if (!arr.length) throw new Error("pick from empty array");
    return arr[Math.floor(this.next() * arr.length)]!;
  }
  /** Pick k distinct items (order randomized). */
  sample<T>(arr: readonly T[], k: number): T[] {
    return this.shuffle(arr).slice(0, Math.max(0, Math.min(k, arr.length)));
  }
  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [item, w] of items) { if ((r -= w) < 0) return item; }
    return items[items.length - 1]![0];
  }
  /** Standard normal via Box-Muller. */
  normal(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Log-normal parameterised by its median and log-space sigma. */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(this.normal(0, sigma));
  }
}

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 32-bit FNV-1a hash of a string (engine embeddings and streams). */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The engine's stream (mulberry32, `int(n)`, in-place `shuffle`, `fork(label)` by FNV of label and
 * state). Kept as its own class so every engine run draws exactly what it drew before the merge;
 * new code outside the engine uses `Rng`. Never use Math.random in engine code.
 */
export class EngineRng {
  private a: number;
  constructor(seed: number) { this.a = (seed >>> 0) || 0x9e3779b9; }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number { return Math.floor(this.next() * n); }
  range(lo: number, hi: number): number { return lo + this.next() * (hi - lo); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("pick from empty array");
    return arr[this.int(arr.length)]!;
  }
  sample<T>(arr: readonly T[], k: number): T[] { return this.shuffle([...arr]).slice(0, k); }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }
  /** Independent child stream so adding draws in one stage does not perturb another. */
  fork(label: string): EngineRng { return new EngineRng(fnv1a(`${label}:${this.a}`)); }
}
