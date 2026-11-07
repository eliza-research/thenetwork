// Interval helpers (moved verbatim from world.ts). A leaf module.
import { mergeSorted, subtractSpan, type Span } from "./intervalCore.ts";

export type Interval = [number, number];

const toSpan = ([s, e]: Interval): Span => ({ s, e });
const toInterval = ({ s, e }: Span): Interval => [s, e];

export function union(ivs: Interval[]): Interval[] {
  return mergeSorted([...ivs].sort((a, b) => a[0] - b[0]).map(toSpan)).map(toInterval);
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
  return subtractSpan(a.map(toSpan), s, e).map(toInterval);
}
