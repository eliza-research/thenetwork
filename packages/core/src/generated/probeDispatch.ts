// GENERATED from spec/probeDispatch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md:9) */
export type ProbePhase = "Queued" | "AwaitingReply" | "Available" | "Unavailable" | "OutsideProbe";
/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md:9) */
export interface ParticipantProbe { phase: ProbePhase }
/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md:42) */
export type ProbeTiming = "WaitForQuestion" | "WaitForWindow" | "CheckAvailability";
/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md:42) */
export type ProbeAvailability = "ReadyToSend" | "ParticipantAway" | "NoCommonTime";
/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md:101) */
export type ReplacementRoute = "IgnoreReplacement" | "CloseRequester" | "CloseManager" | "FindAlternate";

/** One variant per transition in the spec. */
export type Event =
  | { type: "openTurn"; first: boolean; firstAvailable: boolean }
  | { type: "usePriorIntent"; primed: boolean; contacted: boolean; needsTimes: boolean }
  | { type: "markUnavailable" }
  | { type: "recordReply"; agreed: boolean }
  | { type: "offerOtherTimes"; hasFreshTimes: boolean }
  | { type: "expireProbe"; expired: boolean; timeQuestion: boolean };

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md:65) */
export const probeResponseMs: number = exact_probeDispatch(26 * 3600000);
/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md:9) */
export const initial: ParticipantProbe = { phase: "Queued" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ParticipantProbe): boolean {
  return true;
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md:9) */
//@ pure
export function openTurn(participant: ParticipantProbe, first: boolean, firstAvailable: boolean): ParticipantProbe {
  //@ ensures (inv(participant) && canOpenTurn(participant, first, firstAvailable)) ==> stepUnavailableNeverReopens(participant, \result)
  return { phase: "AwaitingReply" };
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md:9) */
//@ pure
export function probePending(participant: ParticipantProbe): boolean {
  return participant.phase === "Queued" || participant.phase === "AwaitingReply";
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md:9) */
//@ pure
export function usePriorIntent(participant: ParticipantProbe, primed: boolean, contacted: boolean, needsTimes: boolean): ParticipantProbe {
  //@ ensures (inv(participant) && canUsePriorIntent(participant, primed, contacted, needsTimes)) ==> stepUnavailableNeverReopens(participant, \result)
  return { phase: "Available" };
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md:9) */
//@ pure
export function turnReached(participant: ParticipantProbe, first: boolean, firstAvailable: boolean): boolean {
  return probePending(participant) && (first || firstAvailable);
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md:9) */
//@ pure
export function mayUsePriorIntent(participant: ParticipantProbe, primed: boolean, contacted: boolean): boolean {
  return probePending(participant) && primed && !contacted;
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md:9) */
//@ pure
export function canOpenTurn(participant: ParticipantProbe, first: boolean, firstAvailable: boolean): boolean {
  return participant.phase === "Queued" && turnReached(participant, first, firstAvailable);
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md:9) */
//@ pure
export function lawLaterTurnRequiresFirst(participant: ParticipantProbe): boolean {
  //@ ensures \result === true
  return !turnReached(participant, false, false);
}

/** Story: Hear about one reviewed opportunity at a time / The first participant opens the later turns (spec/probeDispatch.md:9) */
//@ pure
export function canUsePriorIntent(participant: ParticipantProbe, primed: boolean, contacted: boolean, needsTimes: boolean): boolean {
  return mayUsePriorIntent(participant, primed, contacted) && !needsTimes;
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md:42) */
//@ pure
export function probeIsInvite(requester: boolean, hiringManager: boolean): boolean {
  return !(requester || hiringManager);
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md:42) */
//@ pure
export function needsProbeSend(participant: ParticipantProbe, contacted: boolean): boolean {
  return participant.phase === "AwaitingReply" && !contacted;
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md:42) */
//@ pure
export function probeTiming(questionOpen: boolean, windowOpen: boolean): ProbeTiming {
  return questionOpen ? "WaitForQuestion" : (!windowOpen ? "WaitForWindow" : "CheckAvailability");
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md:42) */
//@ pure
export function probeAvailability(present: boolean, commonTimeGone: boolean): ProbeAvailability {
  return !present ? "ParticipantAway" : (commonTimeGone ? "NoCommonTime" : "ReadyToSend");
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md:42) */
//@ pure
export function canMarkUnavailable(participant: ParticipantProbe): boolean {
  return participant.phase === "AwaitingReply";
}

/** Story: Hear about one reviewed opportunity at a time / Wait for the member's send window and current availability (spec/probeDispatch.md:42) */
//@ pure
export function markUnavailable(participant: ParticipantProbe): ParticipantProbe {
  //@ ensures (inv(participant) && canMarkUnavailable(participant)) ==> stepUnavailableNeverReopens(participant, \result)
  return { phase: "Unavailable" };
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md:65) */
//@ pure
export function needsOtherTimes(offeredTimes: boolean, pickedTimes: boolean): boolean {
  return offeredTimes && !pickedTimes;
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md:65) */
//@ pure
export function probeExpiryDeadline(sent: boolean, responseDeadline: number, sendDeadline: number): number {
  return sent ? responseDeadline : sendDeadline;
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md:65) */
//@ pure
export function probeExpired(asOf: number, deadline: number): boolean {
  return asOf >= deadline;
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md:65) */
//@ pure
export function canRecordReply(participant: ParticipantProbe): boolean {
  return participant.phase === "AwaitingReply";
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md:65) */
//@ pure
export function recordReply(participant: ParticipantProbe, agreed: boolean): ParticipantProbe {
  //@ ensures (inv(participant) && canRecordReply(participant)) ==> stepUnavailableNeverReopens(participant, \result)
  return { phase: agreed ? "Available" : "Unavailable" };
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md:65) */
//@ pure
export function shouldLookForOtherTimes(offeredTimes: boolean, pickedTimes: boolean, offeredAgain: boolean): boolean {
  return needsOtherTimes(offeredTimes, pickedTimes) && !offeredAgain;
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md:65) */
//@ pure
export function canOfferOtherTimes(participant: ParticipantProbe, hasFreshTimes: boolean): boolean {
  return participant.phase === "Available" && hasFreshTimes;
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md:65) */
//@ pure
export function offerOtherTimes(participant: ParticipantProbe, hasFreshTimes: boolean): ParticipantProbe {
  //@ ensures (inv(participant) && canOfferOtherTimes(participant, hasFreshTimes)) ==> stepUnavailableNeverReopens(participant, \result)
  return { phase: "AwaitingReply" };
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md:65) */
//@ pure
export function canExpireProbe(participant: ParticipantProbe, expired: boolean): boolean {
  return participant.phase === "AwaitingReply" && expired;
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md:65) */
//@ pure
export function expireProbe(participant: ParticipantProbe, expired: boolean, timeQuestion: boolean): ParticipantProbe {
  //@ ensures (inv(participant) && canExpireProbe(participant, expired)) ==> stepUnavailableNeverReopens(participant, \result)
  return { phase: timeQuestion ? "Available" : "Unavailable" };
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md:65) */
//@ pure
export function stepUnavailableNeverReopens(before: ParticipantProbe, after: ParticipantProbe): boolean {
  return !(before.phase === "Unavailable") || after.phase === "Unavailable";
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md:65) */
//@ pure
export function sometimesAgreed(participant: ParticipantProbe): boolean {
  return participant.phase === "Available";
}

/** Story: Hear about one reviewed opportunity at a time / A reply or an expired deadline settles the probe (spec/probeDispatch.md:65) */
//@ pure
export function sometimesSettledNo(participant: ParticipantProbe): boolean {
  return participant.phase === "Unavailable";
}

/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md:101) */
//@ pure
export function mayTryAlternate(alternatesRemain: boolean, replaced: number): boolean {
  return alternatesRemain && replaced < 3;
}

/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md:101) */
//@ pure
export function alternateAllowed(eligible: boolean, sameFirstName: boolean, conflict: boolean): boolean {
  return eligible && !sameFirstName && !conflict;
}

/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md:101) */
//@ pure
export function replacementRoute(probing: boolean, requesterOut: boolean, managerOut: boolean): ReplacementRoute {
  return !probing ? "IgnoreReplacement" : (requesterOut ? "CloseRequester" : (managerOut ? "CloseManager" : "FindAlternate"));
}

/** Story: Hear about one reviewed opportunity at a time / A replacement keeps the requester or hiring manager and all eligible group members (spec/probeDispatch.md:101) */
//@ pure
export function lawRequiredParticipantCannotBeReplaced(probing: boolean, requesterOut: boolean, managerOut: boolean): boolean {
  //@ ensures \result === true
  return !(requesterOut || managerOut) || replacementRoute(probing, requesterOut, managerOut) !== "FindAlternate";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ParticipantProbe, event: Event): boolean {
  if (event.type === "openTurn") return canOpenTurn(current, event.first, event.firstAvailable);
  if (event.type === "usePriorIntent") return canUsePriorIntent(current, event.primed, event.contacted, event.needsTimes);
  if (event.type === "markUnavailable") return canMarkUnavailable(current);
  if (event.type === "recordReply") return canRecordReply(current);
  if (event.type === "offerOtherTimes") return canOfferOtherTimes(current, event.hasFreshTimes);
  if (event.type === "expireProbe") return canExpireProbe(current, event.expired);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ParticipantProbe, event: Event): ParticipantProbe {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "openTurn" && canOpenTurn(current, event.first, event.firstAvailable)) return openTurn(current, event.first, event.firstAvailable);
  if (event.type === "usePriorIntent" && canUsePriorIntent(current, event.primed, event.contacted, event.needsTimes)) return usePriorIntent(current, event.primed, event.contacted, event.needsTimes);
  if (event.type === "markUnavailable" && canMarkUnavailable(current)) return markUnavailable(current);
  if (event.type === "recordReply" && canRecordReply(current)) return recordReply(current, event.agreed);
  if (event.type === "offerOtherTimes" && canOfferOtherTimes(current, event.hasFreshTimes)) return offerOtherTimes(current, event.hasFreshTimes);
  if (event.type === "expireProbe" && canExpireProbe(current, event.expired)) return expireProbe(current, event.expired, event.timeQuestion);
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
  if (raw.type === "openTurn" && typeof raw.first === "boolean" && typeof raw.firstAvailable === "boolean") return { type: "openTurn", first: raw.first, firstAvailable: raw.firstAvailable };
  if (raw.type === "usePriorIntent" && typeof raw.primed === "boolean" && typeof raw.contacted === "boolean" && typeof raw.needsTimes === "boolean") return { type: "usePriorIntent", primed: raw.primed, contacted: raw.contacted, needsTimes: raw.needsTimes };
  if (raw.type === "markUnavailable") return { type: "markUnavailable" };
  if (raw.type === "recordReply" && typeof raw.agreed === "boolean") return { type: "recordReply", agreed: raw.agreed };
  if (raw.type === "offerOtherTimes" && typeof raw.hasFreshTimes === "boolean") return { type: "offerOtherTimes", hasFreshTimes: raw.hasFreshTimes };
  if (raw.type === "expireProbe" && typeof raw.expired === "boolean" && typeof raw.timeQuestion === "boolean") return { type: "expireProbe", expired: raw.expired, timeQuestion: raw.timeQuestion };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ParticipantProbe | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Queued" || raw.phase === "AwaitingReply" || raw.phase === "Available" || raw.phase === "Unavailable" || raw.phase === "OutsideProbe") && Object.keys(raw).length === 1)) return undefined;
  const parsed: ParticipantProbe = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ParticipantProbe {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_probeDispatch(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
