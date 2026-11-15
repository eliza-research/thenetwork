// GENERATED from spec/slopAssignment.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Assign a date proposal without filling a member’s inbox / Assignment opens each configured round once in order (spec/slopAssignment.md:9) */
export type AssignmentPhase = "NotConfigured" | "BetweenRounds" | "InRound" | "Finished";
/** Story: Assign a date proposal without filling a member’s inbox / Assignment opens each configured round once in order (spec/slopAssignment.md:9) */
export interface AssignmentRun { phase: AssignmentPhase; round: number; totalRounds: number; baseRounds: number; proposed: number; usedPairs: Record<string, boolean>; usedInRound: Record<string, boolean>; memberCounts: Record<string, number> }

/** One variant per transition in the spec. */
export type Event =
  | { type: "configureAssignment"; totalRounds: number; baseRounds: number }
  | { type: "openRound" }
  | { type: "closeRound" }
  | { type: "reservePair"; pairKey: string; memberA: string; memberB: string; withinBackupDegree: boolean };

/** Story: Assign a date proposal without filling a member’s inbox / Assignment opens each configured round once in order (spec/slopAssignment.md:9) */
export const initial: AssignmentRun = { phase: "NotConfigured", round: 0, totalRounds: 0, baseRounds: 0, proposed: 0, usedPairs: ({} as Record<string, boolean>), usedInRound: ({} as Record<string, boolean>), memberCounts: ({} as Record<string, number>) };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: AssignmentRun): boolean {
  return alwaysRoundWithinAllocation(current) && alwaysProposalCountIsNonnegative(current);
}

/** Story: Assign a date proposal without filling a member’s inbox / Assignment opens each configured round once in order (spec/slopAssignment.md:9) */
//@ pure
export function configureAssignment(s: AssignmentRun, totalRounds: number, baseRounds: number): AssignmentRun {
  //@ ensures (inv(s) && canConfigureAssignment(s, totalRounds, baseRounds)) ==> alwaysRoundWithinAllocation(\result)
  //@ ensures (inv(s) && canConfigureAssignment(s, totalRounds, baseRounds)) ==> alwaysProposalCountIsNonnegative(\result)
  //@ ensures (inv(s) && canConfigureAssignment(s, totalRounds, baseRounds)) ==> stepOnlyOpeningAdvancesRound(s, "configureAssignment", \result)
  //@ ensures (inv(s) && canConfigureAssignment(s, totalRounds, baseRounds)) ==> stepOnlyReservationCountsProposal(s, "configureAssignment", \result)
  //@ ensures (inv(s) && canConfigureAssignment(s, totalRounds, baseRounds)) ==> stepFinishedStaysFinished(s, \result)
  return { ...s, totalRounds: totalRounds, baseRounds: baseRounds, phase: totalRounds === 0 ? "Finished" : "BetweenRounds" };
}

/** Story: Assign a date proposal without filling a member’s inbox / Assignment opens each configured round once in order (spec/slopAssignment.md:9) */
//@ pure
export function canOpenRound(s: AssignmentRun): boolean {
  return s.phase === "BetweenRounds" && s.round < s.totalRounds;
}

/** Story: Assign a date proposal without filling a member’s inbox / Assignment opens each configured round once in order (spec/slopAssignment.md:9) */
//@ pure
export function openRound(s: AssignmentRun): AssignmentRun {
  //@ ensures (inv(s) && canOpenRound(s)) ==> alwaysRoundWithinAllocation(\result)
  //@ ensures (inv(s) && canOpenRound(s)) ==> alwaysProposalCountIsNonnegative(\result)
  //@ ensures (inv(s) && canOpenRound(s)) ==> stepOnlyOpeningAdvancesRound(s, "openRound", \result)
  //@ ensures (inv(s) && canOpenRound(s)) ==> stepOnlyReservationCountsProposal(s, "openRound", \result)
  //@ ensures (inv(s) && canOpenRound(s)) ==> stepFinishedStaysFinished(s, \result)
  return { ...s, phase: "InRound", round: s.round + 1, usedInRound: ({} as Record<string, boolean>) };
}

/** Story: Assign a date proposal without filling a member’s inbox / Assignment opens each configured round once in order (spec/slopAssignment.md:9) */
//@ pure
export function canCloseRound(s: AssignmentRun): boolean {
  return s.phase === "InRound";
}

/** Story: Assign a date proposal without filling a member’s inbox / Assignment opens each configured round once in order (spec/slopAssignment.md:9) */
//@ pure
export function closeRound(s: AssignmentRun): AssignmentRun {
  //@ ensures (inv(s) && canCloseRound(s)) ==> alwaysRoundWithinAllocation(\result)
  //@ ensures (inv(s) && canCloseRound(s)) ==> alwaysProposalCountIsNonnegative(\result)
  //@ ensures (inv(s) && canCloseRound(s)) ==> stepOnlyOpeningAdvancesRound(s, "closeRound", \result)
  //@ ensures (inv(s) && canCloseRound(s)) ==> stepOnlyReservationCountsProposal(s, "closeRound", \result)
  //@ ensures (inv(s) && canCloseRound(s)) ==> stepFinishedStaysFinished(s, \result)
  return { ...s, phase: s.round === s.totalRounds ? "Finished" : "BetweenRounds" };
}

/** Story: Assign a date proposal without filling a member’s inbox / Assignment opens each configured round once in order (spec/slopAssignment.md:9) */
//@ pure
export function alwaysRoundWithinAllocation(s: AssignmentRun): boolean {
  return s.round >= 0 && s.round <= s.totalRounds && s.baseRounds >= 0 && s.baseRounds <= s.totalRounds && (!(s.phase === "NotConfigured") || s.round === 0) && (!(s.phase === "BetweenRounds") || s.round < s.totalRounds) && (!(s.phase === "InRound") || s.round > 0) && (!(s.phase === "Finished") || s.round === s.totalRounds);
}

/** Story: Assign a date proposal without filling a member’s inbox / Assignment opens each configured round once in order (spec/slopAssignment.md:9) */
//@ pure
export function stepOnlyOpeningAdvancesRound(before: AssignmentRun, via: string, after: AssignmentRun): boolean {
  return via === "openRound" ? after.round === before.round + 1 : after.round === before.round;
}

/** Story: Assign a date proposal without filling a member’s inbox / Assignment opens each configured round once in order (spec/slopAssignment.md:9) */
//@ pure
export function canConfigureAssignment(s: AssignmentRun, totalRounds: number, baseRounds: number): boolean {
  return s.phase === "NotConfigured" && totalRounds >= 0 && baseRounds >= 0 && baseRounds <= totalRounds;
}

/** Story: Assign a date proposal without filling a member’s inbox / Each pair can be reserved once and each member can participate once per round (spec/slopAssignment.md:52) */
//@ pure
export function isMarked(flags: Record<string, boolean>, key: string): boolean {
  return lookup0_slopAssignment(flags, key, false);
}

/** Story: Assign a date proposal without filling a member’s inbox / Each pair can be reserved once and each member can participate once per round (spec/slopAssignment.md:52) */
//@ pure
export function memberCount(counts: Record<string, number>, member: string): number {
  return lookup1_slopAssignment(counts, member, 0);
}

/** Story: Assign a date proposal without filling a member’s inbox / Each pair can be reserved once and each member can participate once per round (spec/slopAssignment.md:52) */
//@ pure
export function canReservePair(s: AssignmentRun, pairKey: string, memberA: string, memberB: string, withinBackupDegree: boolean): boolean {
  return s.phase === "InRound" && !isMarked(s.usedPairs, pairKey) && !isMarked(s.usedInRound, memberA) && !isMarked(s.usedInRound, memberB) && memberCount(s.memberCounts, memberA) < s.round && memberCount(s.memberCounts, memberB) < s.round && (s.round <= s.baseRounds || withinBackupDegree);
}

/** Story: Assign a date proposal without filling a member’s inbox / Each pair can be reserved once and each member can participate once per round (spec/slopAssignment.md:52) */
//@ pure
export function incrementMember(counts: Record<string, number>, member: string): Record<string, number> {
  return { ...counts, ["$" + member]: memberCount(counts, member) + 1 };
}

/** Story: Assign a date proposal without filling a member’s inbox / Each pair can be reserved once and each member can participate once per round (spec/slopAssignment.md:52) */
//@ pure
export function alwaysProposalCountIsNonnegative(s: AssignmentRun): boolean {
  return s.proposed >= 0;
}

/** Story: Assign a date proposal without filling a member’s inbox / Each pair can be reserved once and each member can participate once per round (spec/slopAssignment.md:52) */
//@ pure
export function stepOnlyReservationCountsProposal(before: AssignmentRun, via: string, after: AssignmentRun): boolean {
  return via === "reservePair" ? after.proposed === before.proposed + 1 : after.proposed === before.proposed;
}

/** Story: Assign a date proposal without filling a member’s inbox / Each pair can be reserved once and each member can participate once per round (spec/slopAssignment.md:52) */
//@ pure
export function stepFinishedStaysFinished(before: AssignmentRun, after: AssignmentRun): boolean {
  return !(before.phase === "Finished") || after.phase === "Finished";
}

/** Story: Assign a date proposal without filling a member’s inbox / Each pair can be reserved once and each member can participate once per round (spec/slopAssignment.md:52) */
//@ pure
export function sometimesAssigned(s: AssignmentRun): boolean {
  return s.proposed > 0;
}

/** Story: Assign a date proposal without filling a member’s inbox / Each pair can be reserved once and each member can participate once per round (spec/slopAssignment.md:52) */
//@ pure
export function sometimesBackupRound(s: AssignmentRun): boolean {
  return s.phase === "InRound" && s.round > s.baseRounds;
}

/** Story: Assign a date proposal without filling a member’s inbox / Each pair can be reserved once and each member can participate once per round (spec/slopAssignment.md:52) */
//@ pure
export function reservePair(s: AssignmentRun, pairKey: string, memberA: string, memberB: string, withinBackupDegree: boolean): AssignmentRun {
  //@ ensures (inv(s) && canReservePair(s, pairKey, memberA, memberB, withinBackupDegree)) ==> alwaysRoundWithinAllocation(\result)
  //@ ensures (inv(s) && canReservePair(s, pairKey, memberA, memberB, withinBackupDegree)) ==> alwaysProposalCountIsNonnegative(\result)
  //@ ensures (inv(s) && canReservePair(s, pairKey, memberA, memberB, withinBackupDegree)) ==> stepOnlyOpeningAdvancesRound(s, "reservePair", \result)
  //@ ensures (inv(s) && canReservePair(s, pairKey, memberA, memberB, withinBackupDegree)) ==> stepOnlyReservationCountsProposal(s, "reservePair", \result)
  //@ ensures (inv(s) && canReservePair(s, pairKey, memberA, memberB, withinBackupDegree)) ==> stepFinishedStaysFinished(s, \result)
  const withFirst: Record<string, number> = incrementMember(s.memberCounts, memberA);
  return { ...s, proposed: s.proposed + 1, usedPairs: { ...s.usedPairs, ["$" + pairKey]: true }, usedInRound: { ...{ ...s.usedInRound, ["$" + memberA]: true }, ["$" + memberB]: true }, memberCounts: incrementMember(withFirst, memberB) };
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: AssignmentRun, event: Event): boolean {
  if (event.type === "configureAssignment") return canConfigureAssignment(current, event.totalRounds, event.baseRounds);
  if (event.type === "openRound") return canOpenRound(current);
  if (event.type === "closeRound") return canCloseRound(current);
  if (event.type === "reservePair") return canReservePair(current, event.pairKey, event.memberA, event.memberB, event.withinBackupDegree);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: AssignmentRun, event: Event): AssignmentRun {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "configureAssignment" && canConfigureAssignment(current, event.totalRounds, event.baseRounds)) return configureAssignment(current, event.totalRounds, event.baseRounds);
  if (event.type === "openRound" && canOpenRound(current)) return openRound(current);
  if (event.type === "closeRound" && canCloseRound(current)) return closeRound(current);
  if (event.type === "reservePair" && canReservePair(current, event.pairKey, event.memberA, event.memberB, event.withinBackupDegree)) return reservePair(current, event.pairKey, event.memberA, event.memberB, event.withinBackupDegree);
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
  if (raw.type === "configureAssignment" && Number.isSafeInteger(raw.totalRounds) && Number.isSafeInteger(raw.baseRounds)) return { type: "configureAssignment", totalRounds: raw.totalRounds, baseRounds: raw.baseRounds };
  if (raw.type === "openRound") return { type: "openRound" };
  if (raw.type === "closeRound") return { type: "closeRound" };
  if (raw.type === "reservePair" && typeof raw.pairKey === "string" && typeof raw.memberA === "string" && typeof raw.memberB === "string" && typeof raw.withinBackupDegree === "boolean") return { type: "reservePair", pairKey: raw.pairKey, memberA: raw.memberA, memberB: raw.memberB, withinBackupDegree: raw.withinBackupDegree };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): AssignmentRun | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "NotConfigured" || raw.phase === "BetweenRounds" || raw.phase === "InRound" || raw.phase === "Finished") && Number.isSafeInteger(raw.round) && Number.isSafeInteger(raw.totalRounds) && Number.isSafeInteger(raw.baseRounds) && Number.isSafeInteger(raw.proposed) && typeof raw.usedPairs === "object" && raw.usedPairs !== null && !Array.isArray(raw.usedPairs) && Object.entries(raw.usedPairs).every(([k1, x1]: [string, any]) => k1.startsWith("$") && typeof x1 === "boolean") && typeof raw.usedInRound === "object" && raw.usedInRound !== null && !Array.isArray(raw.usedInRound) && Object.entries(raw.usedInRound).every(([k1, x1]: [string, any]) => k1.startsWith("$") && typeof x1 === "boolean") && typeof raw.memberCounts === "object" && raw.memberCounts !== null && !Array.isArray(raw.memberCounts) && Object.entries(raw.memberCounts).every(([k1, x1]: [string, any]) => k1.startsWith("$") && Number.isSafeInteger(x1)) && Object.keys(raw).length === 8)) return undefined;
  const parsed: AssignmentRun = ({ phase: raw.phase, round: raw.round, totalRounds: raw.totalRounds, baseRounds: raw.baseRounds, proposed: raw.proposed, usedPairs: Object.fromEntries(Object.entries(raw.usedPairs).map(([k1, x1]: [string, any]) => [k1, x1])), usedInRound: Object.fromEntries(Object.entries(raw.usedInRound).map(([k1, x1]: [string, any]) => [k1, x1])), memberCounts: Object.fromEntries(Object.entries(raw.memberCounts).map(([k1, x1]: [string, any]) => [k1, x1])) });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): AssignmentRun {
  //@ ensures inv(\result)
  return initial;
}

/** What a map holds for a key, or `otherwise` if it holds nothing for it. */
//@ pure
export function lookup0_slopAssignment(m: Record<string, boolean>, k: string, otherwise: boolean): boolean {
  const key = "$" + k;
  return key in m ? m[key] : otherwise;
}

/** What a map holds for a key, or `otherwise` if it holds nothing for it. */
//@ pure
export function lookup1_slopAssignment(m: Record<string, number>, k: string, otherwise: number): number {
  const key = "$" + k;
  return key in m ? m[key] : otherwise;
}
