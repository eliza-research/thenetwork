// GENERATED from spec/matchingHistory.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Use what each invitee did / Preserve a booked or held group and record individual refusals (spec/matchingHistory.md) */
export type MatchingHistoryOutcome = "HistoryCompleted" | "HistoryNoShow" | "HistoryBooked" | "HistoryDeclined" | "HistoryExpired" | "HistoryInviting";
/** Story: Use what each invitee did / Preserve a booked or held group and record individual refusals (spec/matchingHistory.md) */
export type MatchingPairHistory = "HistoryRecordedPair" | "HistoryRefusedPair" | "HistoryOmittedPair";


/** Story: Use what each invitee did / Preserve a booked or held group and record individual refusals (spec/matchingHistory.md) */
//@ pure
export function matchingHistoryOutcome(attendance: boolean, held: boolean, booked: boolean, declined: boolean, expired: boolean): MatchingHistoryOutcome {
  return attendance ? (held ? "HistoryCompleted" : "HistoryNoShow") : (booked ? "HistoryBooked" : (declined ? "HistoryDeclined" : (expired ? "HistoryExpired" : "HistoryInviting")));
}

/** Story: Use what each invitee did / Preserve a booked or held group and record individual refusals (spec/matchingHistory.md) */
//@ pure
export function matchingPairHistory(rosterPair: boolean, pairHasRefusal: boolean, unconfirmedGroupDeclined: boolean): MatchingPairHistory {
  return pairHasRefusal ? "HistoryRefusedPair" : (rosterPair && !unconfirmedGroupDeclined ? "HistoryRecordedPair" : "HistoryOmittedPair");
}

/** Story: Use what each invitee did / Preserve a booked or held group and record individual refusals (spec/matchingHistory.md) */
//@ pure
export function lawAttendanceKeepsHeldGroup(booked: boolean, declined: boolean, expired: boolean): boolean {
  //@ ensures \result === true
  return matchingHistoryOutcome(true, true, booked, declined, expired) === "HistoryCompleted";
}

/** Story: Use what each invitee did / Preserve a booked or held group and record individual refusals (spec/matchingHistory.md) */
//@ pure
export function lawBookedGroupKeepsItsBooking(declined: boolean, expired: boolean): boolean {
  //@ ensures \result === true
  return matchingHistoryOutcome(false, false, true, declined, expired) === "HistoryBooked";
}

/** Story: Use what each invitee did / Preserve a booked or held group and record individual refusals (spec/matchingHistory.md) */
//@ pure
export function lawPairRefusalRequiresARecordedRefusal(rosterPair: boolean, unconfirmedGroupDeclined: boolean): boolean {
  //@ ensures \result === true
  return matchingPairHistory(rosterPair, false, unconfirmedGroupDeclined) !== "HistoryRefusedPair";
}

/** Story: Use what each invitee did / Apply a category cooldown to the person whose answer is known (spec/matchingHistory.md) */
//@ pure
export function matchingExpiryCooldown(knownResponses: boolean, recipientDidNotReply: boolean, listedParticipant: boolean): boolean {
  return knownResponses ? recipientDidNotReply : listedParticipant;
}

/** Story: Use what each invitee did / Apply a category cooldown to the person whose answer is known (spec/matchingHistory.md) */
//@ pure
export function lawKnownExpiryRequiresARecipientWithoutAReply(listedParticipant: boolean): boolean {
  //@ ensures \result === true
  return !matchingExpiryCooldown(true, false, listedParticipant);
}
