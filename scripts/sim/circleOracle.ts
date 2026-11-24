import { circleCoherent } from "../../packages/core/src/generated/groupFormation.ts";
import type { LaneLimits } from "../../packages/core/src/generated/matchLane.ts";
import { circleEvidence, type Circle } from "../../packages/engine/src/match/circles.ts";
import type { MatchProfile } from "../../packages/engine/src/match/profile.ts";

export interface PackingResult { readonly value: number; readonly exact: boolean; readonly nodes: number }

export const packingValue = (circles: readonly Circle[]): number =>
  circles.reduce((t, c) => t + c.members.length * c.evidence.lowestPairValue, 0);

export function bestPacking(
  profiles: readonly MatchProfile[], limits: LaneLimits, pairValue: (a: MatchProfile, b: MatchProfile) => number,
  start: number, nodeLimit: number,
): PackingResult {
  const n = profiles.length;
  const floor = limits.circlePairFloor, band = limits.rules.parityBand;
  const value: number[][] = profiles.map(() => new Array<number>(n).fill(-1));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const v = profiles[i]!.memberId === profiles[j]!.memberId ? -1 : pairValue(profiles[i]!, profiles[j]!);
    value[i]![j] = value[j]![i] = v >= floor ? v : -1;
  }
  const most = value.map(row => Math.max(0, [...row].sort((x, y) => y - x)[Math.max(0, limits.circleMinimum - 2)] ?? 0));
  const neighbours = value.map((row, i) => row.flatMap((v, j) => (v >= 0 && j > i ? [j] : [])).sort((x, y) => value[i]![y]! - value[i]![x]! || x - y));
  const free = new Array<boolean>(n).fill(true);
  let best = start, nodes = 0, stopped = false;
  let remaining = most.reduce((t, x) => t + x, 0);

  const coherent = (members: readonly number[]): number | undefined => {
    const index = new Map(members.map(k => [profiles[k]!, k] as const));
    const evidence = circleEvidence([...index.keys()], (a, b) => { const v = value[index.get(a)!]![index.get(b)!]!; return v >= 0 ? v : undefined; });
    return circleCoherent(evidence, limits.circleMinimum, limits.circleMaximum, floor, band) ? evidence.lowestPairValue : undefined;
  };

  const search = (from: number, total: number): void => {
    if (stopped) return;
    if (++nodes > nodeLimit) { stopped = true; return; }
    let i = from;
    while (i < n && !free[i]) i++;
    if (i >= n) { best = Math.max(best, total); return; }
    if (total + remaining <= best) return;
    free[i] = false; remaining -= most[i]!;
    const clique = [i];
    const extend = (options: readonly number[]): void => {
      if (stopped || ++nodes > nodeLimit) { stopped = true; return; }
      if (clique.length >= limits.circleMinimum) {
        const low = coherent(clique);
        if (low !== undefined) {
          const saved = remaining;
          for (const k of clique.slice(1)) { free[k] = false; remaining -= most[k]!; }
          search(i + 1, total + clique.length * low);
          for (const k of clique.slice(1)) free[k] = true;
          remaining = saved;
        }
      }
      if (clique.length >= limits.circleMaximum) return;
      for (const [x, k] of options.entries()) {
        if (!free[k]) continue;
        clique.push(k);
        extend(options.slice(x + 1).filter(o => value[k]![o]! >= 0));
        clique.pop();
      }
    };
    extend(neighbours[i]!.filter(k => free[k]));
    search(i + 1, total);
    free[i] = true; remaining += most[i]!;
  };
  search(0, 0);
  return { value: best, exact: !stopped, nodes };
}
