import type { LaneLimits } from "../../packages/core/src/generated/matchLane.ts";
import type { Circle } from "../../packages/engine/src/match/circles.ts";
import type { MatchProfile } from "../../packages/engine/src/match/profile.ts";

export interface PackingResult { readonly value: number; readonly exact: boolean; readonly nodes: number }

export const packingValue = (circles: readonly Circle[]): number =>
  circles.reduce((t, c) => t + c.members.length * c.evidence.lowestPairValue, 0);

function popcount32(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function bestPacking(
  profiles: readonly MatchProfile[], limits: LaneLimits, pairValue: (a: MatchProfile, b: MatchProfile) => number,
  start: number, nodeLimit: number,
): PackingResult {
  const n = profiles.length;
  const minSize = limits.circleMinimum;
  const maxSize = limits.circleMaximum;
  const floor = limits.circlePairFloor;
  const band = limits.rules.parityBand;
  const rawVal = new Int32Array(n * n);
  rawVal.fill(-1);
  for (let i = 0; i < n; i++) {
    const pi = profiles[i]!;
    const rowOff = i * n;
    for (let j = i + 1; j < n; j++) {
      const pj = profiles[j]!;
      const v = pi.memberId === pj.memberId ? -1 : pairValue(pi, pj);
      const kept = v >= floor ? v : -1;
      rawVal[rowOff + j] = kept;
      rawVal[j * n + i] = kept;
    }
  }

  const rawMost = new Int32Array(n);
  const rawDeg = new Int32Array(n);
  const rowScratch = new Int32Array(n);
  const rankIdx = Math.max(0, minSize - 2);
  for (let i = 0; i < n; i++) {
    const rowOff = i * n;
    let deg = 0;
    for (let j = 0; j < n; j++) {
      const v = rawVal[rowOff + j]!;
      rowScratch[j] = v;
      if (v >= 0) deg++;
    }
    rawDeg[i] = deg;
    rowScratch.sort();
    const kth = rowScratch[n - 1 - rankIdx] ?? 0;
    rawMost[i] = kth > 0 ? kth : 0;
  }

  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => rawMost[b]! - rawMost[a]! || rawDeg[a]! - rawDeg[b]! || a - b,
  );
  const value = new Int32Array(n * n);
  const standing = new Int32Array(n);
  const ordinal = new Int32Array(n);
  const uncertainty = new Int32Array(n);
  const most = new Int32Array(n);
  let remaining = 0;
  for (let i = 0; i < n; i++) {
    const oi = order[i]!;
    const p = profiles[oi]!;
    standing[i] = p.standing;
    ordinal[i] = p.ordinal;
    uncertainty[i] = p.uncertainty;
    most[i] = rawMost[oi]!;
    remaining += rawMost[oi]!;
    const rowOff = i * n;
    const oRow = oi * n;
    for (let j = 0; j < n; j++) value[rowOff + j] = rawVal[oRow + order[j]!]!;
  }

  const adjStart = new Int32Array(n + 1);
  const adjList: number[] = [];
  for (let i = 0; i < n; i++) {
    adjStart[i] = adjList.length;
    const rowOff = i * n;
    const nbrs: number[] = [];
    for (let j = i + 1; j < n; j++) {
      if (value[rowOff + j]! >= 0) nbrs.push(j);
    }
    nbrs.sort((x, y) => value[rowOff + y]! - value[rowOff + x]! || x - y);
    for (let k = 0; k < nbrs.length; k++) adjList.push(nbrs[k]!);
  }
  adjStart[n] = adjList.length;
  const adj = Int32Array.from(adjList);

  let best = start;
  let nodes = 0;
  let stopped = false;

  if (n <= 31) {
    const adjMask = new Int32Array(n);
    const higherMask = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const rowOff = i * n;
      let am = 0;
      let hm = 0;
      for (let j = 0; j < n; j++) {
        if (value[rowOff + j]! >= 0) {
          am |= 1 << j;
          if (j > i) hm |= 1 << j;
        }
      }
      adjMask[i] = am;
      higherMask[i] = hm;
    }
    const maxFrames = n + 2;
    const cliqueBuf = new Int32Array(maxFrames * maxSize);
    const allBits = n === 31 ? 0x7fffffff : (1 << n) - 1;

    const searchMask = (from: number, freeMask: number, total: number, rem: number, frame: number): void => {
      if (stopped) return;
      if (++nodes > nodeLimit) { stopped = true; return; }
      const restMask = freeMask & (allBits ^ ((1 << from) - 1));
      if (restMask === 0) {
        if (total > best) best = total;
        return;
      }
      if (total + rem <= best) return;
      const i = 31 - Math.clz32(restMask & -restMask);
      const nextFree = freeMask & ~(1 << i);
      const nextRem = rem - most[i]!;
      const cBase = frame * maxSize;
      cliqueBuf[cBase] = i;

      const extendMask = (
        depth: number, candMask: number, lowVal: number, minIdx: number, maxIdx: number,
        usedMask: number, usedRem: number,
      ): void => {
        if (stopped || ++nodes > nodeLimit) { stopped = true; return; }
        if (depth >= minSize) {
          if (lowVal >= floor && standing[maxIdx]! - standing[minIdx]! <= band + uncertainty[minIdx]! + uncertainty[maxIdx]!) {
            searchMask(i + 1, nextFree & ~usedMask, total + depth * lowVal, nextRem - usedRem, frame + 1);
            if (stopped) return;
          }
        }
        if (depth >= maxSize || candMask === 0) return;
        const avail = popcount32(candMask);
        if (depth + avail < minSize) return;
        const maxCliqueSz = depth + avail < maxSize ? depth + avail : maxSize;
        if (lowVal < 0x7fffffff && total + maxCliqueSz * lowVal + (nextRem - usedRem) <= best) return;
        const a0 = adjStart[i]!;
        const a1 = adjStart[i + 1]!;
        let remCand = candMask;
        for (let p = a0; p < a1; p++) {
          const k = adj[p]!;
          const bit = 1 << k;
          if ((remCand & bit) === 0) continue;
          remCand ^= bit;
          const kRow = k * n;
          let nextLow = lowVal;
          for (let c = 0; c < depth; c++) {
            const v = value[kRow + cliqueBuf[cBase + c]!]!;
            if (v < nextLow) nextLow = v;
          }
          const nextCand = remCand & adjMask[k]!;
          const nextDepth = depth + 1;
          const nextAvail = popcount32(nextCand);
          if (nextDepth < minSize && nextDepth + nextAvail < minSize) continue;
          const nextUsedRem = usedRem + most[k]!;
          const nextMaxSz = nextDepth + nextAvail < maxSize ? nextDepth + nextAvail : maxSize;
          if (total + nextMaxSz * nextLow + (nextRem - nextUsedRem) <= best) continue;
          const sk = standing[k]!;
          const ok = ordinal[k]!;
          const nextMin = (sk < standing[minIdx]! || (sk === standing[minIdx]! && ok < ordinal[minIdx]!)) ? k : minIdx;
          const nextMax = (sk > standing[maxIdx]! || (sk === standing[maxIdx]! && ok > ordinal[maxIdx]!)) ? k : maxIdx;
          cliqueBuf[cBase + depth] = k;
          extendMask(nextDepth, nextCand, nextLow, nextMin, nextMax, usedMask | bit, nextUsedRem);
          if (stopped) return;
        }
      };

      const initCand = higherMask[i]! & nextFree;
      if (popcount32(initCand) + 1 >= minSize) {
        extendMask(1, initCand, 0x7fffffff, i, i, 0, 0);
      }
      searchMask(i + 1, nextFree, total, nextRem, frame + 1);
    };

    searchMask(0, allBits, 0, remaining, 0);
    return { value: best, exact: !stopped, nodes };
  }

  const free = new Uint8Array(n);
  free.fill(1);
  const maxFrames = n + 2;
  const frameOptStride = (maxSize + 1) * n;
  const cliqueBuf = new Int32Array(maxFrames * maxSize);
  const optBuf = new Int32Array(maxFrames * frameOptStride);

  const search = (from: number, total: number, frame: number): void => {
    if (stopped) return;
    if (++nodes > nodeLimit) { stopped = true; return; }
    let i = from;
    while (i < n && !free[i]) i++;
    if (i >= n) {
      if (total > best) best = total;
      return;
    }
    if (total + remaining <= best) return;
    free[i] = 0;
    remaining -= most[i]!;
    const cBase = frame * maxSize;
    const oBase = frame * frameOptStride;
    cliqueBuf[cBase] = i;

    const a0 = adjStart[i]!;
    const a1 = adjStart[i + 1]!;
    let len0 = 0;
    for (let p = a0; p < a1; p++) {
      const nb = adj[p]!;
      if (free[nb]) optBuf[oBase + len0++] = nb;
    }

    const extend = (depth: number, optOff: number, optLen: number, lowVal: number, minIdx: number, maxIdx: number): void => {
      if (stopped || ++nodes > nodeLimit) { stopped = true; return; }
      if (depth >= minSize) {
        if (lowVal >= floor && standing[maxIdx]! - standing[minIdx]! <= band + uncertainty[minIdx]! + uncertainty[maxIdx]!) {
          const saved = remaining;
          for (let c = 1; c < depth; c++) {
            const k = cliqueBuf[cBase + c]!;
            free[k] = 0;
            remaining -= most[k]!;
          }
          search(i + 1, total + depth * lowVal, frame + 1);
          for (let c = 1; c < depth; c++) free[cliqueBuf[cBase + c]!] = 1;
          remaining = saved;
        }
      }
      if (depth >= maxSize || stopped || depth + optLen < minSize) return;
      const nextOff = optOff + n;
      for (let x = 0; x < optLen; x++) {
        const k = optBuf[optOff + x]!;
        if (!free[k]) continue;
        const kRow = k * n;
        let nextLow = lowVal;
        for (let c = 0; c < depth; c++) {
          const v = value[kRow + cliqueBuf[cBase + c]!]!;
          if (v < nextLow) nextLow = v;
        }
        const sk = standing[k]!;
        const ok = ordinal[k]!;
        const nextMin = (sk < standing[minIdx]! || (sk === standing[minIdx]! && ok < ordinal[minIdx]!)) ? k : minIdx;
        const nextMax = (sk > standing[maxIdx]! || (sk === standing[maxIdx]! && ok > ordinal[maxIdx]!)) ? k : maxIdx;
        let nextLen = 0;
        for (let y = x + 1; y < optLen; y++) {
          const o = optBuf[optOff + y]!;
          if (value[kRow + o]! >= 0) optBuf[nextOff + nextLen++] = o;
        }
        cliqueBuf[cBase + depth] = k;
        extend(depth + 1, nextOff, nextLen, nextLow, nextMin, nextMax);
        if (stopped) return;
      }
    };

    if (len0 + 1 >= minSize) extend(1, oBase, len0, 0x7fffffff, i, i);
    search(i + 1, total, frame + 1);
    free[i] = 1;
    remaining += most[i]!;
  };

  search(0, 0, 0);
  return { value: best, exact: !stopped, nodes };
}
