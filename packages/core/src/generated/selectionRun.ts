// GENERATED from spec/selectionRun.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md:9) */
export type SelectionPhase = "Exposure" | "Exploration" | "Greedy" | "Complete";
/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md:9) */
export interface SelectionRun { phase: SelectionPhase; selectedCount: number; selectedKeys: Record<string, boolean>; usedPairs: Record<string, boolean>; byCity: Record<string, number>; proactive: Record<string, number>; contribution: Record<string, number> }
/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md:37) */
export interface SelectionMember { id: string; unavailable: boolean; priorProactive: number; proactiveLimit: number; contributor: boolean; priorContribution: number; contributionLimit: number }
/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md:37) */
export interface SelectionChoice { candidateKey: string; city: string; cityLimit: number; members: SelectionMember[]; pairKeys: string[] }

/** One variant per transition in the spec. */
export type Event =
  | { type: "completeRun" }
  | { type: "beginExploration" }
  | { type: "beginGreedy" }
  | { type: "reserveSelection"; choice: SelectionChoice; timeFree: boolean; exploring: boolean };

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md:9) */
export const initial: SelectionRun = { phase: "Exposure", selectedCount: 0, selectedKeys: ({} as Record<string, boolean>), usedPairs: ({} as Record<string, boolean>), byCity: ({} as Record<string, number>), proactive: ({} as Record<string, number>), contribution: ({} as Record<string, number>) };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: SelectionRun): boolean {
  return alwaysSelectedCountIsNonnegative(current);
}

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md:9) */
//@ pure
export function canCompleteRun(s: SelectionRun): boolean {
  return s.phase === "Greedy";
}

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md:9) */
//@ pure
export function completeRun(s: SelectionRun): SelectionRun {
  //@ ensures (inv(s) && canCompleteRun(s)) ==> alwaysSelectedCountIsNonnegative(\result)
  //@ ensures (inv(s) && canCompleteRun(s)) ==> stepCompletedRunStaysClosed(s, \result)
  //@ ensures (inv(s) && canCompleteRun(s)) ==> stepOnlyReserveIncreasesSelections(s, "completeRun", \result)
  return { ...s, phase: "Complete" };
}

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md:9) */
//@ pure
export function stepCompletedRunStaysClosed(before: SelectionRun, after: SelectionRun): boolean {
  return !(before.phase === "Complete") || after.phase === "Complete";
}

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md:9) */
//@ pure
export function canBeginExploration(s: SelectionRun): boolean {
  return s.phase === "Exposure";
}

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md:9) */
//@ pure
export function beginExploration(s: SelectionRun): SelectionRun {
  //@ ensures (inv(s) && canBeginExploration(s)) ==> alwaysSelectedCountIsNonnegative(\result)
  //@ ensures (inv(s) && canBeginExploration(s)) ==> stepCompletedRunStaysClosed(s, \result)
  //@ ensures (inv(s) && canBeginExploration(s)) ==> stepOnlyReserveIncreasesSelections(s, "beginExploration", \result)
  return { ...s, phase: "Exploration" };
}

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md:9) */
//@ pure
export function canBeginGreedy(s: SelectionRun): boolean {
  return s.phase === "Exploration";
}

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md:9) */
//@ pure
export function beginGreedy(s: SelectionRun): SelectionRun {
  //@ ensures (inv(s) && canBeginGreedy(s)) ==> alwaysSelectedCountIsNonnegative(\result)
  //@ ensures (inv(s) && canBeginGreedy(s)) ==> stepCompletedRunStaysClosed(s, \result)
  //@ ensures (inv(s) && canBeginGreedy(s)) ==> stepOnlyReserveIncreasesSelections(s, "beginGreedy", \result)
  return { ...s, phase: "Greedy" };
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md:37) */
//@ pure
export function numberUsed(counts: Record<string, number>, key: string): number {
  return lookup0_selectionRun(counts, key, 0);
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md:37) */
//@ pure
export function selectedBefore(s: SelectionRun, candidateKey: string): boolean {
  const keyMap: Record<string, boolean> = s.selectedKeys;
  return lookup1_selectionRun(keyMap, candidateKey, false);
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md:37) */
//@ pure
export function pairAlreadyUsed(s: SelectionRun, pair: string): boolean {
  const keyMap: Record<string, boolean> = s.usedPairs;
  return lookup1_selectionRun(keyMap, pair, false);
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md:37) */
//@ pure
export function proactiveUsed(s: SelectionRun, id: string): number {
  return numberUsed(s.proactive, id);
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md:37) */
//@ pure
export function memberHasRoom(s: SelectionRun, m: SelectionMember): boolean {
  return !m.unavailable && !(m.priorProactive + proactiveUsed(s, m.id) + 1 > m.proactiveLimit) && (!m.contributor || !(m.priorContribution + numberUsed(s.contribution, m.id) + 1 > m.contributionLimit));
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md:37) */
//@ pure
export function choiceHasRoom(s: SelectionRun, choice: SelectionChoice): boolean {
  return s.phase !== "Complete" && !selectedBefore(s, choice.candidateKey) && !(numberUsed(s.byCity, choice.city) >= choice.cityLimit) && choice.members.every((m: SelectionMember) => memberHasRoom(s, m)) && choice.pairKeys.every((pair: string) => !pairAlreadyUsed(s, pair));
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md:37) */
//@ pure
export function canReserveSelection(s: SelectionRun, choice: SelectionChoice, timeFree: boolean, exploring: boolean): boolean {
  return timeFree && exploring === (s.phase === "Exploration") && choiceHasRoom(s, choice);
}

/** Story: Select compatible proposals within the run’s limits / Reserving a proposal consumes its slots together (spec/selectionRun.md:91) */
//@ pure
export function addUse(counts: Record<string, number>, key: string): Record<string, number> {
  return { ...counts, ["$" + key]: numberUsed(counts, key) + 1 };
}

/** Story: Select compatible proposals within the run’s limits / Reserving a proposal consumes its slots together (spec/selectionRun.md:91) */
//@ pure
export function alwaysSelectedCountIsNonnegative(s: SelectionRun): boolean {
  return s.selectedCount >= 0;
}

/** Story: Select compatible proposals within the run’s limits / Reserving a proposal consumes its slots together (spec/selectionRun.md:91) */
//@ pure
export function stepOnlyReserveIncreasesSelections(before: SelectionRun, via: string, after: SelectionRun): boolean {
  return via === "reserveSelection" ? after.selectedCount === before.selectedCount + 1 : after.selectedCount === before.selectedCount;
}

/** Story: Select compatible proposals within the run’s limits / Reserving a proposal consumes its slots together (spec/selectionRun.md:91) */
//@ pure
export function sometimesSelected(s: SelectionRun): boolean {
  return s.selectedCount > 0;
}

/** Story: Select compatible proposals within the run’s limits / Reserving a proposal consumes its slots together (spec/selectionRun.md:91) */
//@ pure
export function sometimesFinishedWithSelection(s: SelectionRun): boolean {
  return s.phase === "Complete" && s.selectedCount > 0;
}

/** Story: Select compatible proposals within the run’s limits / Reserving a proposal consumes its slots together (spec/selectionRun.md:91) */
//@ pure
export function reserveSelection(s: SelectionRun, choice: SelectionChoice, timeFree: boolean, exploring: boolean): SelectionRun {
  //@ ensures (inv(s) && canReserveSelection(s, choice, timeFree, exploring)) ==> alwaysSelectedCountIsNonnegative(\result)
  //@ ensures (inv(s) && canReserveSelection(s, choice, timeFree, exploring)) ==> stepCompletedRunStaysClosed(s, \result)
  //@ ensures (inv(s) && canReserveSelection(s, choice, timeFree, exploring)) ==> stepOnlyReserveIncreasesSelections(s, "reserveSelection", \result)
  const newPairs: Record<string, boolean> = choice.pairKeys.reduce((pairs: Record<string, boolean>, pair: string) => ({ ...pairs, ["$" + pair]: true }), s.usedPairs);
  const newProactive: Record<string, number> = choice.members.reduce((counts: Record<string, number>, m: SelectionMember) => addUse(counts, m.id), s.proactive);
  const newContribution: Record<string, number> = choice.members.reduce((counts: Record<string, number>, m: SelectionMember) => m.contributor ? addUse(counts, m.id) : counts, s.contribution);
  return { ...s, selectedCount: s.selectedCount + 1, selectedKeys: { ...s.selectedKeys, ["$" + choice.candidateKey]: true }, usedPairs: newPairs, byCity: addUse(s.byCity, choice.city), proactive: newProactive, contribution: newContribution };
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: SelectionRun, event: Event): boolean {
  if (event.type === "completeRun") return canCompleteRun(current);
  if (event.type === "beginExploration") return canBeginExploration(current);
  if (event.type === "beginGreedy") return canBeginGreedy(current);
  if (event.type === "reserveSelection") return canReserveSelection(current, event.choice, event.timeFree, event.exploring);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: SelectionRun, event: Event): SelectionRun {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "completeRun" && canCompleteRun(current)) return completeRun(current);
  if (event.type === "beginExploration" && canBeginExploration(current)) return beginExploration(current);
  if (event.type === "beginGreedy" && canBeginGreedy(current)) return beginGreedy(current);
  if (event.type === "reserveSelection" && canReserveSelection(current, event.choice, event.timeFree, event.exploring)) return reserveSelection(current, event.choice, event.timeFree, event.exploring);
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
  if (raw.type === "completeRun") return { type: "completeRun" };
  if (raw.type === "beginExploration") return { type: "beginExploration" };
  if (raw.type === "beginGreedy") return { type: "beginGreedy" };
  if (raw.type === "reserveSelection" && typeof raw.choice === "object" && raw.choice !== null && !Array.isArray(raw.choice) && typeof raw.choice.candidateKey === "string" && typeof raw.choice.city === "string" && Number.isSafeInteger(raw.choice.cityLimit) && Array.isArray(raw.choice.members) && raw.choice.members.every((x1: any) => typeof x1 === "object" && x1 !== null && !Array.isArray(x1) && typeof x1.id === "string" && typeof x1.unavailable === "boolean" && Number.isSafeInteger(x1.priorProactive) && Number.isSafeInteger(x1.proactiveLimit) && typeof x1.contributor === "boolean" && Number.isSafeInteger(x1.priorContribution) && Number.isSafeInteger(x1.contributionLimit)) && Array.isArray(raw.choice.pairKeys) && raw.choice.pairKeys.every((x1: any) => typeof x1 === "string") && typeof raw.timeFree === "boolean" && typeof raw.exploring === "boolean") return { type: "reserveSelection", choice: ({ candidateKey: raw.choice.candidateKey, city: raw.choice.city, cityLimit: raw.choice.cityLimit, members: raw.choice.members.map((x1: any) => ({ id: x1.id, unavailable: x1.unavailable, priorProactive: x1.priorProactive, proactiveLimit: x1.proactiveLimit, contributor: x1.contributor, priorContribution: x1.priorContribution, contributionLimit: x1.contributionLimit })), pairKeys: raw.choice.pairKeys.map((x1: any) => x1) }), timeFree: raw.timeFree, exploring: raw.exploring };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): SelectionRun | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Exposure" || raw.phase === "Exploration" || raw.phase === "Greedy" || raw.phase === "Complete") && Number.isSafeInteger(raw.selectedCount) && typeof raw.selectedKeys === "object" && raw.selectedKeys !== null && !Array.isArray(raw.selectedKeys) && Object.entries(raw.selectedKeys).every(([k1, x1]: [string, any]) => k1.startsWith("$") && typeof x1 === "boolean") && typeof raw.usedPairs === "object" && raw.usedPairs !== null && !Array.isArray(raw.usedPairs) && Object.entries(raw.usedPairs).every(([k1, x1]: [string, any]) => k1.startsWith("$") && typeof x1 === "boolean") && typeof raw.byCity === "object" && raw.byCity !== null && !Array.isArray(raw.byCity) && Object.entries(raw.byCity).every(([k1, x1]: [string, any]) => k1.startsWith("$") && Number.isSafeInteger(x1)) && typeof raw.proactive === "object" && raw.proactive !== null && !Array.isArray(raw.proactive) && Object.entries(raw.proactive).every(([k1, x1]: [string, any]) => k1.startsWith("$") && Number.isSafeInteger(x1)) && typeof raw.contribution === "object" && raw.contribution !== null && !Array.isArray(raw.contribution) && Object.entries(raw.contribution).every(([k1, x1]: [string, any]) => k1.startsWith("$") && Number.isSafeInteger(x1)) && Object.keys(raw).length === 7)) return undefined;
  const parsed: SelectionRun = ({ phase: raw.phase, selectedCount: raw.selectedCount, selectedKeys: Object.fromEntries(Object.entries(raw.selectedKeys).map(([k1, x1]: [string, any]) => [k1, x1])), usedPairs: Object.fromEntries(Object.entries(raw.usedPairs).map(([k1, x1]: [string, any]) => [k1, x1])), byCity: Object.fromEntries(Object.entries(raw.byCity).map(([k1, x1]: [string, any]) => [k1, x1])), proactive: Object.fromEntries(Object.entries(raw.proactive).map(([k1, x1]: [string, any]) => [k1, x1])), contribution: Object.fromEntries(Object.entries(raw.contribution).map(([k1, x1]: [string, any]) => [k1, x1])) });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): SelectionRun {
  //@ ensures inv(\result)
  return initial;
}

/** What a map holds for a key, or `otherwise` if it holds nothing for it. */
//@ pure
export function lookup0_selectionRun(m: Record<string, number>, k: string, otherwise: number): number {
  const key = "$" + k;
  return key in m ? m[key] : otherwise;
}

/** What a map holds for a key, or `otherwise` if it holds nothing for it. */
//@ pure
export function lookup1_selectionRun(m: Record<string, boolean>, k: string, otherwise: boolean): boolean {
  const key = "$" + k;
  return key in m ? m[key] : otherwise;
}
