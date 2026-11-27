import type { MemberId } from "@thenetwork/core";
import { pairKey } from "./world.ts";

export interface SparsePairEdge {
  readonly a: MemberId;
  readonly b: MemberId;
  readonly surplus: number;
  readonly uA: number;
  readonly uB: number;
}

export interface MarketEquilibrium {
  readonly mu: Map<string, number>;
  readonly unmatchedMass: Map<MemberId, number>;
  readonly shadowPrice: Map<MemberId, number>;
  readonly potentialA: Map<MemberId, number>;
  readonly p80ShadowPrice: number;
  readonly medianShadowPrice: number;
  readonly iterations: number;
  readonly maxRelDiff: number;
}

function dampedPositiveStep(prev: number, target: number, damping: number, eps: number): number {
  const floor = eps > 0 ? eps : 1e-9;
  const p = Number.isFinite(prev) && prev > floor ? prev : floor;
  const t = Number.isFinite(target) && target > 0 ? target : 0;
  const d = Number.isFinite(damping) ? Math.max(0.05, Math.min(1, damping)) : 0.5;
  const blended = (1 - d) * p + d * t;
  return blended > floor ? blended : floor;
}

export function solveChooSiowIPFP(
  edges: readonly SparsePairEdge[],
  budget: ReadonlyMap<MemberId, number>,
  beta = 0.25,
  iters = 25,
  damping = 0.5,
): MarketEquilibrium {
  const temp = Math.max(0.02, Number.isFinite(beta) ? beta : 0.25);
  const maxIter = Math.max(1, Math.min(200, Math.floor(iters)));
  const damp = Math.max(0.05, Math.min(1, Number.isFinite(damping) ? damping : 0.5));
  const inv2Temp = 1 / (2 * temp);

  const deduped = new Map<string, { a: MemberId; b: MemberId; K: number }>();
  for (const e of edges) {
    if (e.a === e.b) continue;
    const bA = budget.get(e.a) ?? 0;
    const bB = budget.get(e.b) ?? 0;
    if (!(bA > 0) || !(bB > 0)) continue;
    const s = Number.isFinite(e.surplus) ? e.surplus : 0;
    const expArg = Math.max(-20, Math.min(20, s * inv2Temp));
    const K = Math.exp(expArg);
    const k = pairKey(e.a, e.b);
    const prev = deduped.get(k);
    if (!prev || K > prev.K) {
      const a = e.a < e.b ? e.a : e.b;
      const b = e.a < e.b ? e.b : e.a;
      deduped.set(k, { a, b, K });
    }
  }

  const keys = [...deduped.keys()].sort();
  if (keys.length === 0) {
    return {
      mu: new Map(),
      unmatchedMass: new Map(),
      shadowPrice: new Map(),
      potentialA: new Map(),
      p80ShadowPrice: 0,
      medianShadowPrice: 0,
      iterations: 0,
      maxRelDiff: 0,
    };
  }

  const nodeSet = new Set<MemberId>();
  for (const k of keys) {
    const e = deduped.get(k)!;
    nodeSet.add(e.a);
    nodeSet.add(e.b);
  }
  const ids = [...nodeSet].sort();
  const n = ids.length;
  const idxOf = new Map<MemberId, number>();
  for (let i = 0; i < n; i++) idxOf.set(ids[i]!, i);

  const deg = new Int32Array(n);
  const eU = new Int32Array(keys.length);
  const eV = new Int32Array(keys.length);
  const eK = new Float64Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    const e = deduped.get(keys[i]!)!;
    const u = idxOf.get(e.a)!;
    const v = idxOf.get(e.b)!;
    eU[i] = u;
    eV[i] = v;
    eK[i] = e.K;
    deg[u] = deg[u]! + 1;
    deg[v] = deg[v]! + 1;
  }

  const rowPtr = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) rowPtr[i + 1] = rowPtr[i]! + deg[i]!;
  const totalEntries = rowPtr[n]!;
  const colIdx = new Int32Array(totalEntries);
  const colK = new Float64Array(totalEntries);
  const cursor = rowPtr.slice(0, n);
  for (let i = 0; i < keys.length; i++) {
    const u = eU[i]!, v = eV[i]!, kVal = eK[i]!;
    const pu = cursor[u]!;
    colIdx[pu] = v;
    colK[pu] = kVal;
    cursor[u] = pu + 1;
    const pv = cursor[v]!;
    colIdx[pv] = u;
    colK[pv] = kVal;
    cursor[v] = pv + 1;
  }

  const bArr = new Float64Array(n);
  const aArr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const bi = Math.max(1e-6, budget.get(ids[i]!) ?? 1);
    bArr[i] = bi;
    aArr[i] = Math.sqrt(bi);
  }

  let usedIters = 0;
  let lastRelDiff = 0;
  for (let t = 0; t < maxIter; t++) {
    usedIters = t + 1;
    let maxRelDiff = 0;
    for (let i = 0; i < n; i++) {
      const bi = bArr[i]!;
      let load = 0;
      const start = rowPtr[i]!, end = rowPtr[i + 1]!;
      for (let p = start; p < end; p++) load += colK[p]! * aArr[colIdx[p]!]!;
      const half = 0.5 * load;
      const targetA = half > 1e6 ? bi / (2 * half) : Math.sqrt(bi + half * half) - half;
      const prevA = aArr[i]!;
      const nextA = dampedPositiveStep(prevA, targetA > 0 ? targetA : 0, damp, 1e-9);
      aArr[i] = nextA;
      const rel = Math.abs(nextA - prevA) / (prevA > 1e-9 ? prevA : 1e-9);
      if (rel > maxRelDiff) maxRelDiff = rel;
    }
    lastRelDiff = maxRelDiff;
    if (maxRelDiff < 1e-4) break;
  }

  const shadowPrice = new Map<MemberId, number>();
  const unmatchedMass = new Map<MemberId, number>();
  const potentialA = new Map<MemberId, number>();
  const lambdas = new Float64Array(n);
  const neg2Temp = -2 * temp;
  for (let i = 0; i < n; i++) {
    const id = ids[i]!;
    const ai = aArr[i]!;
    const lam = neg2Temp * Math.log(ai);
    potentialA.set(id, ai);
    shadowPrice.set(id, lam);
    unmatchedMass.set(id, ai * ai);
    lambdas[i] = lam;
  }
  lambdas.sort();
  const p80Idx = Math.min(n - 1, Math.floor(0.8 * n));
  const medIdx = Math.min(n - 1, Math.floor(0.5 * n));
  const p80ShadowPrice = lambdas[p80Idx] ?? 0;
  const medianShadowPrice = lambdas[medIdx] ?? 0;

  const mu = new Map<string, number>();
  for (let i = 0; i < keys.length; i++) {
    mu.set(keys[i]!, eK[i]! * aArr[eU[i]!]! * aArr[eV[i]!]!);
  }

  return {
    mu,
    unmatchedMass,
    shadowPrice,
    potentialA,
    p80ShadowPrice,
    medianShadowPrice,
    iterations: usedIters,
    maxRelDiff: lastRelDiff,
  };
}
