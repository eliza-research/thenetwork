// GENERATED from spec/standingIntentManagement.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
export type IntentCommandPhase = "AwaitingMember" | "ShowIntents" | "SelectIntent" | "MemberRefused" | "UnknownIntent" | "AmbiguousIntent" | "IntentUnchanged" | "PauseSelected" | "CloseSelected" | "ResumeSelected" | "KeepSelected" | "UndoRequested";
/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
export type IntentCommand = "ListIntents" | "PauseIntent" | "CloseIntent" | "ResumeIntent" | "KeepIntent" | "UndoIntent";
/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
export interface IntentManagement { phase: IntentCommandPhase; command: IntentCommand }
/** Story: See and manage the things the Network is looking for / Change only the single thing the member named (spec/standingIntentManagement.md) */
export type IntentControl = "PauseControl" | "CloseControl";
/** Story: See and manage the things the Network is looking for / Only the member's own words close a standing thing (spec/standingIntentManagement.md) */
export type StandingSource = "MemberThread" | "MemberAgent" | "AssistantProfile";
/** Story: See and manage the things the Network is looking for / Only the member's own words close a standing thing (spec/standingIntentManagement.md) */
export type StandingChange = "AddStanding" | "PauseStanding" | "ResumeStanding" | "CloseStanding";
/** Story: See and manage the things the Network is looking for / Only the member's own words close a standing thing (spec/standingIntentManagement.md) */
export type StandingOutcome = "ApplyNow" | "ConfirmFirst" | "RefuseChange";
/** Story: See and manage the things the Network is looking for / Saying a want again changes nothing that the member paused or closed (spec/standingIntentManagement.md) */
export type StandingAddRoute = "AddOpens" | "AddReopens" | "AddKeepsPause" | "AddKeepsClose" | "AddRefused";
/** Story: See and manage the things the Network is looking for / Reconcile older saved controls during the first normal save (spec/standingIntentManagement.md) */
export type LegacyIntentChange = "KeepIntentStatus" | "ReconcilePause" | "ReconcileClose";
/** Story: See and manage the things the Network is looking for / A bare reply answers only the newest open standing question (spec/standingIntentManagement.md) */
export type StandingPendingKind = "NoStandingPending" | "ClosedByMember" | "PausedByMember" | "PausedByAgent" | "ResumedByAgent" | "CloseAsked" | "RenewalAsked";
/** Story: See and manage the things the Network is looking for / A bare reply answers only the newest open standing question (spec/standingIntentManagement.md) */
export type StandingReply = "UndoReply" | "CloseReply" | "KeepReply";

/** One variant per transition in the spec. */
export type Event =
  | { type: "authorizeIntentCommand"; allowed: boolean; command: IntentCommand }
  | { type: "chooseOwnedIntent"; matches: number; live: boolean; paused: boolean };

/** Story: See and manage the things the Network is looking for / A bare reply answers only the newest open standing question (spec/standingIntentManagement.md) */
export const standingUndoWindowMs: number = 86400000;
/** Story: See and manage the things the Network is looking for / A bare reply answers only the newest open standing question (spec/standingIntentManagement.md) */
export const standingAskLifetimeMs: number = 259200000;
/** Story: See and manage the things the Network is looking for / A list number names a thing for one day (spec/standingIntentManagement.md) */
export const standingListLifetimeMs: number = 86400000;
/** Story: See and manage the things the Network is looking for / Only the member's own words close a standing thing (spec/standingIntentManagement.md) */
export const agentDailyChangeLimit: number = 3;
/** Story: See and manage the things the Network is looking for / Only the member's own words close a standing thing (spec/standingIntentManagement.md) */
export const recentCloseDays: number = 30;
/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
export const initial: IntentManagement = { phase: "AwaitingMember", command: "ListIntents" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: IntentManagement): boolean {
  return true;
}

/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
//@ pure
export function intentManagementAllowed(canonicalMembership: boolean, ownNetworkMember: boolean, optedOut: boolean): boolean {
  return canonicalMembership && ownNetworkMember && !optedOut;
}

/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
//@ pure
export function standingIntentReplayAllowed(canonicalMember: boolean): boolean {
  return canonicalMember;
}

/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
//@ pure
export function canAuthorizeIntentCommand(s: IntentManagement): boolean {
  return s.phase === "AwaitingMember";
}

/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
//@ pure
export function authorizeIntentCommand(s: IntentManagement, allowed: boolean, command: IntentCommand): IntentManagement {
  //@ ensures (inv(s) && canAuthorizeIntentCommand(s)) ==> stepChangeRequiresSelection(s, \result)
  return { command: command, phase: !allowed ? "MemberRefused" : (command === "ListIntents" ? "ShowIntents" : (command === "UndoIntent" ? "UndoRequested" : "SelectIntent")) };
}

/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
//@ pure
export function refusedCommandPasses(command: IntentCommand, bareReply: boolean): boolean {
  return command === "UndoIntent" || (bareReply && (command === "CloseIntent" || command === "KeepIntent"));
}

/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
//@ pure
export function lawRefusedNamedCommandStaysHandled(command: IntentCommand, bareReply: boolean): boolean {
  //@ ensures \result === true
  return !refusedCommandPasses(command, bareReply) || (command === "UndoIntent" || command === "CloseIntent" || command === "KeepIntent");
}

/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
//@ pure
export function lawRefusedReferenceCommandStaysHandled(command: IntentCommand): boolean {
  //@ ensures \result === true
  return !(command !== "UndoIntent") || !refusedCommandPasses(command, false);
}

/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
//@ pure
export function lawRefusedUndoPasses(bareReply: boolean): boolean {
  //@ ensures \result === true
  return refusedCommandPasses("UndoIntent", bareReply);
}

/** Story: See and manage the things the Network is looking for / Change only the single thing the member named (spec/standingIntentManagement.md) */
//@ pure
export function canChooseOwnedIntent(s: IntentManagement): boolean {
  return s.phase === "SelectIntent";
}

/** Story: See and manage the things the Network is looking for / Change only the single thing the member named (spec/standingIntentManagement.md) */
//@ pure
export function chooseOwnedIntent(s: IntentManagement, matches: number, live: boolean, paused: boolean): IntentManagement {
  //@ ensures (inv(s) && canChooseOwnedIntent(s)) ==> stepChangeRequiresSelection(s, \result)
  return { ...s, phase: matches === 0 ? "UnknownIntent" : (matches !== 1 ? "AmbiguousIntent" : (s.command === "PauseIntent" && live ? "PauseSelected" : (s.command === "CloseIntent" && (live || paused) ? "CloseSelected" : (s.command === "ResumeIntent" && paused ? "ResumeSelected" : (s.command === "KeepIntent" && (live || paused) ? "KeepSelected" : "IntentUnchanged"))))) };
}

/** Story: See and manage the things the Network is looking for / Change only the single thing the member named (spec/standingIntentManagement.md) */
//@ pure
export function effectiveStandingControl(storedStatus: string, control: IntentControl): IntentControl {
  return storedStatus === "closed" || control === "CloseControl" ? "CloseControl" : "PauseControl";
}

/** Story: See and manage the things the Network is looking for / Change only the single thing the member named (spec/standingIntentManagement.md) */
//@ pure
export function stepChangeRequiresSelection(before: IntentManagement, after: IntentManagement): boolean {
  return !(before.phase !== after.phase && (after.phase === "PauseSelected" || after.phase === "CloseSelected" || after.phase === "ResumeSelected" || after.phase === "KeepSelected")) || before.phase === "SelectIntent";
}

/** Story: See and manage the things the Network is looking for / Change only the single thing the member named (spec/standingIntentManagement.md) */
//@ pure
export function sometimesPausesAnIntent(s: IntentManagement): boolean {
  return s.phase === "PauseSelected";
}

/** Story: See and manage the things the Network is looking for / Change only the single thing the member named (spec/standingIntentManagement.md) */
//@ pure
export function sometimesClosesAnIntent(s: IntentManagement): boolean {
  return s.phase === "CloseSelected";
}

/** Story: See and manage the things the Network is looking for / Change only the single thing the member named (spec/standingIntentManagement.md) */
//@ pure
export function sometimesResumesAnIntent(s: IntentManagement): boolean {
  return s.phase === "ResumeSelected";
}

/** Story: See and manage the things the Network is looking for / Commit a stored intent change with its acknowledgment (spec/standingIntentManagement.md) */
//@ pure
export function writesStandingIntentRow(s: IntentManagement, stored: boolean, paused: boolean): boolean {
  return stored && (s.phase === "PauseSelected" || s.phase === "CloseSelected" || s.phase === "ResumeSelected" || (s.phase === "KeepSelected" && paused));
}

/** Story: See and manage the things the Network is looking for / Only the member's own words close a standing thing (spec/standingIntentManagement.md) */
//@ pure
export function standingChangeOutcome(source: StandingSource, change: StandingChange, inProgress: boolean, confirmed: boolean, agentChangesToday: number, closedDaysAgo: number): StandingOutcome {
  return source === "MemberThread" ? (change === "CloseStanding" && inProgress && !confirmed ? "ConfirmFirst" : "ApplyNow") : (source === "MemberAgent" ? ((change === "PauseStanding" || change === "ResumeStanding") && agentChangesToday < agentDailyChangeLimit ? "ApplyNow" : "RefuseChange") : (change === "AddStanding" && (closedDaysAgo < 0 || closedDaysAgo >= recentCloseDays) ? "ApplyNow" : "RefuseChange"));
}

/** Story: See and manage the things the Network is looking for / Only the member's own words close a standing thing (spec/standingIntentManagement.md) */
//@ pure
export function lawAssistantProfileOnlyAdds(change: StandingChange, inProgress: boolean, confirmed: boolean, agentChangesToday: number, closedDaysAgo: number): boolean {
  //@ ensures \result === true
  return !(change !== "AddStanding") || standingChangeOutcome("AssistantProfile", change, inProgress, confirmed, agentChangesToday, closedDaysAgo) === "RefuseChange";
}

/** Story: See and manage the things the Network is looking for / Only the member's own words close a standing thing (spec/standingIntentManagement.md) */
//@ pure
export function lawRecentCloseBlocksProfileAdd(inProgress: boolean, confirmed: boolean, agentChangesToday: number, closedDaysAgo: number): boolean {
  //@ ensures \result === true
  return !(closedDaysAgo >= 0 && closedDaysAgo < recentCloseDays) || standingChangeOutcome("AssistantProfile", "AddStanding", inProgress, confirmed, agentChangesToday, closedDaysAgo) === "RefuseChange";
}

/** Story: See and manage the things the Network is looking for / Only the member's own words close a standing thing (spec/standingIntentManagement.md) */
//@ pure
export function lawAgentNeverAddsOrCloses(change: StandingChange, inProgress: boolean, confirmed: boolean, agentChangesToday: number, closedDaysAgo: number): boolean {
  //@ ensures \result === true
  return !(change === "AddStanding" || change === "CloseStanding") || standingChangeOutcome("MemberAgent", change, inProgress, confirmed, agentChangesToday, closedDaysAgo) === "RefuseChange";
}

/** Story: See and manage the things the Network is looking for / Only the member's own words close a standing thing (spec/standingIntentManagement.md) */
//@ pure
export function lawAgentChangesAreBounded(change: StandingChange, inProgress: boolean, confirmed: boolean, agentChangesToday: number, closedDaysAgo: number): boolean {
  //@ ensures \result === true
  return !(agentChangesToday >= agentDailyChangeLimit) || standingChangeOutcome("MemberAgent", change, inProgress, confirmed, agentChangesToday, closedDaysAgo) === "RefuseChange";
}

/** Story: See and manage the things the Network is looking for / Only the member's own words close a standing thing (spec/standingIntentManagement.md) */
//@ pure
export function lawInProgressCloseAsksFirst(agentChangesToday: number, closedDaysAgo: number): boolean {
  //@ ensures \result === true
  return standingChangeOutcome("MemberThread", "CloseStanding", true, false, agentChangesToday, closedDaysAgo) === "ConfirmFirst";
}

/** Story: See and manage the things the Network is looking for / Only the member's own words close a standing thing (spec/standingIntentManagement.md) */
//@ pure
export function lawOnlyAnsweredMemberWordsCloseInProgress(source: StandingSource, confirmed: boolean, agentChangesToday: number, closedDaysAgo: number): boolean {
  //@ ensures \result === true
  return !(standingChangeOutcome(source, "CloseStanding", true, confirmed, agentChangesToday, closedDaysAgo) === "ApplyNow") || (source === "MemberThread" && confirmed);
}

/** Story: See and manage the things the Network is looking for / Saying a want again changes nothing that the member paused or closed (spec/standingIntentManagement.md) */
//@ pure
export function sameStandingWant(desireNamed: boolean, sameDesire: boolean, sameCategory: boolean, sharedTags: number, untagged: boolean): boolean {
  return desireNamed ? sameDesire : sameCategory && (sharedTags > 0 || untagged);
}

/** Story: See and manage the things the Network is looking for / Saying a want again changes nothing that the member paused or closed (spec/standingIntentManagement.md) */
//@ pure
export function lawDifferentCategoryIsAnotherWant(sharedTags: number, untagged: boolean): boolean {
  //@ ensures \result === true
  return !sameStandingWant(false, true, false, sharedTags, untagged);
}

/** Story: See and manage the things the Network is looking for / Saying a want again changes nothing that the member paused or closed (spec/standingIntentManagement.md) */
//@ pure
export function lawNamedDesireDecidesTheWant(sameDesire: boolean, sameCategory: boolean, sharedTags: number, untagged: boolean): boolean {
  //@ ensures \result === true
  return sameStandingWant(true, sameDesire, sameCategory, sharedTags, untagged) === sameDesire;
}

/** Story: See and manage the things the Network is looking for / Saying a want again changes nothing that the member paused or closed (spec/standingIntentManagement.md) */
//@ pure
export function standingAddRoute(source: StandingSource, request: boolean, paused: boolean, closed: boolean, closedDaysAgo: number): StandingAddRoute {
  return standingChangeOutcome(source, "AddStanding", false, false, 0, closedDaysAgo) !== "ApplyNow" ? "AddRefused" : (closed ? (request ? "AddReopens" : "AddKeepsClose") : (paused ? "AddKeepsPause" : "AddOpens"));
}

/** Story: See and manage the things the Network is looking for / Saying a want again changes nothing that the member paused or closed (spec/standingIntentManagement.md) */
//@ pure
export function lawAddNeverEndsAPause(source: StandingSource, request: boolean, closedDaysAgo: number): boolean {
  //@ ensures \result === true
  return standingAddRoute(source, request, true, false, closedDaysAgo) !== "AddOpens" && standingAddRoute(source, request, true, false, closedDaysAgo) !== "AddReopens";
}

/** Story: See and manage the things the Network is looking for / Saying a want again changes nothing that the member paused or closed (spec/standingIntentManagement.md) */
//@ pure
export function lawMentionNeverReopens(source: StandingSource, paused: boolean, closedDaysAgo: number): boolean {
  //@ ensures \result === true
  return standingAddRoute(source, false, paused, true, closedDaysAgo) !== "AddReopens" && standingAddRoute(source, false, paused, true, closedDaysAgo) !== "AddOpens";
}

/** Story: See and manage the things the Network is looking for / Saying a want again changes nothing that the member paused or closed (spec/standingIntentManagement.md) */
//@ pure
export function lawRecentCloseRefusesProfileAdd(request: boolean, paused: boolean, closed: boolean, closedDaysAgo: number): boolean {
  //@ ensures \result === true
  return !(closedDaysAgo >= 0 && closedDaysAgo < recentCloseDays) || standingAddRoute("AssistantProfile", request, paused, closed, closedDaysAgo) === "AddRefused";
}

/** Story: See and manage the things the Network is looking for / Saying a want again changes nothing that the member paused or closed (spec/standingIntentManagement.md) */
//@ pure
export function lawAgentNeverAdds(request: boolean, paused: boolean, closed: boolean, closedDaysAgo: number): boolean {
  //@ ensures \result === true
  return standingAddRoute("MemberAgent", request, paused, closed, closedDaysAgo) === "AddRefused";
}

/** Story: See and manage the things the Network is looking for / Reconcile older saved controls during the first normal save (spec/standingIntentManagement.md) */
//@ pure
export function legacyIntentReconciliationDue(savedState: boolean, completed: boolean): boolean {
  return savedState && !completed;
}

/** Story: See and manage the things the Network is looking for / Reconcile older saved controls during the first normal save (spec/standingIntentManagement.md) */
//@ pure
export function reconcileLegacyIntent(storedStatus: string, control: IntentControl, ownerActive: boolean, hadRowAtSave: boolean, withinHorizon: boolean, job: boolean): LegacyIntentChange {
  return !(ownerActive && hadRowAtSave && withinHorizon) || job ? "KeepIntentStatus" : (storedStatus === "active" && control === "PauseControl" ? "ReconcilePause" : ((storedStatus === "active" || storedStatus === "paused") && control === "CloseControl" ? "ReconcileClose" : "KeepIntentStatus"));
}

/** Story: See and manage the things the Network is looking for / Reconcile older saved controls during the first normal save (spec/standingIntentManagement.md) */
//@ pure
export function lawLegacyReconciliationNeverUncloses(control: IntentControl, ownerActive: boolean, hadRowAtSave: boolean, withinHorizon: boolean, job: boolean): boolean {
  //@ ensures \result === true
  return reconcileLegacyIntent("closed", control, ownerActive, hadRowAtSave, withinHorizon, job) === "KeepIntentStatus";
}

/** Story: See and manage the things the Network is looking for / Reconcile older saved controls during the first normal save (spec/standingIntentManagement.md) */
//@ pure
export function lawLegacyReconciliationKeepsIneligible(storedStatus: string, control: IntentControl, ownerActive: boolean, hadRowAtSave: boolean, withinHorizon: boolean, job: boolean): boolean {
  //@ ensures \result === true
  return !(!(ownerActive && hadRowAtSave && withinHorizon) || job) || reconcileLegacyIntent(storedStatus, control, ownerActive, hadRowAtSave, withinHorizon, job) === "KeepIntentStatus";
}

/** Story: See and manage the things the Network is looking for / A pause or close stops only the work linked to that thing (spec/standingIntentManagement.md) */
//@ pure
export function retireIntentSearch(recognizedDesire: boolean, stillLive: boolean): boolean {
  return recognizedDesire && !stillLive;
}

/** Story: See and manage the things the Network is looking for / A pause or close stops only the work linked to that thing (spec/standingIntentManagement.md) */
//@ pure
export function retireStandingOpportunity(linked: boolean, source: StandingSource, control: IntentControl, stage: string): boolean {
  return linked && source !== "AssistantProfile" && (stage === "review" || (stage === "probing" && control === "CloseControl" && source === "MemberThread"));
}

/** Story: See and manage the things the Network is looking for / A pause or close stops only the work linked to that thing (spec/standingIntentManagement.md) */
//@ pure
export function lawPauseNeverRetiresAContact(linked: boolean, source: StandingSource, stage: string): boolean {
  //@ ensures \result === true
  return !(stage !== "review") || !retireStandingOpportunity(linked, source, "PauseControl", stage);
}

/** Story: See and manage the things the Network is looking for / A pause or close stops only the work linked to that thing (spec/standingIntentManagement.md) */
//@ pure
export function lawBookedWorkStays(linked: boolean, source: StandingSource, control: IntentControl): boolean {
  //@ ensures \result === true
  return !retireStandingOpportunity(linked, source, control, "scheduled");
}

/** Story: See and manage the things the Network is looking for / A pause or close stops only the work linked to that thing (spec/standingIntentManagement.md) */
//@ pure
export function lawAgentNeverRetiresAContact(linked: boolean, control: IntentControl): boolean {
  //@ ensures \result === true
  return !retireStandingOpportunity(linked, "MemberAgent", control, "probing");
}

/** Story: See and manage the things the Network is looking for / A bare reply answers only the newest open standing question (spec/standingIntentManagement.md) */
//@ pure
export function standingReplyApplies(pending: StandingPendingKind, reply: StandingReply, ageMs: number): boolean {
  return ageMs < 0 ? false : (reply === "UndoReply" ? (pending === "ClosedByMember" || pending === "PausedByMember" || pending === "PausedByAgent" || pending === "ResumedByAgent") && ageMs < standingUndoWindowMs : (reply === "CloseReply" ? (pending === "PausedByMember" || pending === "PausedByAgent" || pending === "CloseAsked" || pending === "RenewalAsked") && ageMs < standingAskLifetimeMs : (pending === "CloseAsked" || pending === "RenewalAsked") && ageMs < standingAskLifetimeMs));
}

/** Story: See and manage the things the Network is looking for / A bare reply answers only the newest open standing question (spec/standingIntentManagement.md) */
//@ pure
export function standingCloseConfirmed(pending: StandingPendingKind, introNamed: boolean): boolean {
  return pending === "CloseAsked" || ((pending === "PausedByMember" || pending === "PausedByAgent") && introNamed);
}

/** Story: See and manage the things the Network is looking for / A bare reply answers only the newest open standing question (spec/standingIntentManagement.md) */
//@ pure
export function lawNothingPendingTakesNoReply(reply: StandingReply, ageMs: number): boolean {
  //@ ensures \result === true
  return !standingReplyApplies("NoStandingPending", reply, ageMs);
}

/** Story: See and manage the things the Network is looking for / A bare reply answers only the newest open standing question (spec/standingIntentManagement.md) */
//@ pure
export function lawUndoLastsOneDay(pending: StandingPendingKind): boolean {
  //@ ensures \result === true
  return !standingReplyApplies(pending, "UndoReply", standingUndoWindowMs);
}

/** Story: See and manage the things the Network is looking for / A bare reply answers only the newest open standing question (spec/standingIntentManagement.md) */
//@ pure
export function lawQuestionsLapse(pending: StandingPendingKind, reply: StandingReply): boolean {
  //@ ensures \result === true
  return !standingReplyApplies(pending, reply, standingAskLifetimeMs);
}

/** Story: See and manage the things the Network is looking for / A bare reply answers only the newest open standing question (spec/standingIntentManagement.md) */
//@ pure
export function lawClosedIsNotClosedAgain(ageMs: number): boolean {
  //@ ensures \result === true
  return !standingReplyApplies("ClosedByMember", "CloseReply", ageMs);
}

/** Story: See and manage the things the Network is looking for / A bare reply answers only the newest open standing question (spec/standingIntentManagement.md) */
//@ pure
export function lawRenewalAnswerIsNotAConfirmation(introNamed: boolean): boolean {
  //@ ensures \result === true
  return !standingCloseConfirmed("RenewalAsked", introNamed);
}

/** Story: See and manage the things the Network is looking for / A bare reply answers only the newest open standing question (spec/standingIntentManagement.md) */
//@ pure
export function lawSilentPauseIsNotAConfirmation(pending: StandingPendingKind): boolean {
  //@ ensures \result === true
  return !(pending !== "CloseAsked") || !standingCloseConfirmed(pending, false);
}

/** Story: See and manage the things the Network is looking for / A list number names a thing for one day (spec/standingIntentManagement.md) */
//@ pure
export function standingListNumberCurrent(shownAgoMs: number, position: number, count: number): boolean {
  return shownAgoMs >= 0 && shownAgoMs < standingListLifetimeMs && position >= 1 && position <= count;
}

/** Story: See and manage the things the Network is looking for / A list number names a thing for one day (spec/standingIntentManagement.md) */
//@ pure
export function lawStaleListNumberRefused(position: number, count: number): boolean {
  //@ ensures \result === true
  return !standingListNumberCurrent(standingListLifetimeMs, position, count);
}

/** Story: See and manage the things the Network is looking for / A list number names a thing for one day (spec/standingIntentManagement.md) */
//@ pure
export function lawNumberInsideList(shownAgoMs: number, position: number, count: number): boolean {
  //@ ensures \result === true
  return !standingListNumberCurrent(shownAgoMs, position, count) || (position >= 1 && position <= count);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: IntentManagement, event: Event): boolean {
  if (event.type === "authorizeIntentCommand") return canAuthorizeIntentCommand(current);
  if (event.type === "chooseOwnedIntent") return canChooseOwnedIntent(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: IntentManagement, event: Event): IntentManagement {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "authorizeIntentCommand") return canAuthorizeIntentCommand(current) ? authorizeIntentCommand(current, event.allowed, event.command) : current;
  if (event.type === "chooseOwnedIntent") return canChooseOwnedIntent(current) ? chooseOwnedIntent(current, event.matches, event.live, event.paused) : current;
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
  if (raw.type === "authorizeIntentCommand" && typeof raw.allowed === "boolean" && (raw.command === "ListIntents" || raw.command === "PauseIntent" || raw.command === "CloseIntent" || raw.command === "ResumeIntent" || raw.command === "KeepIntent" || raw.command === "UndoIntent")) return { type: "authorizeIntentCommand", allowed: raw.allowed, command: raw.command };
  if (raw.type === "chooseOwnedIntent" && Number.isSafeInteger(raw.matches) && typeof raw.live === "boolean" && typeof raw.paused === "boolean") return { type: "chooseOwnedIntent", matches: raw.matches, live: raw.live, paused: raw.paused };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): IntentManagement | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingMember" || raw.phase === "ShowIntents" || raw.phase === "SelectIntent" || raw.phase === "MemberRefused" || raw.phase === "UnknownIntent" || raw.phase === "AmbiguousIntent" || raw.phase === "IntentUnchanged" || raw.phase === "PauseSelected" || raw.phase === "CloseSelected" || raw.phase === "ResumeSelected" || raw.phase === "KeepSelected" || raw.phase === "UndoRequested") && (raw.command === "ListIntents" || raw.command === "PauseIntent" || raw.command === "CloseIntent" || raw.command === "ResumeIntent" || raw.command === "KeepIntent" || raw.command === "UndoIntent") && Object.keys(raw).length === 2)) return undefined;
  const parsed: IntentManagement = ({ phase: raw.phase, command: raw.command });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): IntentManagement {
  //@ ensures inv(\result)
  return initial;
}
