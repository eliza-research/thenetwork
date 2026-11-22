// GENERATED from spec/candidateCache.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Keep cached candidates correct when members join / Candidates rank by value, then by canonical key (spec/candidateCache.md) */
export interface CacheRank { value: number; key: number }
/** Story: Keep cached candidates correct when members join / An offered candidate goes into the kept list, into the reserve, or outside (spec/candidateCache.md) */
export type CacheOfferPlace = "CacheIntoKept" | "CacheIntoReserve" | "CacheOutside" | "CacheNoPair";
/** Story: Repair cached candidates when members leave or change / Only a member whose stored list holds the removed member is affected (spec/candidateCache.md) */
export type CacheRepair = "CacheUntouched" | "CacheDropReserve" | "CacheRefill" | "CacheShort" | "CacheResearch";

/** Story: Keep cached candidates correct when members join / Candidates rank by value, then by canonical key (spec/candidateCache.md) */
export const cacheNothingOutside: CacheRank = { value: -1, key: -1 };

/** Story: Keep cached candidates correct when members join / Candidates rank by value, then by canonical key (spec/candidateCache.md) */
//@ pure
export function cacheRanksAbove(candidate: CacheRank, other: CacheRank): boolean {
  return candidate.value > other.value || (candidate.value === other.value && candidate.key < other.key);
}

/** Story: Keep cached candidates correct when members join / Candidates rank by value, then by canonical key (spec/candidateCache.md) */
//@ pure
export function lawCacheRankTotal(leftRank: CacheRank, rightRank: CacheRank): boolean {
  //@ ensures \result === true
  return !(leftRank.key !== rightRank.key) || (cacheRanksAbove(leftRank, rightRank) || cacheRanksAbove(rightRank, leftRank));
}

/** Story: Keep cached candidates correct when members join / Candidates rank by value, then by canonical key (spec/candidateCache.md) */
//@ pure
export function lawCacheRankAtOrBelowChains(leftRank: CacheRank, middleRank: CacheRank, rightRank: CacheRank): boolean {
  //@ ensures \result === true
  return !(!cacheRanksAbove(leftRank, middleRank) && !cacheRanksAbove(middleRank, rightRank)) || !cacheRanksAbove(leftRank, rightRank);
}

/** Story: Keep cached candidates correct when members join / Candidates rank by value, then by canonical key (spec/candidateCache.md) */
//@ pure
export function cacheHigherRank(left: CacheRank, right: CacheRank): CacheRank {
  return cacheRanksAbove(right, left) ? right : left;
}

/** Story: Keep cached candidates correct when members join / Candidates rank by value, then by canonical key (spec/candidateCache.md) */
//@ pure
export function cacheLowerRank(left: CacheRank, right: CacheRank): CacheRank {
  return cacheRanksAbove(left, right) ? right : left;
}

/** Story: Keep cached candidates correct when members join / An offered candidate goes into the kept list, into the reserve, or outside (spec/candidateCache.md) */
//@ pure
export function cacheReserveThreshold(reserveRoom: boolean, reserveWorst: CacheRank, cover: CacheRank): CacheRank {
  return reserveRoom ? cover : reserveWorst;
}

/** Story: Keep cached candidates correct when members join / An offered candidate goes into the kept list, into the reserve, or outside (spec/candidateCache.md) */
//@ pure
export function cacheOfferPlace(keptFull: boolean, kth: CacheRank, reserveThreshold: CacheRank, cover: CacheRank, x: CacheRank): CacheOfferPlace {
  return x.value < 0 ? "CacheNoPair" : (!keptFull ? (cacheRanksAbove(x, cover) ? "CacheIntoKept" : "CacheOutside") : (cacheRanksAbove(x, kth) ? "CacheIntoKept" : (cacheRanksAbove(x, reserveThreshold) ? "CacheIntoReserve" : "CacheOutside")));
}

/** Story: Keep cached candidates correct when members join / An offered candidate goes into the kept list, into the reserve, or outside (spec/candidateCache.md) */
//@ pure
export function lawCacheOfferKeepsTop(kth: CacheRank, otherKept: CacheRank, outside: CacheRank, reserveThreshold: CacheRank, cover: CacheRank, x: CacheRank): boolean {
  //@ ensures \result === true
  const local_0: CacheOfferPlace = cacheOfferPlace(true, kth, reserveThreshold, cover, x);
  return !(x.value >= 0 && x.key !== kth.key && x.key !== otherKept.key && cacheRanksAbove(otherKept, kth) && cacheRanksAbove(kth, cover) && !cacheRanksAbove(outside, cover)) || ((!(local_0 === "CacheIntoKept") || (cacheRanksAbove(x, kth) && cacheRanksAbove(x, outside) && cacheRanksAbove(otherKept, outside))) && (!(local_0 !== "CacheIntoKept") || (cacheRanksAbove(kth, x) && cacheRanksAbove(otherKept, x))));
}

/** Story: Keep cached candidates correct when members join / An offered candidate goes into the kept list, into the reserve, or outside (spec/candidateCache.md) */
//@ pure
export function lawCacheOfferFillsShortList(kth: CacheRank, otherKept: CacheRank, outside: CacheRank, reserveThreshold: CacheRank, cover: CacheRank, x: CacheRank): boolean {
  //@ ensures \result === true
  const local_1: CacheOfferPlace = cacheOfferPlace(false, kth, reserveThreshold, cover, x);
  return !(x.value >= 0 && x.key !== otherKept.key && cacheRanksAbove(otherKept, cover) && !cacheRanksAbove(outside, cover)) || ((!(local_1 === "CacheIntoKept") || (cacheRanksAbove(x, outside) && cacheRanksAbove(otherKept, outside))) && (!(local_1 !== "CacheIntoKept") || cacheRanksAbove(otherKept, x)));
}

/** Story: Keep cached candidates correct when members join / A member is untouched when a bound on the new value cannot rank above its worst kept entry (spec/candidateCache.md) */
//@ pure
export function cacheMemberMaySkip(keptFull: boolean, kth: CacheRank, boundRank: CacheRank): boolean {
  return boundRank.value < 0 || (keptFull && !cacheRanksAbove(boundRank, kth));
}

/** Story: Keep cached candidates correct when members join / A member is untouched when a bound on the new value cannot rank above its worst kept entry (spec/candidateCache.md) */
//@ pure
export function lawCacheMemberSkipSound(keptFull: boolean, kth: CacheRank, boundRank: CacheRank, reserveThreshold: CacheRank, cover: CacheRank, x: CacheRank): boolean {
  //@ ensures \result === true
  return !(cacheMemberMaySkip(keptFull, kth, boundRank) && x.value <= boundRank.value && x.key === boundRank.key) || cacheOfferPlace(keptFull, kth, reserveThreshold, cover, x) !== "CacheIntoKept";
}

/** Story: Keep cached candidates correct when members join / A member is untouched when a bound on the new value cannot rank above its worst kept entry (spec/candidateCache.md) */
//@ pure
export function lawCacheSkipCoverHoldsX(cover: CacheRank, boundRank: CacheRank, x: CacheRank): boolean {
  //@ ensures \result === true
  return !(x.value <= boundRank.value && x.key === boundRank.key) || !cacheRanksAbove(x, cacheHigherRank(cover, boundRank));
}

/** Story: Keep cached candidates correct when members join / A member is untouched when a bound on the new value cannot rank above its worst kept entry (spec/candidateCache.md) */
//@ pure
export function lawCacheSkipKeepsExact(kth: CacheRank, cover: CacheRank, boundRank: CacheRank): boolean {
  //@ ensures \result === true
  return !(cacheRanksAbove(kth, cover) && !cacheRanksAbove(boundRank, kth) && boundRank.key !== kth.key) || cacheRanksAbove(kth, cacheHigherRank(cover, boundRank));
}

/** Story: Keep cached candidates correct when members join / A group is untouched when its bound cannot rank above the lowest worst kept entry in the group (spec/candidateCache.md) */
//@ pure
export function cachePendingNeeded(boundRank: CacheRank): boolean {
  return boundRank.value >= 0;
}

/** Story: Keep cached candidates correct when members join / A group is untouched when its bound cannot rank above the lowest worst kept entry in the group (spec/candidateCache.md) */
//@ pure
export function lawCacheUnneededRaiseCoversNoOne(boundRank: CacheRank, outside: CacheRank): boolean {
  //@ ensures \result === true
  return !(!cachePendingNeeded(boundRank) && outside.value >= 0) || cacheRanksAbove(outside, boundRank);
}

/** Story: Keep cached candidates correct when members join / A group is untouched when its bound cannot rank above the lowest worst kept entry in the group (spec/candidateCache.md) */
//@ pure
export function cacheGroupMaySkip(notFull: number, groupFloor: CacheRank, boundRank: CacheRank): boolean {
  return boundRank.value < 0 || (notFull === 0 && !cacheRanksAbove(boundRank, groupFloor));
}

/** Story: Keep cached candidates correct when members join / A group is untouched when its bound cannot rank above the lowest worst kept entry in the group (spec/candidateCache.md) */
//@ pure
export function cachePendingKeeps(older: CacheRank, newer: CacheRank): boolean {
  return cacheRanksAbove(older, newer);
}

/** Story: Keep cached candidates correct when members join / A group is untouched when its bound cannot rank above the lowest worst kept entry in the group (spec/candidateCache.md) */
//@ pure
export function lawCacheGroupSkipSound(notFull: number, groupFloor: CacheRank, boundRank: CacheRank, keptFull: boolean, kth: CacheRank): boolean {
  //@ ensures \result === true
  return !(cacheGroupMaySkip(notFull, groupFloor, boundRank) && !cacheRanksAbove(groupFloor, kth) && (keptFull || notFull > 0)) || cacheMemberMaySkip(keptFull, kth, boundRank);
}

/** Story: Keep cached candidates correct when members join / A group is untouched when its bound cannot rank above the lowest worst kept entry in the group (spec/candidateCache.md) */
//@ pure
export function lawCacheLoweredFloorSkipSound(groupFloor: CacheRank, kth: CacheRank, boundRank: CacheRank): boolean {
  //@ ensures \result === true
  return !cacheGroupMaySkip(0, cacheLowerRank(groupFloor, kth), boundRank) || cacheMemberMaySkip(true, kth, boundRank);
}

/** Story: Keep cached candidates correct when members join / A group is untouched when its bound cannot rank above the lowest worst kept entry in the group (spec/candidateCache.md) */
//@ pure
export function lawCacheRaisedCoverStaysSound(cover: CacheRank, boundRank: CacheRank, outside: CacheRank): boolean {
  //@ ensures \result === true
  return !(!cacheRanksAbove(outside, cover)) || !cacheRanksAbove(outside, cacheHigherRank(cover, boundRank));
}

/** Story: Keep cached candidates correct when members join / A group is untouched when its bound cannot rank above the lowest worst kept entry in the group (spec/candidateCache.md) */
//@ pure
export function cacheEffectiveCover(ownCover: CacheRank, pendingCover: CacheRank, searchedSeq: number, pendingSeq: number): CacheRank {
  return pendingSeq > searchedSeq ? cacheHigherRank(ownCover, pendingCover) : ownCover;
}

/** Story: Keep cached candidates correct when members join / A group is untouched when its bound cannot rank above the lowest worst kept entry in the group (spec/candidateCache.md) */
//@ pure
export function lawCachePendingPruneSound(ownCover: CacheRank, older: CacheRank, newer: CacheRank, searchedSeq: number, olderSeq: number, newerSeq: number, outside: CacheRank): boolean {
  //@ ensures \result === true
  return !(olderSeq < newerSeq && !cachePendingKeeps(older, newer) && !cacheRanksAbove(outside, cacheEffectiveCover(cacheEffectiveCover(ownCover, older, searchedSeq, olderSeq), newer, searchedSeq, newerSeq))) || !cacheRanksAbove(outside, cacheEffectiveCover(ownCover, newer, searchedSeq, newerSeq));
}

/** Story: Keep cached candidates correct when members join / A group is untouched when its bound cannot rank above the lowest worst kept entry in the group (spec/candidateCache.md) */
//@ pure
export function lawCacheEffectiveCoverSound(ownCover: CacheRank, pendingCover: CacheRank, searchedSeq: number, pendingSeq: number, outside: CacheRank): boolean {
  //@ ensures \result === true
  const local_2: CacheRank = cacheEffectiveCover(ownCover, pendingCover, searchedSeq, pendingSeq);
  return (!(!cacheRanksAbove(outside, ownCover)) || !cacheRanksAbove(outside, local_2)) && (!(pendingSeq > searchedSeq && !cacheRanksAbove(outside, pendingCover)) || !cacheRanksAbove(outside, local_2));
}

/** Story: Repair cached candidates when members leave or change / Only a member whose stored list holds the removed member is affected (spec/candidateCache.md) */
//@ pure
export function cacheRemoveRepair(inKept: boolean, inReserve: boolean, hasReserve: boolean, reserveBest: CacheRank, cover: CacheRank): CacheRepair {
  return inKept ? (hasReserve && cacheRanksAbove(reserveBest, cover) ? "CacheRefill" : (!hasReserve && cover.value < 0 ? "CacheShort" : "CacheResearch")) : (inReserve ? "CacheDropReserve" : "CacheUntouched");
}

/** Story: Repair cached candidates when members leave or change / Only a member whose stored list holds the removed member is affected (spec/candidateCache.md) */
//@ pure
export function lawCacheRefillKeepsTop(hasReserve: boolean, reserveBest: CacheRank, cover: CacheRank, outside: CacheRank): boolean {
  //@ ensures \result === true
  return !(cacheRemoveRepair(true, false, hasReserve, reserveBest, cover) === "CacheRefill" && !cacheRanksAbove(outside, cover)) || cacheRanksAbove(reserveBest, outside);
}

/** Story: Repair cached candidates when members leave or change / Only a member whose stored list holds the removed member is affected (spec/candidateCache.md) */
//@ pure
export function lawCacheShortHoldsEveryone(hasReserve: boolean, reserveBest: CacheRank, cover: CacheRank, outside: CacheRank): boolean {
  //@ ensures \result === true
  return !(cacheRemoveRepair(true, false, hasReserve, reserveBest, cover) === "CacheShort" && outside.value >= 0) || cacheRanksAbove(outside, cover);
}

/** Story: Repair cached candidates when members leave or change / A profile change is a removal and then an insertion with a new version (spec/candidateCache.md) */
//@ pure
export function cacheNextVersion(version: number): number {
  return exact_candidateCache(version + 1);
}

/** Story: Repair cached candidates when members leave or change / A stored edge is valid only when both profile versions match (spec/candidateCache.md) */
//@ pure
export function cacheEdgeValid(searchedVersion: number, searcherVersion: number, storedVersion: number, partnerVersion: number): boolean {
  return searchedVersion === searcherVersion && storedVersion === partnerVersion;
}

/** Story: Repair cached candidates when members leave or change / A stored edge is valid only when both profile versions match (spec/candidateCache.md) */
//@ pure
export function lawCacheChangeRefusesOnlyOldEdges(searchedVersion: number, searcherVersion: number, storedVersion: number, partnerVersion: number): boolean {
  //@ ensures \result === true
  return !(storedVersion <= partnerVersion) || (!cacheEdgeValid(searchedVersion, searcherVersion, storedVersion, cacheNextVersion(partnerVersion)) && (!(searchedVersion === searcherVersion) || cacheEdgeValid(searchedVersion, searcherVersion, cacheNextVersion(partnerVersion), cacheNextVersion(partnerVersion))));
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_candidateCache(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
