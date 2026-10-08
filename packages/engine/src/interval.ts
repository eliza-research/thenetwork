// Interval helpers (moved verbatim from world.ts). A leaf module.
export type Interval = [number, number];

export function union(ivs: Interval[]): Interval[] {
  const s = [...ivs].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]); else out.push([iv[0], iv[1]]);
  }
  return out;
}
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [s1, e1] of a) for (const [s2, e2] of b) {
    const s = Math.max(s1, s2), e = Math.min(e1, e2);
    if (e > s) out.push([s, e]);
  }
  return union(out);
}
export function subtract(a: Interval[], [s, e]: Interval): Interval[] {
  const out: Interval[] = [];
  for (const [s1, e1] of a) {
    if (e <= s1 || s >= e1) { out.push([s1, e1]); continue; }
    if (s > s1) out.push([s1, s]);
    if (e < e1) out.push([e, e1]);
  }
  return out;
}

