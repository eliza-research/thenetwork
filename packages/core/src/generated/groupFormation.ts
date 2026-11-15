// GENERATED from spec/groupFormation.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Form a compatible group and keep eligible backups / Only eligible adults enter the group search (spec/groupFormation.md:9) */
export type FormationPhase = "AwaitingPool" | "Forming" | "PrimaryChosen" | "RankingAlternates" | "Finished";
/** Story: Form a compatible group and keep eligible backups / Only eligible adults enter the group search (spec/groupFormation.md:9) */
export interface Formation { phase: FormationPhase; hostRequired: boolean; primary: string[]; alternates: string[]; alternateLimit: number }

/** One variant per transition in the spec. */
export type Event =
  | { type: "startSearch"; forcedEligible: boolean; hostRequired: boolean }
  | { type: "choosePrimary"; members: string[]; meetsMinimum: boolean; hasHost: boolean }
  | { type: "openAlternates"; alternateLimit: number }
  | { type: "reserveAlternate"; member: string }
  | { type: "finishGroup" };

/** Story: Form a compatible group and keep eligible backups / Only eligible adults enter the group search (spec/groupFormation.md:9) */
export const initial: Formation = { phase: "AwaitingPool", hostRequired: false, primary: ([] as string[]), alternates: ([] as string[]), alternateLimit: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: Formation): boolean {
  return alwaysPrimaryRequiredAfterSearch(current) && alwaysAlternateLimitHolds(current);
}

/** Story: Form a compatible group and keep eligible backups / Only eligible adults enter the group search (spec/groupFormation.md:9) */
//@ pure
export function poolEligible(adult: boolean): boolean {
  return adult;
}

/** Story: Form a compatible group and keep eligible backups / Only eligible adults enter the group search (spec/groupFormation.md:9) */
//@ pure
export function extensionAllowed(alreadyIncluded: boolean, compatible: boolean): boolean {
  return !alreadyIncluded && compatible;
}

/** Story: Form a compatible group and keep eligible backups / Only eligible adults enter the group search (spec/groupFormation.md:9) */
//@ pure
export function canStartSearch(g: Formation, forcedEligible: boolean): boolean {
  return g.phase === "AwaitingPool" && forcedEligible;
}

/** Story: Form a compatible group and keep eligible backups / Only eligible adults enter the group search (spec/groupFormation.md:9) */
//@ pure
export function startSearch(g: Formation, forcedEligible: boolean, hostRequired: boolean): Formation {
  //@ ensures (inv(g) && canStartSearch(g, forcedEligible)) ==> alwaysPrimaryRequiredAfterSearch(\result)
  //@ ensures (inv(g) && canStartSearch(g, forcedEligible)) ==> alwaysAlternateLimitHolds(\result)
  //@ ensures (inv(g) && canStartSearch(g, forcedEligible)) ==> stepFinishedStaysFinished(g, \result)
  return { ...g, phase: "Forming", hostRequired: hostRequired };
}

/** Story: Form a compatible group and keep eligible backups / A primary group has a common place and meets its requirements (spec/groupFormation.md:32) */
//@ pure
export function groupLocationAllowed(hasOverlap: boolean, requiresCity: boolean, matchingCity: boolean): boolean {
  return hasOverlap && (!requiresCity || matchingCity);
}

/** Story: Form a compatible group and keep eligible backups / A primary group has a common place and meets its requirements (spec/groupFormation.md:32) */
//@ pure
export function groupFitAllowed(hasPairs: boolean, belowPairFloor: boolean): boolean {
  return !hasPairs || !belowPairFloor;
}

/** Story: Form a compatible group and keep eligible backups / A primary group has a common place and meets its requirements (spec/groupFormation.md:32) */
//@ pure
export function primaryAllowed(g: Formation, meetsMinimum: boolean, hasHost: boolean): boolean {
  return g.phase === "Forming" && meetsMinimum && (!g.hostRequired || hasHost);
}

/** Story: Form a compatible group and keep eligible backups / A primary group has a common place and meets its requirements (spec/groupFormation.md:32) */
//@ pure
export function choosePrimary(g: Formation, members: string[], meetsMinimum: boolean, hasHost: boolean): Formation {
  //@ ensures (inv(g) && canChoosePrimary(g, members, meetsMinimum, hasHost)) ==> alwaysPrimaryRequiredAfterSearch(\result)
  //@ ensures (inv(g) && canChoosePrimary(g, members, meetsMinimum, hasHost)) ==> alwaysAlternateLimitHolds(\result)
  //@ ensures (inv(g) && canChoosePrimary(g, members, meetsMinimum, hasHost)) ==> stepFinishedStaysFinished(g, \result)
  return { ...g, phase: "PrimaryChosen", primary: members };
}

/** Story: Form a compatible group and keep eligible backups / A primary group has a common place and meets its requirements (spec/groupFormation.md:32) */
//@ pure
export function alwaysPrimaryRequiredAfterSearch(g: Formation): boolean {
  return !(g.phase === "PrimaryChosen" || g.phase === "RankingAlternates" || g.phase === "Finished") || g.primary.length > 0;
}

/** Story: Form a compatible group and keep eligible backups / A primary group has a common place and meets its requirements (spec/groupFormation.md:32) */
//@ pure
export function canChoosePrimary(g: Formation, members: string[], meetsMinimum: boolean, hasHost: boolean): boolean {
  return members.length > 0 && primaryAllowed(g, meetsMinimum, hasHost);
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md:56) */
//@ pure
export function alternateAllowed(alreadyPrimary: boolean, compatible: boolean, sameCityOverlap: boolean): boolean {
  return !alreadyPrimary && compatible && sameCityOverlap;
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md:56) */
//@ pure
export function canOpenAlternates(g: Formation, alternateLimit: number): boolean {
  return g.phase === "PrimaryChosen" && alternateLimit >= 0;
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md:56) */
//@ pure
export function openAlternates(g: Formation, alternateLimit: number): Formation {
  //@ ensures (inv(g) && canOpenAlternates(g, alternateLimit)) ==> alwaysPrimaryRequiredAfterSearch(\result)
  //@ ensures (inv(g) && canOpenAlternates(g, alternateLimit)) ==> alwaysAlternateLimitHolds(\result)
  //@ ensures (inv(g) && canOpenAlternates(g, alternateLimit)) ==> stepFinishedStaysFinished(g, \result)
  return { ...g, phase: "RankingAlternates", alternateLimit: alternateLimit };
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md:56) */
//@ pure
export function canReserveAlternate(g: Formation, member: string): boolean {
  return g.phase === "RankingAlternates" && g.alternates.length < g.alternateLimit && !g.primary.includes(member);
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md:56) */
//@ pure
export function reserveAlternate(g: Formation, member: string): Formation {
  //@ ensures (inv(g) && canReserveAlternate(g, member)) ==> alwaysPrimaryRequiredAfterSearch(\result)
  //@ ensures (inv(g) && canReserveAlternate(g, member)) ==> alwaysAlternateLimitHolds(\result)
  //@ ensures (inv(g) && canReserveAlternate(g, member)) ==> stepFinishedStaysFinished(g, \result)
  return { ...g, alternates: [...g.alternates, member] };
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md:56) */
//@ pure
export function canFinishGroup(g: Formation): boolean {
  return g.phase === "RankingAlternates";
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md:56) */
//@ pure
export function finishGroup(g: Formation): Formation {
  //@ ensures (inv(g) && canFinishGroup(g)) ==> alwaysPrimaryRequiredAfterSearch(\result)
  //@ ensures (inv(g) && canFinishGroup(g)) ==> alwaysAlternateLimitHolds(\result)
  //@ ensures (inv(g) && canFinishGroup(g)) ==> stepFinishedStaysFinished(g, \result)
  return { ...g, phase: "Finished" };
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md:56) */
//@ pure
export function alwaysAlternateLimitHolds(g: Formation): boolean {
  return g.alternates.length <= g.alternateLimit && (!(g.phase === "AwaitingPool" || g.phase === "Forming" || g.phase === "PrimaryChosen") || g.alternates.length === 0);
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md:56) */
//@ pure
export function stepFinishedStaysFinished(before: Formation, after: Formation): boolean {
  return !(before.phase === "Finished") || after.phase === "Finished";
}

/** Story: Form a compatible group and keep eligible backups / An alternate can join the primary group in its city (spec/groupFormation.md:56) */
//@ pure
export function sometimesFinishedWithAlternate(g: Formation): boolean {
  return g.phase === "Finished" && g.alternates.length > 0;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: Formation, event: Event): boolean {
  if (event.type === "startSearch") return canStartSearch(current, event.forcedEligible);
  if (event.type === "choosePrimary") return canChoosePrimary(current, event.members, event.meetsMinimum, event.hasHost);
  if (event.type === "openAlternates") return canOpenAlternates(current, event.alternateLimit);
  if (event.type === "reserveAlternate") return canReserveAlternate(current, event.member);
  if (event.type === "finishGroup") return canFinishGroup(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: Formation, event: Event): Formation {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "startSearch" && canStartSearch(current, event.forcedEligible)) return startSearch(current, event.forcedEligible, event.hostRequired);
  if (event.type === "choosePrimary" && canChoosePrimary(current, event.members, event.meetsMinimum, event.hasHost)) return choosePrimary(current, event.members, event.meetsMinimum, event.hasHost);
  if (event.type === "openAlternates" && canOpenAlternates(current, event.alternateLimit)) return openAlternates(current, event.alternateLimit);
  if (event.type === "reserveAlternate" && canReserveAlternate(current, event.member)) return reserveAlternate(current, event.member);
  if (event.type === "finishGroup" && canFinishGroup(current)) return finishGroup(current);
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
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "startSearch" && typeof raw.forcedEligible === "boolean" && typeof raw.hostRequired === "boolean") return { type: "startSearch", forcedEligible: raw.forcedEligible, hostRequired: raw.hostRequired };
  if (raw.type === "choosePrimary" && Array.isArray(raw.members) && raw.members.every((x0: any) => typeof x0 === "string") && typeof raw.meetsMinimum === "boolean" && typeof raw.hasHost === "boolean") return { type: "choosePrimary", members: raw.members.map((x0: any) => x0), meetsMinimum: raw.meetsMinimum, hasHost: raw.hasHost };
  if (raw.type === "openAlternates" && Number.isSafeInteger(raw.alternateLimit)) return { type: "openAlternates", alternateLimit: raw.alternateLimit };
  if (raw.type === "reserveAlternate" && typeof raw.member === "string") return { type: "reserveAlternate", member: raw.member };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingPool" || raw.phase === "Forming" || raw.phase === "PrimaryChosen" || raw.phase === "RankingAlternates" || raw.phase === "Finished") && typeof raw.hostRequired === "boolean" && Array.isArray(raw.primary) && raw.primary.every((x1: any) => typeof x1 === "string") && Array.isArray(raw.alternates) && raw.alternates.every((x1: any) => typeof x1 === "string") && Number.isSafeInteger(raw.alternateLimit) && Object.keys(raw).length === 5)) return undefined;
  const parsed: Formation = ({ phase: raw.phase, hostRequired: raw.hostRequired, primary: raw.primary.map((x1: any) => x1), alternates: raw.alternates.map((x1: any) => x1), alternateLimit: raw.alternateLimit });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): Formation {
  //@ ensures inv(\result)
  return initial;
}
