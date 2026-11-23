const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
const T80 = [1.376, 1.061, 0.978, 0.941, 0.92, 0.906, 0.896, 0.889, 0.883, 0.879, 0.876, 0.873, 0.87, 0.868, 0.866, 0.865, 0.863, 0.862, 0.861, 0.86, 0.859, 0.858, 0.858, 0.857, 0.856, 0.856, 0.855, 0.855, 0.854, 0.854];
const tq = (table: number[], z: number, df: number) => (df < 1 ? NaN : df <= 30 ? table[df - 1]! : z);

export interface Paired {
  n: number; meanA: number; meanB: number;
  diff: number; sd: number; se: number; lo: number; hi: number;
  corr: number;
  mde: number;
}

const mean = (x: readonly number[]) => x.reduce((s, v) => s + v, 0) / Math.max(1, x.length);
const sdOf = (x: readonly number[]) => { const m = mean(x); return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, x.length - 1)); };

export function paired(a: readonly number[], b: readonly number[]): Paired {
  if (a.length !== b.length) throw new Error(`paired: ${a.length} values against ${b.length}`);
  const n = a.length, d = a.map((x, i) => b[i]! - x);
  const diff = mean(d), sd = n > 1 ? sdOf(d) : NaN, se = sd / Math.sqrt(n);
  const t = tq(T975, 1.96, n - 1);
  const sa = sdOf(a), sb = sdOf(b), ma = mean(a), mb = mean(b);
  const cov = a.reduce((s, x, i) => s + (x - ma) * (b[i]! - mb), 0) / Math.max(1, n - 1);
  return { n, meanA: ma, meanB: mb, diff, sd, se, lo: diff - t * se, hi: diff + t * se, corr: sa > 0 && sb > 0 ? cov / (sa * sb) : NaN, mde: (t + tq(T80, 0.842, n - 1)) * se };
}

const f = (x: number, d = 3) => (Number.isFinite(x) ? Number(x.toFixed(d)).toString() : "-");

export function meanInterval(xs: readonly number[], unit = "seed"): string {
  const n = xs.length, m = mean(xs), se = n > 1 ? sdOf(xs) / Math.sqrt(n) : NaN, t = tq(T975, 1.96, n - 1);
  return `${f(m, 2)} per ${unit} (95% CI ${f(m - t * se, 2)} to ${f(m + t * se, 2)}, n ${n} ${unit}s)`;
}

export function pairedLine(a: readonly number[], b: readonly number[], d = 3): string {
  const p = paired(a, b);
  return `diff/seed [${a.map((x, i) => f(b[i]! - x, d)).join(", ")}]; mean ${f(p.diff, d)} (A ${f(p.meanA, d)}, B ${f(p.meanB, d)}), sd ${f(p.sd, d)}, se ${f(p.se, d)}, 95% CI [${f(p.lo, d)}, ${f(p.hi, d)}], corr ${f(p.corr, 2)}, MDE ${f(p.mde, d)} (n ${p.n})`;
}

export function overlap(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a), B = new Set(b);
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  return A.size + B.size === 0 ? 1 : both / (A.size + B.size - both);
}

function mix(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join("\u0000")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

export const saltSeed = (seed: number, salt: number): number => (salt === 0 ? seed : mix("aa", seed, salt));

function relabel<T>(v: T, ids: ReadonlyMap<string, string>): T {
  if (typeof v === "string") return (ids.get(v) ?? v) as T;
  if (Array.isArray(v)) return v.map(x => relabel(x, ids)) as T;
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [relabel(k, ids), relabel(x, ids)])) as T;
  if (v instanceof Set) return new Set([...v].map(x => relabel(x, ids))) as T;
  if (v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [ids.get(k) ?? k, relabel(x, ids)])) as T;
  return v;
}

export function idsSalted<C extends { snapshot: { members: readonly { id: string }[] } }, R>(m: { name: string; propose(ctx: C): R }, salt: number): { name: string; propose(ctx: C): R } {
  if (salt === 0) return m;
  return {
    name: m.name,
    propose(ctx) {
      const to = new Map<string, string>(), back = new Map<string, string>();
      for (const { id } of ctx.snapshot.members) {
        let alias = `m${mix("alias", salt, id).toString(36)}`;
        while (back.has(alias)) alias += "x";
        to.set(id, alias); back.set(alias, id);
      }
      const out = m.propose(relabel(ctx, to));
      return (out instanceof Promise ? out.then(o => relabel(o, back)) : relabel(out, back)) as R;
    },
  };
}
