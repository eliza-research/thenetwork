// GENERATED from spec/groupFormation.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Form a compatible group and keep eligible backups / Only eligible adults enter the group search (spec/groupFormation.md) */
export type FormationPhase = "AwaitingPool" | "Forming" | "PrimaryChosen" | "RankingAlternates" | "Finished";
/** Story: Form a compatible group and keep eligible backups / Only eligible adults enter the group search (spec/groupFormation.md) */
export interface Formation { phase: FormationPhase; hostRequired: boolean; primary: string[]; alternates: string[]; alternateLimit: number; circle: CircleEvidence; circleLimits: CircleLimits }
/** Story: Form a compatible group and keep eligible backups / A primary circle values every pair and keeps a narrow standing spread (spec/groupFormation.md) */
export interface CircleEvidence { size: number; lowestPairValue: number; pairValueTotal: number; pairCount: number; standingLow: number; standingHigh: number; uncertaintyTotal: number }
/** Story: Form a compatible group and keep eligible backups / A primary circle values every pair and keeps a narrow standing spread (spec/groupFormation.md) */
export interface CircleLimits { minimum: number; maximum: number; pairFloor: number; parityBand: number }

/** One variant per transition in the spec. */
export type Event =
  | { type: "startSearch"; forcedEligible: boolean; hostRequired: boolean }
  | { type: "choosePrimary"; members: string[]; meetsMinimum: boolean; hasHost: boolean; circle: CircleEvidence; circleLimits: CircleLimits }
  | { type: "openAlternates"; alternateLimit: number }
  | { type: "reserveAlternate"; member: string; compatible: boolean; sameCityOverlap: boolean; pairedWithReserved: boolean }
  | { type: "finishGroup" };

/** Story: Form a compatible group and keep eligible backups / A member's share of a circle is highest when the circle is a clique (spec/groupFormation.md) */
export const circleShareScale: number = 1000;
/** Story: Form a compatible group and keep eligible backups / Only eligible adults enter the group search (spec/groupFormation.md) */
export const initial: Formation = { phase: "AwaitingPool", hostRequired: false, primary: ([] as string[]), alternates: ([] as string[]), alternateLimit: 0, circle: ({ size: 0, lowestPairValue: 0, pairValueTotal: 0, pairCount: 0, standingLow: 0, standingHigh: 0, uncertaintyTotal: 0 } as CircleEvidence), circleLimits: ({ minimum: 0, maximum: 0, pairFloor: 0, parityBand: 0 } as CircleLimits) };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: Formation): boolean {
  return alwaysPrimaryRequiredAfterSearch(current) && alwaysPrimaryCircleCoherent(current) && alwaysAlternateLimitHolds(current);
}

/** Story: Form a compatible group and keep eligible backups / Only eligible adults enter the group search (spec/groupFormation.md) */
//@ pure
export function poolEligible(adult: boolean): boolean {
  return adult;
}

/** Story: Form a compatible group and keep eligible backups / Only eligible adults enter the group search (spec/groupFormation.md) */
//@ pure
export function extensionAllowed(alreadyIncluded: boolean, compatible: boolean): boolean {
  return !alreadyIncluded && compatible;
}

/** Story: Form a compatible group and keep eligible backups / Only eligible adults enter the group search (spec/groupFormation.md) */
//@ pure
export function startSearch(g: Formation, forcedEligible: boolean, hostRequired: boolean): Formation {
  //@ ensures (inv(g) && canStartSearch(g, forcedEligible)) ==> alwaysPrimaryRequiredAfterSearch(\result)
  //@ ensures (inv(g) && canStartSearch(g, forcedEligible)) ==> alwaysPrimaryCircleCoherent(\result)
  //@ ensures (inv(g) && canStartSearch(g, forcedEligible)) ==> alwaysAlternateLimitHolds(\result)
  //@ ensures (inv(g) && canStartSearch(g, forcedEligible)) ==> stepFinishedStaysFinished(g, \result)
  return { ...g, phase: "Forming", hostRequired: hostRequired };
}

/** Story: Form a compatible group and keep eligible backups / Only eligible adults enter the group search (spec/groupFormation.md) */
//@ pure
export function canStartSearch(g: Formation, forcedEligible: boolean): boolean {
  return g.phase === "AwaitingPool" && forcedEligible;
}

/** Story: Form a compatible group and keep eligible backups / A primary group has a common place and meets its requirements (spec/groupFormation.md) */
//@ pure
export function groupLocationAllowed(hasOverlap: boolean, requiresCity: boolean, matchingCity: boolean): boolean {
  return hasOverlap && (!requiresCity || matchingCity);
}

/** Story: Form a compatible group and keep eligible backups / A primary group has a common place and meets its requirements (spec/groupFormation.md) */
//@ pure
export function groupFitAllowed(hasPairs: boolean, belowPairFloor: boolean): boolean {
  return !hasPairs || !belowPairFloor;
}

/** Story: Form a compatible group and keep eligible backups / A primary group has a common place and meets its requirements (spec/groupFormation.md) */
//@ pure
export function primaryAllowed(g: Formation, meetsMinimum: boolean, hasHost: boolean): boolean {
  return g.phase === "Forming" && meetsMinimum && (!g.hostRequired || hasHost);
}

/** Story: Form a compatible group and keep eligible backups / A primary group has a common place and meets its requirements (spec/groupFormation.md) */
//@ pure
export function choosePrimary(g: Formation, members: string[], meetsMinimum: boolean, hasHost: boolean, circle: CircleEvidence, circleLimits: CircleLimits): Formation {
  //@ ensures (inv(g) && canChoosePrimary(g, members, meetsMinimum, hasHost, circle, circleLimits)) ==> alwaysPrimaryRequiredAfterSearch(\result)
  //@ ensures (inv(g) && canChoosePrimary(g, members, meetsMinimum, hasHost, circle, circleLimits)) ==> alwaysPrimaryCircleCoherent(\result)
  //@ ensures (inv(g) && canChoosePrimary(g, members, meetsMinimum, hasHost, circle, circleLimits)) ==> alwaysAlternateLimitHolds(\result)
  //@ ensures (inv(g) && canChoosePrimary(g, members, meetsMinimum, hasHost, circle, circleLimits)) ==> stepFinishedStaysFinished(g, \result)
  return { ...g, phase: "PrimaryChosen", primary: members, circle: circle, circleLimits: circleLimits };
}

/** Story: Form a compatible group and keep eligible backups / A primary group has a common place and meets its requirements (spec/groupFormation.md) */
//@ pure
export function alwaysPrimaryRequiredAfterSearch(g: Formation): boolean {
  return !(g.phase === "PrimaryChosen" || g.phase === "RankingAlternates" || g.phase === "Finished") || g.primary.length > 0;
}

/** Story: Form a compatible group and keep eligible backups / A primary group has a common place and meets its requirements (spec/groupFormation.md) */
//@ pure
export function canChoosePrimary(g: Formation, members: string[], meetsMinimum: boolean, hasHost: boolean, circle: CircleEvidence, circleLimits: CircleLimits): boolean {
  return members.length > 0 && circle.size === members.length && circleCoherent(circle, circleLimits.minimum, circleLimits.maximum, circleLimits.pairFloor, circleLimits.parityBand) && primaryAllowed(g, meetsMinimum, hasHost);
}

/** Story: Form a compatible group and keep eligible backups / A primary circle values every pair and keeps a narrow standing spread (spec/groupFormation.md) */
//@ pure
export function circleCoherent(e: CircleEvidence, minimum: number, maximum: number, pairFloor: number, parityBand: number): boolean {
  return e.size >= 1 && minimum <= e.size && e.size <= maximum && e.pairCount === quotient_groupFormation(exact_groupFormation(e.size * exact_groupFormation(e.size - 1)), 2) && (e.pairCount === 0 || (e.lowestPairValue >= 0 && e.lowestPairValue >= pairFloor && e.pairValueTotal >= exact_groupFormation(pairFloor * e.pairCount))) && e.uncertaintyTotal >= 0 && e.standingLow <= e.standingHigh && exact_groupFormation(e.standingHigh - e.standingLow) <= exact_groupFormation(parityBand + e.uncertaintyTotal);
}

/** Story: Form a compatible group and keep eligible backups / A primary circle values every pair and keeps a narrow standing spread (spec/groupFormation.md) */
//@ pure
export function alwaysPrimaryCircleCoherent(g: Formation): boolean {
  return !(g.phase === "PrimaryChosen" || g.phase === "RankingAlternates" || g.phase === "Finished") || (g.circle.size === g.primary.length && circleCoherent(g.circle, g.circleLimits.minimum, g.circleLimits.maximum, g.circleLimits.pairFloor, g.circleLimits.parityBand));
}

/** Story: Form a compatible group and keep eligible backups / A primary circle values every pair and keeps a narrow standing spread (spec/groupFormation.md) */
//@ pure
export function sometimesPairCircleChosen(g: Formation): boolean {
  return g.phase === "PrimaryChosen" && g.circle.size === 2;
}

/** Story: Form a compatible group and keep eligible backups / A member's share of a circle is highest when the circle is a clique (spec/groupFormation.md) */
//@ pure
export function circleMemberShare(neighbours: number, circleSize: number): number {
  const local_0 = neighbours < 0 ? 0 : (neighbours > exact_groupFormation(circleSize - 1) ? exact_groupFormation(circleSize - 1) : neighbours);
  return circleSize <= 0 ? 0 : quotient_groupFormation(exact_groupFormation(circleShareScale * local_0), circleSize);
}

/** Story: Form a compatible group and keep eligible backups / A member's share of a circle is highest when the circle is a clique (spec/groupFormation.md) */
//@ pure
export function lawCliqueShareIsHighest(neighbours: number, circleSize: number): boolean {
  //@ ensures \result === true
  return circleMemberShare(neighbours, circleSize) <= circleMemberShare(exact_groupFormation(circleSize - 1), circleSize);
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md) */
//@ pure
export function alternateAllowed(alreadyPrimary: boolean, compatible: boolean, sameCityOverlap: boolean): boolean {
  return !alreadyPrimary && compatible && sameCityOverlap;
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md) */
//@ pure
export function canOpenAlternates(g: Formation, alternateLimit: number): boolean {
  return g.phase === "PrimaryChosen" && alternateLimit >= 0;
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md) */
//@ pure
export function openAlternates(g: Formation, alternateLimit: number): Formation {
  //@ ensures (inv(g) && canOpenAlternates(g, alternateLimit)) ==> alwaysPrimaryRequiredAfterSearch(\result)
  //@ ensures (inv(g) && canOpenAlternates(g, alternateLimit)) ==> alwaysPrimaryCircleCoherent(\result)
  //@ ensures (inv(g) && canOpenAlternates(g, alternateLimit)) ==> alwaysAlternateLimitHolds(\result)
  //@ ensures (inv(g) && canOpenAlternates(g, alternateLimit)) ==> stepFinishedStaysFinished(g, \result)
  return { ...g, phase: "RankingAlternates", alternateLimit: alternateLimit };
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md) */
//@ pure
export function canReserveAlternate(g: Formation, member: string, compatible: boolean, sameCityOverlap: boolean, pairedWithReserved: boolean): boolean {
  return g.phase === "RankingAlternates" && g.alternates.length < g.alternateLimit && !g.alternates.includes(member) && alternateAllowed(g.primary.includes(member), compatible && pairedWithReserved, sameCityOverlap);
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md) */
//@ pure
export function reserveAlternate(g: Formation, member: string, compatible: boolean, sameCityOverlap: boolean, pairedWithReserved: boolean): Formation {
  //@ ensures (inv(g) && canReserveAlternate(g, member, compatible, sameCityOverlap, pairedWithReserved)) ==> alwaysPrimaryRequiredAfterSearch(\result)
  //@ ensures (inv(g) && canReserveAlternate(g, member, compatible, sameCityOverlap, pairedWithReserved)) ==> alwaysPrimaryCircleCoherent(\result)
  //@ ensures (inv(g) && canReserveAlternate(g, member, compatible, sameCityOverlap, pairedWithReserved)) ==> alwaysAlternateLimitHolds(\result)
  //@ ensures (inv(g) && canReserveAlternate(g, member, compatible, sameCityOverlap, pairedWithReserved)) ==> stepFinishedStaysFinished(g, \result)
  return { ...g, alternates: g.alternates.concat([member]) };
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md) */
//@ pure
export function canFinishGroup(g: Formation): boolean {
  return g.phase === "RankingAlternates";
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md) */
//@ pure
export function finishGroup(g: Formation): Formation {
  //@ ensures (inv(g) && canFinishGroup(g)) ==> alwaysPrimaryRequiredAfterSearch(\result)
  //@ ensures (inv(g) && canFinishGroup(g)) ==> alwaysPrimaryCircleCoherent(\result)
  //@ ensures (inv(g) && canFinishGroup(g)) ==> alwaysAlternateLimitHolds(\result)
  //@ ensures (inv(g) && canFinishGroup(g)) ==> stepFinishedStaysFinished(g, \result)
  return { ...g, phase: "Finished" };
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md) */
//@ pure
export function alwaysAlternateLimitHolds(g: Formation): boolean {
  return g.alternates.length <= g.alternateLimit && (!(g.phase === "AwaitingPool" || g.phase === "Forming" || g.phase === "PrimaryChosen") || g.alternates.length === 0);
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md) */
//@ pure
export function stepFinishedStaysFinished(before: Formation, after: Formation): boolean {
  return !(before.phase === "Finished") || after.phase === "Finished";
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md) */
//@ pure
export function sometimesFinishedWithAlternate(g: Formation): boolean {
  return g.phase === "Finished" && g.alternates.length > 0;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: Formation, event: Event): boolean {
  if (event.type === "startSearch") return canStartSearch(current, event.forcedEligible);
  if (event.type === "choosePrimary") return canChoosePrimary(current, event.members, event.meetsMinimum, event.hasHost, event.circle, event.circleLimits);
  if (event.type === "openAlternates") return canOpenAlternates(current, event.alternateLimit);
  if (event.type === "reserveAlternate") return canReserveAlternate(current, event.member, event.compatible, event.sameCityOverlap, event.pairedWithReserved);
  if (event.type === "finishGroup") return canFinishGroup(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: Formation, event: Event): Formation {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "startSearch") return canStartSearch(current, event.forcedEligible) ? startSearch(current, event.forcedEligible, event.hostRequired) : current;
  if (event.type === "choosePrimary") return canChoosePrimary(current, event.members, event.meetsMinimum, event.hasHost, event.circle, event.circleLimits) ? choosePrimary(current, event.members, event.meetsMinimum, event.hasHost, event.circle, event.circleLimits) : current;
  if (event.type === "openAlternates") return canOpenAlternates(current, event.alternateLimit) ? openAlternates(current, event.alternateLimit) : current;
  if (event.type === "reserveAlternate") return canReserveAlternate(current, event.member, event.compatible, event.sameCityOverlap, event.pairedWithReserved) ? reserveAlternate(current, event.member, event.compatible, event.sameCityOverlap, event.pairedWithReserved) : current;
  if (event.type === "finishGroup") return canFinishGroup(current) ? finishGroup(current) : current;
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  const is_CircleEvidence = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && Number.isSafeInteger(v.size) && Number.isSafeInteger(v.lowestPairValue) && Number.isSafeInteger(v.pairValueTotal) && Number.isSafeInteger(v.pairCount) && Number.isSafeInteger(v.standingLow) && Number.isSafeInteger(v.standingHigh) && Number.isSafeInteger(v.uncertaintyTotal);
  const is_CircleLimits = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && Number.isSafeInteger(v.minimum) && Number.isSafeInteger(v.maximum) && Number.isSafeInteger(v.pairFloor) && Number.isSafeInteger(v.parityBand);
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "startSearch" && typeof raw.forcedEligible === "boolean" && typeof raw.hostRequired === "boolean") return { type: "startSearch", forcedEligible: raw.forcedEligible, hostRequired: raw.hostRequired };
  if (raw.type === "choosePrimary" && Array.isArray(raw.members) && raw.members.every((x0: any) => typeof x0 === "string") && typeof raw.meetsMinimum === "boolean" && typeof raw.hasHost === "boolean" && is_CircleEvidence(raw.circle) && is_CircleLimits(raw.circleLimits)) return { type: "choosePrimary", members: raw.members.map((x0: any) => x0), meetsMinimum: raw.meetsMinimum, hasHost: raw.hasHost, circle: ({ size: raw.circle.size, lowestPairValue: raw.circle.lowestPairValue, pairValueTotal: raw.circle.pairValueTotal, pairCount: raw.circle.pairCount, standingLow: raw.circle.standingLow, standingHigh: raw.circle.standingHigh, uncertaintyTotal: raw.circle.uncertaintyTotal }), circleLimits: ({ minimum: raw.circleLimits.minimum, maximum: raw.circleLimits.maximum, pairFloor: raw.circleLimits.pairFloor, parityBand: raw.circleLimits.parityBand }) };
  if (raw.type === "openAlternates" && Number.isSafeInteger(raw.alternateLimit)) return { type: "openAlternates", alternateLimit: raw.alternateLimit };
  if (raw.type === "reserveAlternate" && typeof raw.member === "string" && typeof raw.compatible === "boolean" && typeof raw.sameCityOverlap === "boolean" && typeof raw.pairedWithReserved === "boolean") return { type: "reserveAlternate", member: raw.member, compatible: raw.compatible, sameCityOverlap: raw.sameCityOverlap, pairedWithReserved: raw.pairedWithReserved };
  if (raw.type === "finishGroup") return { type: "finishGroup" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): Formation | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingPool" || raw.phase === "Forming" || raw.phase === "PrimaryChosen" || raw.phase === "RankingAlternates" || raw.phase === "Finished") && typeof raw.hostRequired === "boolean" && Array.isArray(raw.primary) && raw.primary.every((x1: any) => typeof x1 === "string") && Array.isArray(raw.alternates) && raw.alternates.every((x1: any) => typeof x1 === "string") && Number.isSafeInteger(raw.alternateLimit) && typeof raw.circle === "object" && raw.circle !== null && !Array.isArray(raw.circle) && Number.isSafeInteger(raw.circle.size) && Number.isSafeInteger(raw.circle.lowestPairValue) && Number.isSafeInteger(raw.circle.pairValueTotal) && Number.isSafeInteger(raw.circle.pairCount) && Number.isSafeInteger(raw.circle.standingLow) && Number.isSafeInteger(raw.circle.standingHigh) && Number.isSafeInteger(raw.circle.uncertaintyTotal) && Object.keys(raw.circle).length === 7 && typeof raw.circleLimits === "object" && raw.circleLimits !== null && !Array.isArray(raw.circleLimits) && Number.isSafeInteger(raw.circleLimits.minimum) && Number.isSafeInteger(raw.circleLimits.maximum) && Number.isSafeInteger(raw.circleLimits.pairFloor) && Number.isSafeInteger(raw.circleLimits.parityBand) && Object.keys(raw.circleLimits).length === 4 && Object.keys(raw).length === 7)) return undefined;
  const parsed: Formation = ({ phase: raw.phase, hostRequired: raw.hostRequired, primary: raw.primary.map((x1: any) => x1), alternates: raw.alternates.map((x1: any) => x1), alternateLimit: raw.alternateLimit, circle: ({ size: raw.circle.size, lowestPairValue: raw.circle.lowestPairValue, pairValueTotal: raw.circle.pairValueTotal, pairCount: raw.circle.pairCount, standingLow: raw.circle.standingLow, standingHigh: raw.circle.standingHigh, uncertaintyTotal: raw.circle.uncertaintyTotal }), circleLimits: ({ minimum: raw.circleLimits.minimum, maximum: raw.circleLimits.maximum, pairFloor: raw.circleLimits.pairFloor, parityBand: raw.circleLimits.parityBand }) });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): Formation {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_groupFormation(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Whole-number division as Quint does it: towards zero. */
//@ pure
export function quotient_groupFormation(a: number, b: number): number {
  //@ requires b !== 0
  if (b === 0) throw new RangeError(`${a} cannot be divided by zero`);
  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;
}
