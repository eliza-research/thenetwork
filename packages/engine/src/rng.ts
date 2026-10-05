// Seeded randomness and stable hashing (ME-004: runs are reproducible from seed + inputs).
import { createHash } from "node:crypto";

/** 32-bit FNV-1a hash of a string. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function sha256(str: string): string {
  return createHash("sha256").update(str).digest("hex");
}

/** JSON.stringify with sorted object keys so hashes do not depend on key order. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter(k => o[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

/** Small deterministic PRNG (mulberry32). Never use Math.random in engine code. */
export class Rng {
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
  fork(label: string): Rng { return new Rng(fnv1a(`${label}:${this.a}`)); }
}
