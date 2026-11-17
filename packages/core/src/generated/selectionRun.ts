// GENERATED from spec/selectionRun.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md) */
export interface SelectionMember { id: string; unavailable: boolean; priorProactive: number; proactiveLimit: number; contributor: boolean; priorContribution: number; contributionLimit: number }
/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md) */
export type SelectionPhase = "Exposure" | "Exploration" | "Greedy" | "Complete";
/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md) */
export interface SelectionRefusal { member: SelectionMember; proactiveAtRefusal: number; contributionAtRefusal: number }
/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md) */
export interface SelectionRun { phase: SelectionPhase; selectedCount: number; selectedKeys: Record<string, boolean>; usedPairs: Record<string, boolean>; byCity: Record<string, number>; proactive: Record<string, number>; contribution: Record<string, number>; greedyBound: number; refusals: SelectionRefusal[] }
/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md) */
export interface SelectionChoice { candidateKey: string; city: string; cityLimit: number; members: SelectionMember[]; pairKeys: string[] }

/** One variant per transition in the spec. */
export type Event =
  | { type: "beginExploration" }
  | { type: "beginGreedy" }
  | { type: "completeRun" }
  | { type: "reserveSelection"; choice: SelectionChoice; timeFree: boolean; exploring: boolean; packAllows: boolean; value: number }
  | { type: "refuseSelection"; choice: SelectionChoice; value: number; blockedMember: SelectionMember };

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md) */
export const selectionGreedyBoundStart: number = 1000000000;
/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md) */
export const initial: SelectionRun = { phase: "Exposure", selectedCount: 0, selectedKeys: ({} as Record<string, boolean>), usedPairs: ({} as Record<string, boolean>), byCity: ({} as Record<string, number>), proactive: ({} as Record<string, number>), contribution: ({} as Record<string, number>), greedyBound: selectionGreedyBoundStart, refusals: ([] as SelectionRefusal[]) };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: SelectionRun): boolean {
  return alwaysSelectedCountIsNonnegative(current) && alwaysRefusedMemberStaysFull(current);
}

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md) */
//@ pure
export function beginExploration(s: SelectionRun): SelectionRun {
  //@ ensures (inv(s) && canBeginExploration(s)) ==> alwaysSelectedCountIsNonnegative(\result)
  //@ ensures (inv(s) && canBeginExploration(s)) ==> alwaysRefusedMemberStaysFull(\result)
  //@ ensures (inv(s) && canBeginExploration(s)) ==> stepCompletedRunStaysClosed(s, \result)
  //@ ensures (inv(s) && canBeginExploration(s)) ==> stepGreedyValuesNeverRise(s, \result)
  //@ ensures (inv(s) && canBeginExploration(s)) ==> stepOnlyReserveIncreasesSelections(s, "beginExploration", \result)
  //@ ensures (inv(s) && canBeginExploration(s)) ==> stepRefusedMemberGetsNoReservation(s, \result)
  return { ...s, phase: "Exploration" };
}

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md) */
//@ pure
export function canBeginGreedy(s: SelectionRun): boolean {
  return s.phase === "Exploration";
}

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md) */
//@ pure
export function beginGreedy(s: SelectionRun): SelectionRun {
  //@ ensures (inv(s) && canBeginGreedy(s)) ==> alwaysSelectedCountIsNonnegative(\result)
  //@ ensures (inv(s) && canBeginGreedy(s)) ==> alwaysRefusedMemberStaysFull(\result)
  //@ ensures (inv(s) && canBeginGreedy(s)) ==> stepCompletedRunStaysClosed(s, \result)
  //@ ensures (inv(s) && canBeginGreedy(s)) ==> stepGreedyValuesNeverRise(s, \result)
  //@ ensures (inv(s) && canBeginGreedy(s)) ==> stepOnlyReserveIncreasesSelections(s, "beginGreedy", \result)
  //@ ensures (inv(s) && canBeginGreedy(s)) ==> stepRefusedMemberGetsNoReservation(s, \result)
  return { ...s, phase: "Greedy" };
}

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md) */
//@ pure
export function canCompleteRun(s: SelectionRun): boolean {
  return s.phase === "Greedy";
}

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md) */
//@ pure
export function completeRun(s: SelectionRun): SelectionRun {
  //@ ensures (inv(s) && canCompleteRun(s)) ==> alwaysSelectedCountIsNonnegative(\result)
  //@ ensures (inv(s) && canCompleteRun(s)) ==> alwaysRefusedMemberStaysFull(\result)
  //@ ensures (inv(s) && canCompleteRun(s)) ==> stepCompletedRunStaysClosed(s, \result)
  //@ ensures (inv(s) && canCompleteRun(s)) ==> stepGreedyValuesNeverRise(s, \result)
  //@ ensures (inv(s) && canCompleteRun(s)) ==> stepOnlyReserveIncreasesSelections(s, "completeRun", \result)
  //@ ensures (inv(s) && canCompleteRun(s)) ==> stepRefusedMemberGetsNoReservation(s, \result)
  return { ...s, phase: "Complete" };
}

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md) */
//@ pure
export function stepCompletedRunStaysClosed(before: SelectionRun, after: SelectionRun): boolean {
  return !(before.phase === "Complete") || after.phase === "Complete";
}

/** Story: Select compatible proposals within the run’s limits / Exposure selection precedes exploration and greedy selection (spec/selectionRun.md) */
//@ pure
export function canBeginExploration(s: SelectionRun): boolean {
  return s.phase === "Exposure";
}

/** Story: Select compatible proposals within the run’s limits / Greedy decisions never rise in value (spec/selectionRun.md) */
//@ pure
export function selectionValueInOrder(s: SelectionRun, value: number): boolean {
  return s.phase !== "Greedy" || value <= s.greedyBound;
}

/** Story: Select compatible proposals within the run’s limits / Greedy decisions never rise in value (spec/selectionRun.md) */
//@ pure
export function stepGreedyValuesNeverRise(before: SelectionRun, after: SelectionRun): boolean {
  return after.greedyBound <= before.greedyBound;
}

/** Story: Select compatible proposals within the run’s limits / Greedy decisions never rise in value (spec/selectionRun.md) */
//@ pure
export function sometimesGreedyBoundLowered(s: SelectionRun): boolean {
  return s.greedyBound < selectionGreedyBoundStart;
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md) */
//@ pure
export function numberUsed(counts: Record<string, number>, key: string): number {
  return lookup0_selectionRun(counts, key, 0);
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md) */
//@ pure
export function selectedBefore(s: SelectionRun, candidateKey: string): boolean {
  return lookup1_selectionRun(s.selectedKeys, candidateKey, false);
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md) */
//@ pure
export function pairAlreadyUsed(s: SelectionRun, pair: string): boolean {
  return lookup1_selectionRun(s.usedPairs, pair, false);
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md) */
//@ pure
export function proactiveUsed(s: SelectionRun, id: string): number {
  return numberUsed(s.proactive, id);
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md) */
//@ pure
export function selectionMemberRefused(s: SelectionRun, id: string): boolean {
  return s.refusals.some((r: SelectionRefusal) => r.member.id === id);
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md) */
//@ pure
export function memberHasRoom(s: SelectionRun, m: SelectionMember): boolean {
  return !m.unavailable && !(exact_selectionRun(exact_selectionRun(m.priorProactive + proactiveUsed(s, m.id)) + 1) > m.proactiveLimit) && (!m.contributor || !(exact_selectionRun(exact_selectionRun(m.priorContribution + numberUsed(s.contribution, m.id)) + 1) > m.contributionLimit));
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md) */
//@ pure
export function choiceHasRoom(s: SelectionRun, choice: SelectionChoice): boolean {
  return s.phase !== "Complete" && !selectedBefore(s, choice.candidateKey) && !(numberUsed(s.byCity, choice.city) >= choice.cityLimit) && !choice.members.some((m: SelectionMember) => !(memberHasRoom(s, m) && !selectionMemberRefused(s, m.id))) && !choice.pairKeys.some((pair: string) => !(!pairAlreadyUsed(s, pair)));
}

/** Story: Select compatible proposals within the run’s limits / Each reservation checks the city, pair, and member limits (spec/selectionRun.md) */
//@ pure
export function canReserveSelection(s: SelectionRun, choice: SelectionChoice, timeFree: boolean, exploring: boolean, packAllows: boolean, value: number): boolean {
  return packAllows && timeFree && exploring === (s.phase === "Exploration") && selectionValueInOrder(s, value) && choiceHasRoom(s, choice);
}

/** Story: Select compatible proposals within the run’s limits / Reserving a proposal consumes its slots together (spec/selectionRun.md) */
//@ pure
export function addUse(counts: Record<string, number>, key: string): Record<string, number> {
  return ({ ...counts, ["$" + key]: exact_selectionRun(numberUsed(counts, key) + 1) } as Record<string, number>);
}

/** Story: Select compatible proposals within the run’s limits / Reserving a proposal consumes its slots together (spec/selectionRun.md) */
//@ pure
export function alwaysSelectedCountIsNonnegative(s: SelectionRun): boolean {
  return s.selectedCount >= 0;
}

/** Story: Select compatible proposals within the run’s limits / Reserving a proposal consumes its slots together (spec/selectionRun.md) */
//@ pure
export function stepOnlyReserveIncreasesSelections(before: SelectionRun, via: string, after: SelectionRun): boolean {
  return via === "reserveSelection" ? after.selectedCount === exact_selectionRun(before.selectedCount + 1) : after.selectedCount === before.selectedCount;
}

/** Story: Select compatible proposals within the run’s limits / Reserving a proposal consumes its slots together (spec/selectionRun.md) */
//@ pure
export function sometimesSelected(s: SelectionRun): boolean {
  return s.selectedCount > 0;
}

/** Story: Select compatible proposals within the run’s limits / Reserving a proposal consumes its slots together (spec/selectionRun.md) */
//@ pure
export function sometimesFinishedWithSelection(s: SelectionRun): boolean {
  return s.phase === "Complete" && s.selectedCount > 0;
}

/** Story: Select compatible proposals within the run’s limits / Reserving a proposal consumes its slots together (spec/selectionRun.md) */
//@ pure
export function reserveSelection(s: SelectionRun, choice: SelectionChoice, timeFree: boolean, exploring: boolean, packAllows: boolean, value: number): SelectionRun {
  //@ ensures (inv(s) && canReserveSelection(s, choice, timeFree, exploring, packAllows, value)) ==> alwaysSelectedCountIsNonnegative(\result)
  //@ ensures (inv(s) && canReserveSelection(s, choice, timeFree, exploring, packAllows, value)) ==> alwaysRefusedMemberStaysFull(\result)
  //@ ensures (inv(s) && canReserveSelection(s, choice, timeFree, exploring, packAllows, value)) ==> stepCompletedRunStaysClosed(s, \result)
  //@ ensures (inv(s) && canReserveSelection(s, choice, timeFree, exploring, packAllows, value)) ==> stepGreedyValuesNeverRise(s, \result)
  //@ ensures (inv(s) && canReserveSelection(s, choice, timeFree, exploring, packAllows, value)) ==> stepOnlyReserveIncreasesSelections(s, "reserveSelection", \result)
  //@ ensures (inv(s) && canReserveSelection(s, choice, timeFree, exploring, packAllows, value)) ==> stepRefusedMemberGetsNoReservation(s, \result)
  const local_0 = choice.pairKeys.reduce((pairs: Record<string, boolean>, pair: string) => ({ ...pairs, ["$" + pair]: true } as Record<string, boolean>), s.usedPairs);
  const local_1 = choice.members.reduce((counts: Record<string, number>, m: SelectionMember) => addUse(counts, m.id), s.proactive);
  const local_2 = choice.members.reduce((counts: Record<string, number>, m: SelectionMember) => m.contributor ? addUse(counts, m.id) : counts, s.contribution);
  const local_3 = s.phase === "Greedy" ? value : s.greedyBound;
  return { ...s, selectedCount: exact_selectionRun(s.selectedCount + 1), selectedKeys: ({ ...s.selectedKeys, ["$" + choice.candidateKey]: true } as Record<string, boolean>), usedPairs: local_0, byCity: addUse(s.byCity, choice.city), proactive: local_1, contribution: local_2, greedyBound: local_3 };
}

/** Story: Select compatible proposals within the run’s limits / A greedy refusal names a member who stays without room (spec/selectionRun.md) */
//@ pure
export function selectionMemberFullAt(m: SelectionMember, proactive: number, contribution: number): boolean {
  return m.unavailable || exact_selectionRun(exact_selectionRun(m.priorProactive + proactive) + 1) > m.proactiveLimit || (m.contributor && exact_selectionRun(exact_selectionRun(m.priorContribution + contribution) + 1) > m.contributionLimit);
}

/** Story: Select compatible proposals within the run’s limits / A greedy refusal names a member who stays without room (spec/selectionRun.md) */
//@ pure
export function lawSelectionFullMemberStaysFull(blockedMember: SelectionMember, proactive: number, contribution: number, laterProactive: number, laterContribution: number): boolean {
  //@ ensures \result === true
  return !(selectionMemberFullAt(blockedMember, proactive, contribution) && proactive <= laterProactive && contribution <= laterContribution) || selectionMemberFullAt(blockedMember, laterProactive, laterContribution);
}

/** Story: Select compatible proposals within the run’s limits / A greedy refusal names a member who stays without room (spec/selectionRun.md) */
//@ pure
export function selectionChoiceHasMember(choice: SelectionChoice, m: SelectionMember): boolean {
  return choice.members.some((x: SelectionMember) => x.id === m.id && x.unavailable === m.unavailable && x.priorProactive === m.priorProactive && x.proactiveLimit === m.proactiveLimit && x.contributor === m.contributor && x.priorContribution === m.priorContribution && x.contributionLimit === m.contributionLimit);
}

/** Story: Select compatible proposals within the run’s limits / A greedy refusal names a member who stays without room (spec/selectionRun.md) */
//@ pure
export function sometimesRefusedAfterReservation(s: SelectionRun): boolean {
  return s.refusals.some((r: SelectionRefusal) => r.proactiveAtRefusal > 0);
}

/** Story: Select compatible proposals within the run’s limits / A greedy refusal names a member who stays without room (spec/selectionRun.md) */
//@ pure
export function alwaysRefusedMemberStaysFull(s: SelectionRun): boolean {
  return !s.refusals.some((r: SelectionRefusal) => !(selectionMemberFullAt(r.member, r.proactiveAtRefusal, r.contributionAtRefusal) && r.proactiveAtRefusal <= proactiveUsed(s, r.member.id) && r.contributionAtRefusal <= numberUsed(s.contribution, r.member.id) && selectionMemberFullAt(r.member, proactiveUsed(s, r.member.id), numberUsed(s.contribution, r.member.id))));
}

/** Story: Select compatible proposals within the run’s limits / A greedy refusal names a member who stays without room (spec/selectionRun.md) */
//@ pure
export function stepRefusedMemberGetsNoReservation(before: SelectionRun, after: SelectionRun): boolean {
  return !before.refusals.some((r: SelectionRefusal) => !(proactiveUsed(after, r.member.id) === proactiveUsed(before, r.member.id) && numberUsed(after.contribution, r.member.id) === numberUsed(before.contribution, r.member.id)));
}

/** Story: Select compatible proposals within the run’s limits / A greedy refusal names a member who stays without room (spec/selectionRun.md) */
//@ pure
export function canRefuseSelection(s: SelectionRun, choice: SelectionChoice, value: number, blockedMember: SelectionMember): boolean {
  return s.phase === "Greedy" && value <= s.greedyBound && !selectedBefore(s, choice.candidateKey) && selectionChoiceHasMember(choice, blockedMember) && !memberHasRoom(s, blockedMember);
}

/** Story: Select compatible proposals within the run’s limits / A greedy refusal names a member who stays without room (spec/selectionRun.md) */
//@ pure
export function refuseSelection(s: SelectionRun, choice: SelectionChoice, value: number, blockedMember: SelectionMember): SelectionRun {
  //@ ensures (inv(s) && canRefuseSelection(s, choice, value, blockedMember)) ==> alwaysSelectedCountIsNonnegative(\result)
  //@ ensures (inv(s) && canRefuseSelection(s, choice, value, blockedMember)) ==> alwaysRefusedMemberStaysFull(\result)
  //@ ensures (inv(s) && canRefuseSelection(s, choice, value, blockedMember)) ==> stepCompletedRunStaysClosed(s, \result)
  //@ ensures (inv(s) && canRefuseSelection(s, choice, value, blockedMember)) ==> stepGreedyValuesNeverRise(s, \result)
  //@ ensures (inv(s) && canRefuseSelection(s, choice, value, blockedMember)) ==> stepOnlyReserveIncreasesSelections(s, "refuseSelection", \result)
  //@ ensures (inv(s) && canRefuseSelection(s, choice, value, blockedMember)) ==> stepRefusedMemberGetsNoReservation(s, \result)
  const local_4: SelectionRefusal = { member: blockedMember, proactiveAtRefusal: proactiveUsed(s, blockedMember.id), contributionAtRefusal: numberUsed(s.contribution, blockedMember.id) };
  return { ...s, greedyBound: value, refusals: s.refusals.concat([local_4]) };
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: SelectionRun, event: Event): boolean {
  if (event.type === "beginExploration") return canBeginExploration(current);
  if (event.type === "beginGreedy") return canBeginGreedy(current);
  if (event.type === "completeRun") return canCompleteRun(current);
  if (event.type === "reserveSelection") return canReserveSelection(current, event.choice, event.timeFree, event.exploring, event.packAllows, event.value);
  if (event.type === "refuseSelection") return canRefuseSelection(current, event.choice, event.value, event.blockedMember);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: SelectionRun, event: Event): SelectionRun {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "beginExploration" && canBeginExploration(current)) return beginExploration(current);
  if (event.type === "beginGreedy" && canBeginGreedy(current)) return beginGreedy(current);
  if (event.type === "completeRun" && canCompleteRun(current)) return completeRun(current);
  if (event.type === "reserveSelection" && canReserveSelection(current, event.choice, event.timeFree, event.exploring, event.packAllows, event.value)) return reserveSelection(current, event.choice, event.timeFree, event.exploring, event.packAllows, event.value);
  if (event.type === "refuseSelection" && canRefuseSelection(current, event.choice, event.value, event.blockedMember)) return refuseSelection(current, event.choice, event.value, event.blockedMember);
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
  const is_SelectionMember = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.id === "string" && typeof v.unavailable === "boolean" && Number.isSafeInteger(v.priorProactive) && Number.isSafeInteger(v.proactiveLimit) && typeof v.contributor === "boolean" && Number.isSafeInteger(v.priorContribution) && Number.isSafeInteger(v.contributionLimit);
  const is_SelectionChoice = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.candidateKey === "string" && typeof v.city === "string" && Number.isSafeInteger(v.cityLimit) && Array.isArray(v.members) && v.members.every((x1: any) => is_SelectionMember(x1)) && Array.isArray(v.pairKeys) && v.pairKeys.every((x1: any) => typeof x1 === "string");
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "beginExploration") return { type: "beginExploration" };
  if (raw.type === "beginGreedy") return { type: "beginGreedy" };
  if (raw.type === "completeRun") return { type: "completeRun" };
  if (raw.type === "reserveSelection" && is_SelectionChoice(raw.choice) && typeof raw.timeFree === "boolean" && typeof raw.exploring === "boolean" && typeof raw.packAllows === "boolean" && Number.isSafeInteger(raw.value)) return { type: "reserveSelection", choice: ({ candidateKey: raw.choice.candidateKey, city: raw.choice.city, cityLimit: raw.choice.cityLimit, members: raw.choice.members.map((x1: any) => ({ id: x1.id, unavailable: x1.unavailable, priorProactive: x1.priorProactive, proactiveLimit: x1.proactiveLimit, contributor: x1.contributor, priorContribution: x1.priorContribution, contributionLimit: x1.contributionLimit })), pairKeys: raw.choice.pairKeys.map((x1: any) => x1) }), timeFree: raw.timeFree, exploring: raw.exploring, packAllows: raw.packAllows, value: raw.value };
  if (raw.type === "refuseSelection" && is_SelectionChoice(raw.choice) && Number.isSafeInteger(raw.value) && is_SelectionMember(raw.blockedMember)) return { type: "refuseSelection", choice: ({ candidateKey: raw.choice.candidateKey, city: raw.choice.city, cityLimit: raw.choice.cityLimit, members: raw.choice.members.map((x1: any) => ({ id: x1.id, unavailable: x1.unavailable, priorProactive: x1.priorProactive, proactiveLimit: x1.proactiveLimit, contributor: x1.contributor, priorContribution: x1.priorContribution, contributionLimit: x1.contributionLimit })), pairKeys: raw.choice.pairKeys.map((x1: any) => x1) }), value: raw.value, blockedMember: ({ id: raw.blockedMember.id, unavailable: raw.blockedMember.unavailable, priorProactive: raw.blockedMember.priorProactive, proactiveLimit: raw.blockedMember.proactiveLimit, contributor: raw.blockedMember.contributor, priorContribution: raw.blockedMember.priorContribution, contributionLimit: raw.blockedMember.contributionLimit }) };
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
  const is_SelectionMember = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.id === "string" && typeof v.unavailable === "boolean" && Number.isSafeInteger(v.priorProactive) && Number.isSafeInteger(v.proactiveLimit) && typeof v.contributor === "boolean" && Number.isSafeInteger(v.priorContribution) && Number.isSafeInteger(v.contributionLimit) && Object.keys(v).length === 7;
  const is_SelectionRefusal = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && is_SelectionMember(v.member) && Number.isSafeInteger(v.proactiveAtRefusal) && Number.isSafeInteger(v.contributionAtRefusal) && Object.keys(v).length === 3;
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Exposure" || raw.phase === "Exploration" || raw.phase === "Greedy" || raw.phase === "Complete") && Number.isSafeInteger(raw.selectedCount) && typeof raw.selectedKeys === "object" && raw.selectedKeys !== null && !Array.isArray(raw.selectedKeys) && Object.entries(raw.selectedKeys).every(([k1, x1]: [string, any]) => k1.startsWith("$") && typeof x1 === "boolean") && typeof raw.usedPairs === "object" && raw.usedPairs !== null && !Array.isArray(raw.usedPairs) && Object.entries(raw.usedPairs).every(([k1, x1]: [string, any]) => k1.startsWith("$") && typeof x1 === "boolean") && typeof raw.byCity === "object" && raw.byCity !== null && !Array.isArray(raw.byCity) && Object.entries(raw.byCity).every(([k1, x1]: [string, any]) => k1.startsWith("$") && Number.isSafeInteger(x1)) && typeof raw.proactive === "object" && raw.proactive !== null && !Array.isArray(raw.proactive) && Object.entries(raw.proactive).every(([k1, x1]: [string, any]) => k1.startsWith("$") && Number.isSafeInteger(x1)) && typeof raw.contribution === "object" && raw.contribution !== null && !Array.isArray(raw.contribution) && Object.entries(raw.contribution).every(([k1, x1]: [string, any]) => k1.startsWith("$") && Number.isSafeInteger(x1)) && Number.isSafeInteger(raw.greedyBound) && Array.isArray(raw.refusals) && raw.refusals.every((x1: any) => is_SelectionRefusal(x1)) && Object.keys(raw).length === 9)) return undefined;
  const parsed: SelectionRun = ({ phase: raw.phase, selectedCount: raw.selectedCount, selectedKeys: Object.fromEntries(Object.entries(raw.selectedKeys).map(([k1, x1]: [string, any]) => [k1, x1])), usedPairs: Object.fromEntries(Object.entries(raw.usedPairs).map(([k1, x1]: [string, any]) => [k1, x1])), byCity: Object.fromEntries(Object.entries(raw.byCity).map(([k1, x1]: [string, any]) => [k1, x1])), proactive: Object.fromEntries(Object.entries(raw.proactive).map(([k1, x1]: [string, any]) => [k1, x1])), contribution: Object.fromEntries(Object.entries(raw.contribution).map(([k1, x1]: [string, any]) => [k1, x1])), greedyBound: raw.greedyBound, refusals: raw.refusals.map((x1: any) => ({ member: ({ id: x1.member.id, unavailable: x1.member.unavailable, priorProactive: x1.member.priorProactive, proactiveLimit: x1.member.proactiveLimit, contributor: x1.member.contributor, priorContribution: x1.member.priorContribution, contributionLimit: x1.member.contributionLimit }), proactiveAtRefusal: x1.proactiveAtRefusal, contributionAtRefusal: x1.contributionAtRefusal })) });
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

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_selectionRun(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
