// GENERATED from spec/relayDecision.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Keep unsafe items from reaching a match / Any reason from the relay checks blocks the item (spec/relayDecision.md) */
export type RelayVerdict = "Pass" | "Block";
/** Story: Keep unsafe items from reaching a match / A classifier that cannot run blocks the text (spec/relayDecision.md) */
export type ClassifierReading = "ReadingClear" | "ReadingFlagged" | "ReadingUnavailable";
/** Story: Keep unsafe items from reaching a match / A blocked sender learns only what is safe to say (spec/relayDecision.md) */
export type RelayBlockNotice = "NoticePlain" | "NoticeConsent" | "NoticeRating" | "NoticeContact" | "NoticeRetry" | "NoticeRate";
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

/** Story: Share only the item I approved / A refusal or uncertainty cannot authorize a private item (spec/relayDecision.md) */
//@ pure
export function privateRelayRequestAllowed(refused: boolean, uncertain: boolean): boolean {
  return !refused && !uncertain;
}

/** Story: Share only the item I approved / A refusal or uncertainty cannot authorize a private item (spec/relayDecision.md) */
//@ pure
export function lawPrivateRelayRequiresUnqualifiedConsent(refused: boolean, uncertain: boolean): boolean {
  //@ ensures \result === true
  return !(refused || uncertain) || !privateRelayRequestAllowed(refused, uncertain);
}

/** Story: Share only the item I approved / Only the member's own direct request authorizes a private item (spec/relayDecision.md) */
//@ pure
export function privateRelayRequestAddressed(directLead: boolean, reported: boolean): boolean {
  return directLead && !reported;
}

/** Story: Share only the item I approved / Only the member's own direct request authorizes a private item (spec/relayDecision.md) */
//@ pure
export function lawReportedPrivateRequestIsNotConsent(directLead: boolean): boolean {
  //@ ensures \result === true
  return !privateRelayRequestAddressed(directLead, true);
}

/** Story: Share only the item I approved / Only the member's own direct request authorizes a private item (spec/relayDecision.md) */
//@ pure
export function lawIndirectPrivateRequestIsNotConsent(reported: boolean): boolean {
  //@ ensures \result === true
  return !privateRelayRequestAddressed(false, reported);
}

/** Story: Share only the item I approved / A member can take back a pending number swap (spec/relayDecision.md) */
//@ pure
export function pendingSwapWithdrawn(namesOwnContact: boolean, withholdsContact: boolean, declinesPendingSend: boolean): boolean {
  return declinesPendingSend || (namesOwnContact && withholdsContact);
}

/** Story: Share only the item I approved / A member can take back a pending number swap (spec/relayDecision.md) */
//@ pure
export function lawGoAheadKeepsPendingSwap(namesOwnContact: boolean): boolean {
  //@ ensures \result === true
  return !pendingSwapWithdrawn(namesOwnContact, false, false);
}

/** Story: Share only the item I approved / A member can take back a pending number swap (spec/relayDecision.md) */
//@ pure
export function lawDirectRefusalWithdrawsPendingSwap(namesOwnContact: boolean, withholdsContact: boolean): boolean {
  //@ ensures \result === true
  return pendingSwapWithdrawn(namesOwnContact, withholdsContact, true);
}

/** Story: Share only the item I approved / A phone exchange must still have consent at dispatch (spec/relayDecision.md) */
//@ pure
export function relayRecordMayDispatch(passed: boolean, rejected: boolean, withdrawn: boolean): boolean {
  return passed && !rejected && !withdrawn;
}

/** Story: Share only the item I approved / A phone exchange must still have consent at dispatch (spec/relayDecision.md) */
//@ pure
export function lawWithdrawnRelayRecordsCannotDispatch(passed: boolean, rejected: boolean): boolean {
  //@ ensures \result === true
  return !relayRecordMayDispatch(passed, rejected, true);
}

/** Story: Keep unsafe items from reaching a match / Any reason from the relay checks blocks the item (spec/relayDecision.md) */
//@ pure
export function relayVerdict(hasReason: boolean): RelayVerdict {
  return hasReason ? "Block" : "Pass";
}

/** Story: Keep unsafe items from reaching a match / Any reason from the relay checks blocks the item (spec/relayDecision.md) */
//@ pure
export function lawARelayPassHasNoReason(hasReason: boolean): boolean {
  //@ ensures \result === true
  return (relayVerdict(hasReason) === "Pass") === !hasReason;
}

/** Story: Keep unsafe items from reaching a match / The classifier reads a text that the rules leave to it (spec/relayDecision.md) */
//@ pure
export function relayClassifierReads(hasText: boolean, finalReason: boolean, anyReason: boolean, teenPair: boolean): boolean {
  return hasText && !finalReason && (!anyReason || teenPair);
}

/** Story: Keep unsafe items from reaching a match / The classifier reads a text that the rules leave to it (spec/relayDecision.md) */
//@ pure
export function lawAFinalReasonIsNeverSentToTheClassifier(hasText: boolean, anyReason: boolean, teenPair: boolean): boolean {
  //@ ensures \result === true
  return !relayClassifierReads(hasText, true, anyReason, teenPair);
}

/** Story: Keep unsafe items from reaching a match / The classifier reads a text that the rules leave to it (spec/relayDecision.md) */
//@ pure
export function lawACleanTextIsAlwaysRead(teenPair: boolean): boolean {
  //@ ensures \result === true
  return relayClassifierReads(true, false, false, teenPair);
}

/** Story: Keep unsafe items from reaching a match / The classifier reads a text that the rules leave to it (spec/relayDecision.md) */
//@ pure
export function lawAnAdultFlaggedTextIsNotRead(finalReason: boolean): boolean {
  //@ ensures \result === true
  return !relayClassifierReads(true, finalReason, true, false);
}

/** Story: Keep unsafe items from reaching a match / A classifier that cannot run blocks the text (spec/relayDecision.md) */
//@ pure
export function relayClassifierReading(answered: boolean, flagged: boolean): ClassifierReading {
  return !answered ? "ReadingUnavailable" : (flagged ? "ReadingFlagged" : "ReadingClear");
}

/** Story: Keep unsafe items from reaching a match / A classifier that cannot run blocks the text (spec/relayDecision.md) */
//@ pure
export function lawAnUnansweredReadIsUnavailable(flagged: boolean): boolean {
  //@ ensures \result === true
  return relayClassifierReading(false, flagged) === "ReadingUnavailable";
}

/** Story: Keep unsafe items from reaching a match / A classifier that cannot run blocks the text (spec/relayDecision.md) */
//@ pure
export function lawOnlyAnAnsweredUnflaggedReadIsClear(answered: boolean, flagged: boolean): boolean {
  //@ ensures \result === true
  return (relayClassifierReading(answered, flagged) === "ReadingClear") === (answered && !flagged);
}

/** Story: Keep unsafe items from reaching a match / A blocked sender learns only what is safe to say (spec/relayDecision.md) */
//@ pure
export function relayBlockNotice(unsafe: boolean, consent: boolean, rating: boolean, contact: boolean, unchecked: boolean, rate: boolean): RelayBlockNotice {
  return unsafe ? "NoticePlain" : (consent ? "NoticeConsent" : (rating ? "NoticeRating" : (contact ? "NoticeContact" : (unchecked ? "NoticeRetry" : (rate ? "NoticeRate" : "NoticePlain")))));
}

/** Story: Keep unsafe items from reaching a match / A blocked sender learns only what is safe to say (spec/relayDecision.md) */
//@ pure
export function lawAnUnsafeReasonIsNeverExplained(consent: boolean, rating: boolean, contact: boolean, unchecked: boolean, rate: boolean): boolean {
  //@ ensures \result === true
  return relayBlockNotice(true, consent, rating, contact, unchecked, rate) === "NoticePlain";
}

/** Story: Keep unsafe items from reaching a match / A blocked sender learns only what is safe to say (spec/relayDecision.md) */
//@ pure
export function lawRetryOnlyWhenTheClassifierAloneStoppedIt(unsafe: boolean, consent: boolean, rating: boolean, contact: boolean, unchecked: boolean, rate: boolean): boolean {
  //@ ensures \result === true
  return !(relayBlockNotice(unsafe, consent, rating, contact, unchecked, rate) === "NoticeRetry") || (unchecked && !unsafe && !consent && !rating && !contact);
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

/** Story: Keep unsafe items from reaching a match / The desk reads the sender's stated age before the engine reads the text (spec/relayDecision.md) */
//@ pure
export function relayAgeStatementRead(hasText: boolean, teenPair: boolean, saysYounger: boolean): boolean {
  return hasText && (!teenPair || saysYounger);
}

/** Story: Keep unsafe items from reaching a match / The desk reads the sender's stated age before the engine reads the text (spec/relayDecision.md) */
//@ pure
export function relayAgeStatementRefuses(statedMinorAge: boolean, teenPair: boolean, senderMarkedMinor: boolean): boolean {
  return statedMinorAge && (!teenPair || senderMarkedMinor);
}

/** Story: Keep unsafe items from reaching a match / The desk reads the sender's stated age before the engine reads the text (spec/relayDecision.md) */
//@ pure
export function lawAnAdultPairTextIsAlwaysRead(saysYounger: boolean): boolean {
  //@ ensures \result === true
  return relayAgeStatementRead(true, false, saysYounger);
}

/** Story: Keep unsafe items from reaching a match / The desk reads the sender's stated age before the engine reads the text (spec/relayDecision.md) */
//@ pure
export function lawNoStatedAgeRefusesNothing(teenPair: boolean, senderMarkedMinor: boolean): boolean {
  //@ ensures \result === true
  return !relayAgeStatementRefuses(false, teenPair, senderMarkedMinor);
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
