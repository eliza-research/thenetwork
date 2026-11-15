// GENERATED from spec/planDecision.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Confirm a plan after enough members accept / Only a pending member can change an open plan (spec/planDecision.md:9) */
export type ReplyChoice = "IgnoreReply" | "AddMember" | "RecordLate" | "BookPlan" | "AskPartner" | "RecordAnswer" | "ClosePlan" | "AskAlternate";
/** Story: Confirm a plan after enough members accept / Only a pending member can change an open plan (spec/planDecision.md:9) */
export type PlanStage = "Probing" | "Booked" | "Closed";
/** Story: Confirm a plan after enough members accept / Only a pending member can change an open plan (spec/planDecision.md:9) */
export interface ReplyFacts { phase: PlanStage; pendingMember: boolean; accepted: boolean; yesAfter: number; needed: number; partnerPlan: boolean; firstMember: boolean; beforeDeadline: boolean; lateJoinOpen: boolean }
/** Story: Choose a fallback for a plan that cannot proceed / Two acceptances for a group require new partner consent (spec/planDecision.md:70) */
export type FallbackShape = "SmallerGroup" | "FreshPartnerPlan" | "OtherFallback";


/** Story: Confirm a plan after enough members accept / Only a pending member can change an open plan (spec/planDecision.md:9) */
//@ pure
export function canApplyPlanReply(phase: PlanStage, pendingMember: boolean): boolean {
  return phase !== "Closed" && pendingMember;
}

/** Story: Confirm a plan after enough members accept / Only a pending member can change an open plan (spec/planDecision.md:9) */
//@ pure
export function planReplyChoice(reply: ReplyFacts): ReplyChoice {
  return !canApplyPlanReply(reply.phase, reply.pendingMember) ? "IgnoreReply" : (reply.accepted ? (reply.phase === "Booked" ? (reply.lateJoinOpen ? "AddMember" : "RecordLate") : (reply.yesAfter >= reply.needed ? "BookPlan" : (reply.partnerPlan && reply.beforeDeadline ? "AskPartner" : "RecordAnswer"))) : (reply.phase === "Booked" ? "RecordAnswer" : (reply.partnerPlan && reply.firstMember ? "ClosePlan" : (reply.beforeDeadline ? "AskAlternate" : "RecordAnswer"))));
}

/** Story: Confirm a plan after enough members accept / Booking requires a pending acceptance that meets quorum (spec/planDecision.md:38) */
//@ pure
export function lawBookingNeedsQuorum(phase: PlanStage, pendingMember: boolean, accepted: boolean, yesAfter: number, needed: number, partnerPlan: boolean, firstMember: boolean, beforeDeadline: boolean, lateJoinOpen: boolean): boolean {
  //@ ensures \result === true
  const facts: ReplyFacts = { phase: phase, pendingMember: pendingMember, accepted: accepted, yesAfter: yesAfter, needed: needed, partnerPlan: partnerPlan, firstMember: firstMember, beforeDeadline: beforeDeadline, lateJoinOpen: lateJoinOpen };
  return !(planReplyChoice(facts) === "BookPlan") || (phase === "Probing" && pendingMember && accepted && yesAfter >= needed);
}

/** Story: Confirm a plan after enough members accept / An unanswered plan closes when its deadline passes (spec/planDecision.md:51) */
//@ pure
export function unmetPlanQuorum(pendingCount: number, yesCount: number, needed: number): boolean {
  return pendingCount === 0 && yesCount < needed;
}

/** Story: Confirm a plan after enough members accept / An unanswered plan closes when its deadline passes (spec/planDecision.md:51) */
//@ pure
export function planProbeExpired(phase: PlanStage, deadlineReached: boolean): boolean {
  return phase === "Probing" && deadlineReached;
}

/** Story: Confirm a plan after enough members accept / An unanswered plan closes when its deadline passes (spec/planDecision.md:51) */
//@ pure
export function lawOnlyProbingPlansExpire(phase: PlanStage): boolean {
  //@ ensures \result === true
  return !planProbeExpired(phase, true) || phase === "Probing";
}

/** Story: Choose a fallback for a plan that cannot proceed / Two acceptances for a group require new partner consent (spec/planDecision.md:70) */
//@ pure
export function planFallbackShape(yesCount: number, smallerOn: boolean, minGroup: number, leadOk: boolean): FallbackShape {
  return smallerOn && yesCount >= 2 && minGroup <= 2 && leadOk ? (yesCount === 2 ? "FreshPartnerPlan" : "SmallerGroup") : "OtherFallback";
}

/** Story: Choose a fallback for a plan that cannot proceed / Two acceptances for a group require new partner consent (spec/planDecision.md:70) */
//@ pure
export function lawDirectFallbackRequiresGroup(yesCount: number, smallerOn: boolean, minGroup: number, leadOk: boolean): boolean {
  //@ ensures \result === true
  return !(planFallbackShape(yesCount, smallerOn, minGroup, leadOk) === "SmallerGroup") || yesCount >= 3;
}

/** Story: Keep plan invites on a separate allowance / The separate plan allowance requires availability evidence or weekly check-in consent (spec/planDecision.md:90) */
//@ pure
export function qualifiesForPlanAllowance(checkInOptIn: boolean, activeStated: boolean, standingWindow: boolean, learnedTime: boolean): boolean {
  return checkInOptIn || activeStated || standingWindow || learnedTime;
}

/** Story: Turn a good plan into a recurring crew / A crew offer needs enough positive responses (spec/planDecision.md:103) */
//@ pure
export function hasCrewQuorum(memberCount: number, minimum: number): boolean {
  return memberCount >= minimum;
}

/** Story: Turn a good plan into a recurring crew / A crew offer needs enough positive responses (spec/planDecision.md:103) */
//@ pure
export function singlePlanSeedsCrew(positiveCount: number, minimum: number, minPlans: number, recurringWant: boolean): boolean {
  return hasCrewQuorum(positiveCount, minimum) && (minPlans <= 1 || recurringWant);
}

/** Story: Turn a good plan into a recurring crew / Only accepting members join the recurring crew (spec/planDecision.md:115) */
//@ pure
export function crewBelowMinimum(memberCount: number, minimum: number): boolean {
  return memberCount < minimum;
}

/** Story: Turn a good plan into a recurring crew / Only accepting members join the recurring crew (spec/planDecision.md:115) */
//@ pure
export function crewMembersWhoOptedIn(invitedMembers: string[], optIns: string[]): string[] {
  return invitedMembers.filter((memberId: string) => optIns.includes(memberId));
}

/** Story: Turn a good plan into a recurring crew / Only accepting members join the recurring crew (spec/planDecision.md:115) */
//@ pure
export function crewHostOrder(members: string[], preferredHosts: string[]): string[] {
  const hosts: string[] = crewMembersWhoOptedIn(preferredHosts, members);
  return hosts.length > 0 ? hosts : members;
}
