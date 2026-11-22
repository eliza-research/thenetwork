// GENERATED from spec/relayDecision.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Keep unsafe items from reaching a match / A blocking reason takes precedence over a hold (spec/relayDecision.md) */
export type RelayVerdict = "Pass" | "Hold" | "Block";
/** Story: Relay only to the match I named / A relay names its match when the member has more than one live match (spec/relayDecision.md) */
export type RelayTargetChoice = "RelayToNoMatch" | "RelayAskWhichMatch" | "RelayToNamedMatch" | "RelayToOnlyMatch" | "RelayNamedNotLive";
/** Story: Relay only to the match I named / A number ask with several live matches is never scored as abuse (spec/relayDecision.md) */
export type NumberAskChoice = "NumberAskOpens" | "NumberAskScored";


/** Story: Share only the item I approved / Consent cannot come from the future or outlive the item window (spec/relayDecision.md) */
//@ pure
export function relayConsentStale(consentAt: number, itemAt: number, lifetime: number): boolean {
  return consentAt > itemAt || exact_relayDecision(itemAt - consentAt) > lifetime;
}

/** Story: Share only the item I approved / Consent cannot come from the future or outlive the item window (spec/relayDecision.md) */
//@ pure
export function lawFutureConsentIsStale(consentAt: number, itemAt: number, lifetime: number): boolean {
  //@ ensures \result === true
  return !(consentAt > itemAt) || relayConsentStale(consentAt, itemAt, lifetime);
}

/** Story: Keep unsafe items from reaching a match / A blocking reason takes precedence over a hold (spec/relayDecision.md) */
//@ pure
export function relayVerdict(hasBlock: boolean, hasReason: boolean): RelayVerdict {
  return hasBlock ? "Block" : (hasReason ? "Hold" : "Pass");
}

/** Story: Keep unsafe items from reaching a match / A blocking reason takes precedence over a hold (spec/relayDecision.md) */
//@ pure
export function lawARelayPassHasNoReason(hasBlock: boolean, hasReason: boolean): boolean {
  //@ ensures \result === true
  return !(relayVerdict(hasBlock, hasReason) === "Pass") || (!hasBlock && !hasReason);
}

/** Story: Keep unsafe items from reaching a match / A relay text that says the sender is under 18 starts the minors policy (spec/relayDecision.md) */
//@ pure
export function relayStartsMinorPolicy(ageSignal: boolean, senderMarkedMinor: boolean): boolean {
  return ageSignal && !senderMarkedMinor;
}

/** Story: Keep unsafe items from reaching a match / A relay text that says the sender is under 18 starts the minors policy (spec/relayDecision.md) */
//@ pure
export function lawAnUnmarkedSenderStartsTheMinorsPolicyExactlyOnAnAgeSignal(ageSignal: boolean): boolean {
  //@ ensures \result === true
  return relayStartsMinorPolicy(ageSignal, false) === ageSignal;
}

/** Story: Keep unsafe items from reaching a match / A relay text that says the sender is under 18 starts the minors policy (spec/relayDecision.md) */
//@ pure
export function lawAMarkedSenderGetsNoSecondMinorsPolicy(ageSignal: boolean): boolean {
  //@ ensures \result === true
  return !relayStartsMinorPolicy(ageSignal, true);
}

/** Story: Keep unsafe items from reaching a match / A relay text that says the sender is under 18 starts the minors policy (spec/relayDecision.md) */
//@ pure
export function lawNoAgeSignalStartsNoMinorsPolicy(senderMarkedMinor: boolean): boolean {
  //@ ensures \result === true
  return !relayStartsMinorPolicy(false, senderMarkedMinor);
}

/** Story: Keep unsafe items from reaching a match / A block for the sender's severe words reaches the sender's safety case (spec/relayDecision.md) */
//@ pure
export function relaySevereBlockCaseEvent(verdict: RelayVerdict, severeReason: boolean): boolean {
  return verdict === "Block" && severeReason;
}

/** Story: Keep unsafe items from reaching a match / A block for the sender's severe words reaches the sender's safety case (spec/relayDecision.md) */
//@ pure
export function lawABlockWritesACaseEventExactlyForASevereReason(severeReason: boolean): boolean {
  //@ ensures \result === true
  return relaySevereBlockCaseEvent("Block", severeReason) === severeReason;
}

/** Story: Keep unsafe items from reaching a match / A block for the sender's severe words reaches the sender's safety case (spec/relayDecision.md) */
//@ pure
export function lawAPassWritesNoCaseEvent(severeReason: boolean): boolean {
  //@ ensures \result === true
  return !relaySevereBlockCaseEvent("Pass", severeReason);
}

/** Story: Keep unsafe items from reaching a match / A block for the sender's severe words reaches the sender's safety case (spec/relayDecision.md) */
//@ pure
export function lawNoSevereReasonWritesNoCaseEvent(verdict: RelayVerdict): boolean {
  //@ ensures \result === true
  return !relaySevereBlockCaseEvent(verdict, false);
}

/** Story: Keep unsafe items from reaching a match / A block for the sender's severe words reaches the sender's safety case (spec/relayDecision.md) */
//@ pure
export function lawAHeldItemWritesNoCaseEvent(severeReason: boolean): boolean {
  //@ ensures \result === true
  return !relaySevereBlockCaseEvent("Hold", severeReason);
}

/** Story: Relay only to the match I named / A relay names its match when the member has more than one live match (spec/relayDecision.md) */
//@ pure
export function relayTarget(liveMatches: number, named: boolean, namedLive: boolean): RelayTargetChoice {
  return named ? (namedLive ? "RelayToNamedMatch" : "RelayNamedNotLive") : (liveMatches === 1 ? "RelayToOnlyMatch" : (liveMatches > 1 ? "RelayAskWhichMatch" : "RelayToNoMatch"));
}

/** Story: Relay only to the match I named / A relay names its match when the member has more than one live match (spec/relayDecision.md) */
//@ pure
export function lawNeverGuessBetweenMatches(liveMatches: number, namedLive: boolean): boolean {
  //@ ensures \result === true
  return !(liveMatches > 1) || relayTarget(liveMatches, false, namedLive) === "RelayAskWhichMatch";
}

/** Story: Relay only to the match I named / A relay names its match when the member has more than one live match (spec/relayDecision.md) */
//@ pure
export function lawNamedTargetIsLive(liveMatches: number, named: boolean, namedLive: boolean): boolean {
  //@ ensures \result === true
  return !(relayTarget(liveMatches, named, namedLive) === "RelayToNamedMatch") || (named && namedLive);
}

/** Story: Relay only to the match I named / A number ask with several live matches is never scored as abuse (spec/relayDecision.md) */
//@ pure
export function numberAsk(liveMatches: number, asks: boolean, everyAskNamesLiveMatch: boolean, otherContact: boolean): NumberAskChoice {
  return liveMatches >= 1 && asks && everyAskNamesLiveMatch && !otherContact ? "NumberAskOpens" : "NumberAskScored";
}

/** Story: Relay only to the match I named / A number ask with several live matches is never scored as abuse (spec/relayDecision.md) */
//@ pure
export function lawNumberAskNeedsALiveMatch(liveMatches: number, asks: boolean, everyAskNamesLiveMatch: boolean, otherContact: boolean): boolean {
  //@ ensures \result === true
  return !(numberAsk(liveMatches, asks, everyAskNamesLiveMatch, otherContact) === "NumberAskOpens") || (liveMatches >= 1 && asks && everyAskNamesLiveMatch && !otherContact);
}

/** Story: Relay only to the match I named / A number ask with several live matches is never scored as abuse (spec/relayDecision.md) */
//@ pure
export function lawSeveralMatchesAreNotAbuse(liveMatches: number): boolean {
  //@ ensures \result === true
  return !(liveMatches > 1) || numberAsk(liveMatches, true, true, false) === "NumberAskOpens";
}

/** Story: End the thread after a bad meeting / Negative feedback after a meeting ends the relay thread (spec/relayDecision.md) */
//@ pure
export function relayThreadOpen(mutual: boolean, bothSaidYes: boolean, negativeFeedback: boolean): boolean {
  return mutual && bothSaidYes && !negativeFeedback;
}

/** Story: End the thread after a bad meeting / Negative feedback after a meeting ends the relay thread (spec/relayDecision.md) */
//@ pure
export function lawNegativeFeedbackEndsTheThread(mutual: boolean, bothSaidYes: boolean): boolean {
  //@ ensures \result === true
  return !relayThreadOpen(mutual, bothSaidYes, true);
}

/** Story: End the thread after a bad meeting / Negative feedback after a meeting ends the relay thread (spec/relayDecision.md) */
//@ pure
export function lawNoThreadWithoutMutualYes(bothSaidYes: boolean, negativeFeedback: boolean): boolean {
  //@ ensures \result === true
  return !relayThreadOpen(false, bothSaidYes, negativeFeedback) && !relayThreadOpen(true, false, negativeFeedback);
}

/** Story: End the thread after a bad meeting / Negative feedback after a meeting ends the relay thread (spec/relayDecision.md) */
//@ pure
export function lawEndedOnlyThreadHasNoRelayTarget(mutual: boolean, bothSaidYes: boolean, named: boolean): boolean {
  //@ ensures \result === true
  return relayTarget(relayThreadOpen(mutual, bothSaidYes, true) ? 1 : 0, named, relayThreadOpen(mutual, bothSaidYes, true)) === (named ? "RelayNamedNotLive" : "RelayToNoMatch");
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_relayDecision(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
