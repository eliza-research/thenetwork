// GENERATED from spec/standingIntentManagement.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
export type IntentCommandPhase = "AwaitingMember" | "ShowIntents" | "SelectIntent" | "MemberRefused" | "UnknownIntent" | "AmbiguousIntent" | "IntentUnchanged" | "PauseSelected" | "CloseSelected";
/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
export type IntentCommand = "ListIntents" | "PauseIntent" | "CloseIntent";
/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
export interface IntentManagement { phase: IntentCommandPhase; command: IntentCommand }
/** Story: See and manage the things the Network is looking for / Change only the single matching reference the member supplied (spec/standingIntentManagement.md) */
export type IntentControl = "PauseControl" | "CloseControl";
/** Story: See and manage the things the Network is looking for / Reconcile older saved controls during the first normal save (spec/standingIntentManagement.md) */
export type LegacyIntentChange = "KeepIntentStatus" | "ReconcilePause" | "ReconcileClose";

/** One variant per transition in the spec. */
export type Event =
  | { type: "authorizeIntentCommand"; allowed: boolean; command: IntentCommand }
  | { type: "chooseOwnedIntent"; matches: number; live: boolean; paused: boolean };

/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
export const initial: IntentManagement = { phase: "AwaitingMember", command: "ListIntents" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: IntentManagement): boolean {
  return true;
}

/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
//@ pure
export function standingIntentReplayAllowed(canonicalMember: boolean): boolean {
  return canonicalMember;
}

/** Story: See and manage the things the Network is looking for / Only the canonical member can list or manage the app's own intents (spec/standingIntentManagement.md) */
//@ pure
export function intentManagementAllowed(canonicalMembership: boolean, ownNetworkMember: boolean, optedOut: boolean): boolean {
  return canonicalMembership && ownNetworkMember && !optedOut;
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
  return { command: command, phase: !allowed ? "MemberRefused" : (command === "ListIntents" ? "ShowIntents" : "SelectIntent") };
}

/** Story: See and manage the things the Network is looking for / Change only the single matching reference the member supplied (spec/standingIntentManagement.md) */
//@ pure
export function canChooseOwnedIntent(s: IntentManagement): boolean {
  return s.phase === "SelectIntent";
}

/** Story: See and manage the things the Network is looking for / Change only the single matching reference the member supplied (spec/standingIntentManagement.md) */
//@ pure
export function chooseOwnedIntent(s: IntentManagement, matches: number, live: boolean, paused: boolean): IntentManagement {
  //@ ensures (inv(s) && canChooseOwnedIntent(s)) ==> stepChangeRequiresSelection(s, \result)
  return { ...s, phase: matches === 0 ? "UnknownIntent" : (matches !== 1 ? "AmbiguousIntent" : (s.command === "PauseIntent" && live ? "PauseSelected" : (s.command === "CloseIntent" && (live || paused) ? "CloseSelected" : "IntentUnchanged"))) };
}

/** Story: See and manage the things the Network is looking for / Change only the single matching reference the member supplied (spec/standingIntentManagement.md) */
//@ pure
export function effectiveStandingControl(storedStatus: string, control: IntentControl): IntentControl {
  return storedStatus === "closed" || control === "CloseControl" ? "CloseControl" : "PauseControl";
}

/** Story: See and manage the things the Network is looking for / Change only the single matching reference the member supplied (spec/standingIntentManagement.md) */
//@ pure
export function stepChangeRequiresSelection(before: IntentManagement, after: IntentManagement): boolean {
  return !(before.phase !== after.phase && (after.phase === "PauseSelected" || after.phase === "CloseSelected")) || before.phase === "SelectIntent";
}

/** Story: See and manage the things the Network is looking for / Change only the single matching reference the member supplied (spec/standingIntentManagement.md) */
//@ pure
export function sometimesPausesAnIntent(s: IntentManagement): boolean {
  return s.phase === "PauseSelected";
}

/** Story: See and manage the things the Network is looking for / Change only the single matching reference the member supplied (spec/standingIntentManagement.md) */
//@ pure
export function sometimesClosesAnIntent(s: IntentManagement): boolean {
  return s.phase === "CloseSelected";
}

/** Story: See and manage the things the Network is looking for / Commit a stored intent change with its acknowledgment (spec/standingIntentManagement.md) */
//@ pure
export function writesStandingIntentRow(s: IntentManagement, stored: boolean): boolean {
  return stored && (s.phase === "PauseSelected" || s.phase === "CloseSelected");
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

/** Story: See and manage the things the Network is looking for / A pause or close stops only the work linked to that intent (spec/standingIntentManagement.md) */
//@ pure
export function retireIntentOpportunity(directAnchor: boolean, beforeBooking: boolean): boolean {
  return directAnchor && beforeBooking;
}

/** Story: See and manage the things the Network is looking for / A pause or close stops only the work linked to that intent (spec/standingIntentManagement.md) */
//@ pure
export function retireIntentSearch(recognizedDesire: boolean, stillLive: boolean): boolean {
  return recognizedDesire && !stillLive;
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
  if (event.type === "authorizeIntentCommand" && canAuthorizeIntentCommand(current)) return authorizeIntentCommand(current, event.allowed, event.command);
  if (event.type === "chooseOwnedIntent" && canChooseOwnedIntent(current)) return chooseOwnedIntent(current, event.matches, event.live, event.paused);
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
  if (raw.type === "authorizeIntentCommand" && typeof raw.allowed === "boolean" && (raw.command === "ListIntents" || raw.command === "PauseIntent" || raw.command === "CloseIntent")) return { type: "authorizeIntentCommand", allowed: raw.allowed, command: raw.command };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingMember" || raw.phase === "ShowIntents" || raw.phase === "SelectIntent" || raw.phase === "MemberRefused" || raw.phase === "UnknownIntent" || raw.phase === "AmbiguousIntent" || raw.phase === "IntentUnchanged" || raw.phase === "PauseSelected" || raw.phase === "CloseSelected") && (raw.command === "ListIntents" || raw.command === "PauseIntent" || raw.command === "CloseIntent") && Object.keys(raw).length === 2)) return undefined;
  const parsed: IntentManagement = ({ phase: raw.phase, command: raw.command });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): IntentManagement {
  //@ ensures inv(\result)
  return initial;
}
