// GENERATED from spec/replyDuplication.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Withdraw from more than one meeting / Keep each withdrawal and limit its neutral reply (spec/replyDuplication.md) */
export const bookingAcknowledgmentIntervalMs: number = 600000;

/** Story: Withdraw from more than one meeting / Keep each withdrawal and limit its neutral reply (spec/replyDuplication.md) */
//@ pure
export function bookingWithdrawalAcknowledgmentAllowed(direct: boolean, hasAcknowledged: boolean, elapsedMs: number): boolean {
  return direct && (!hasAcknowledged || elapsedMs >= bookingAcknowledgmentIntervalMs);
}

/** Story: Withdraw from more than one meeting / Keep each withdrawal and limit its neutral reply (spec/replyDuplication.md) */
//@ pure
export function lawRecentBookingAcknowledgmentCannotRepeat(direct: boolean, elapsedMs: number): boolean {
  //@ ensures \result === true
  return !(elapsedMs < bookingAcknowledgmentIntervalMs) || !bookingWithdrawalAcknowledgmentAllowed(direct, true, elapsedMs);
}

/** Story: Withdraw from more than one meeting / Keep each withdrawal and limit its neutral reply (spec/replyDuplication.md) */
//@ pure
export function lawBookingAcknowledgmentRequiresDirectWithdrawal(hasAcknowledged: boolean, elapsedMs: number): boolean {
  //@ ensures \result === true
  return !bookingWithdrawalAcknowledgmentAllowed(false, hasAcknowledged, elapsedMs);
}
