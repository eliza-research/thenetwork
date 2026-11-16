// GENERATED from spec/sharedContext.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Let my agent read the safe context for my current account / Only the canonical member of the requested app can receive context (spec/sharedContext.md) */
export type ContextMode = "ModeOpen" | "ModeBusy" | "ModeTraveling" | "ModePaused" | "ModeUnavailable";
/** Story: Let my agent read the safe context for my current account / Only the canonical member of the requested app can receive context (spec/sharedContext.md) */
export type ContextPhase = "CheckingAccount" | "CheckingMembership" | "CheckingMember" | "CheckingLabels" | "CheckingFacets" | "ContextReady" | "Withheld";
/** Story: Let my agent read the safe context for my current account / Only the canonical member of the requested app can receive context (spec/sharedContext.md) */
export interface SharedContext { phase: ContextPhase }

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkAccount"; canReadAccount: boolean }
  | { type: "checkMembership"; exactMember: boolean }
  | { type: "checkMember"; memberAndModeExist: boolean }
  | { type: "checkLabels"; labelsSafe: boolean }
  | { type: "checkFacets"; facetCount: number; oversized: boolean };

/** Story: Let my agent read the safe context for my current account / Check the public labels and each confirmed shareable fact (spec/sharedContext.md) */
export const contextFacetLimit: number = 50;
/** Story: Let my agent read the safe context for my current account / Check the public labels and each confirmed shareable fact (spec/sharedContext.md) */
export const contextFacetSizeLimit: number = 300;
/** Story: Let my agent read the safe context for my current account / Only the canonical member of the requested app can receive context (spec/sharedContext.md) */
export const initial: SharedContext = { phase: "CheckingAccount" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: SharedContext): boolean {
  return true;
}

/** Story: Let my agent read the safe context for my current account / Only the canonical member of the requested app can receive context (spec/sharedContext.md) */
//@ pure
export function contextMode(windowActive: boolean, windowMode: string, baseMode: string): ContextMode {
  return windowActive ? (windowMode === "open" ? "ModeOpen" : (windowMode === "busy" ? "ModeBusy" : (windowMode === "traveling" ? "ModeTraveling" : (windowMode === "paused" ? "ModePaused" : "ModeUnavailable")))) : (baseMode === "normal" || baseMode === "open" || baseMode === "receiving" ? "ModeOpen" : (baseMode === "quiet" ? "ModeBusy" : (baseMode === "paused" ? "ModePaused" : "ModeUnavailable")));
}

/** Story: Let my agent read the safe context for my current account / Only the canonical member of the requested app can receive context (spec/sharedContext.md) */
//@ pure
export function canCheckAccount(context: SharedContext): boolean {
  return context.phase === "CheckingAccount";
}

/** Story: Let my agent read the safe context for my current account / Only the canonical member of the requested app can receive context (spec/sharedContext.md) */
//@ pure
export function checkAccount(context: SharedContext, canReadAccount: boolean): SharedContext {
  //@ ensures (inv(context) && canCheckAccount(context)) ==> stepContextRequiresFacetChecks(context, "checkAccount", \result)
  return { phase: canReadAccount ? "CheckingMembership" : "Withheld" };
}

/** Story: Let my agent read the safe context for my current account / Only the canonical member of the requested app can receive context (spec/sharedContext.md) */
//@ pure
export function canCheckMembership(context: SharedContext): boolean {
  return context.phase === "CheckingMembership";
}

/** Story: Let my agent read the safe context for my current account / Only the canonical member of the requested app can receive context (spec/sharedContext.md) */
//@ pure
export function checkMembership(context: SharedContext, exactMember: boolean): SharedContext {
  //@ ensures (inv(context) && canCheckMembership(context)) ==> stepContextRequiresFacetChecks(context, "checkMembership", \result)
  return { phase: exactMember ? "CheckingMember" : "Withheld" };
}

/** Story: Let my agent read the safe context for my current account / Only the canonical member of the requested app can receive context (spec/sharedContext.md) */
//@ pure
export function canCheckMember(context: SharedContext): boolean {
  return context.phase === "CheckingMember";
}

/** Story: Let my agent read the safe context for my current account / Only the canonical member of the requested app can receive context (spec/sharedContext.md) */
//@ pure
export function checkMember(context: SharedContext, memberAndModeExist: boolean): SharedContext {
  //@ ensures (inv(context) && canCheckMember(context)) ==> stepContextRequiresFacetChecks(context, "checkMember", \result)
  return { phase: memberAndModeExist ? "CheckingLabels" : "Withheld" };
}

/** Story: Let my agent read the safe context for my current account / Check the public labels and each confirmed shareable fact (spec/sharedContext.md) */
//@ pure
export function contextFacetEligible(own: boolean, shareable: boolean, confirmed: boolean, sensitive: boolean, withinValidity: boolean): boolean {
  return own && shareable && confirmed && !sensitive && withinValidity;
}

/** Story: Let my agent read the safe context for my current account / Check the public labels and each confirmed shareable fact (spec/sharedContext.md) */
//@ pure
export function canCheckLabels(context: SharedContext): boolean {
  return context.phase === "CheckingLabels";
}

/** Story: Let my agent read the safe context for my current account / Check the public labels and each confirmed shareable fact (spec/sharedContext.md) */
//@ pure
export function checkLabels(context: SharedContext, labelsSafe: boolean): SharedContext {
  //@ ensures (inv(context) && canCheckLabels(context)) ==> stepContextRequiresFacetChecks(context, "checkLabels", \result)
  return { phase: labelsSafe ? "CheckingFacets" : "Withheld" };
}

/** Story: Let my agent read the safe context for my current account / Check the public labels and each confirmed shareable fact (spec/sharedContext.md) */
//@ pure
export function canCheckFacets(context: SharedContext): boolean {
  return context.phase === "CheckingFacets";
}

/** Story: Let my agent read the safe context for my current account / Check the public labels and each confirmed shareable fact (spec/sharedContext.md) */
//@ pure
export function checkFacets(context: SharedContext, facetCount: number, oversized: boolean): SharedContext {
  //@ ensures (inv(context) && canCheckFacets(context)) ==> stepContextRequiresFacetChecks(context, "checkFacets", \result)
  return { phase: facetCount <= contextFacetLimit && !oversized ? "ContextReady" : "Withheld" };
}

/** Story: Let my agent read the safe context for my current account / Check the public labels and each confirmed shareable fact (spec/sharedContext.md) */
//@ pure
export function stepContextRequiresFacetChecks(before: SharedContext, via: string, after: SharedContext): boolean {
  return !(after.phase === "ContextReady") || (before.phase === "CheckingFacets" && via === "checkFacets");
}

/** Story: Let my agent read the safe context for my current account / Check the public labels and each confirmed shareable fact (spec/sharedContext.md) */
//@ pure
export function sometimesCanReturnContext(context: SharedContext): boolean {
  return context.phase === "ContextReady";
}

/** Story: Let my agent read the safe context for my current account / Matching context requires local presence and eligible age (spec/sharedContext.md) */
//@ pure
export function contextSinglePlayer(present: boolean, ageEligible: boolean): boolean {
  return !(present && ageEligible);
}

/** Story: Let my agent read the safe context for my current account / Matching context requires local presence and eligible age (spec/sharedContext.md) */
//@ pure
export function lawIneligibleAgeIsSinglePlayer(present: boolean): boolean {
  //@ ensures \result === true
  return contextSinglePlayer(present, false);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: SharedContext, event: Event): boolean {
  if (event.type === "checkAccount") return canCheckAccount(current);
  if (event.type === "checkMembership") return canCheckMembership(current);
  if (event.type === "checkMember") return canCheckMember(current);
  if (event.type === "checkLabels") return canCheckLabels(current);
  if (event.type === "checkFacets") return canCheckFacets(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: SharedContext, event: Event): SharedContext {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "checkAccount" && canCheckAccount(current)) return checkAccount(current, event.canReadAccount);
  if (event.type === "checkMembership" && canCheckMembership(current)) return checkMembership(current, event.exactMember);
  if (event.type === "checkMember" && canCheckMember(current)) return checkMember(current, event.memberAndModeExist);
  if (event.type === "checkLabels" && canCheckLabels(current)) return checkLabels(current, event.labelsSafe);
  if (event.type === "checkFacets" && canCheckFacets(current)) return checkFacets(current, event.facetCount, event.oversized);
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
  if (raw.type === "checkAccount" && typeof raw.canReadAccount === "boolean") return { type: "checkAccount", canReadAccount: raw.canReadAccount };
  if (raw.type === "checkMembership" && typeof raw.exactMember === "boolean") return { type: "checkMembership", exactMember: raw.exactMember };
  if (raw.type === "checkMember" && typeof raw.memberAndModeExist === "boolean") return { type: "checkMember", memberAndModeExist: raw.memberAndModeExist };
  if (raw.type === "checkLabels" && typeof raw.labelsSafe === "boolean") return { type: "checkLabels", labelsSafe: raw.labelsSafe };
  if (raw.type === "checkFacets" && Number.isSafeInteger(raw.facetCount) && typeof raw.oversized === "boolean") return { type: "checkFacets", facetCount: raw.facetCount, oversized: raw.oversized };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): SharedContext | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "CheckingAccount" || raw.phase === "CheckingMembership" || raw.phase === "CheckingMember" || raw.phase === "CheckingLabels" || raw.phase === "CheckingFacets" || raw.phase === "ContextReady" || raw.phase === "Withheld") && Object.keys(raw).length === 1)) return undefined;
  const parsed: SharedContext = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): SharedContext {
  //@ ensures inv(\result)
  return initial;
}
