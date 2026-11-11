// The quiet-hours window as pure minute arithmetic, proved with LemmaScript. quiet-hours.ts turns an
// instant and a zone into local minutes with Intl and calls these; the judge's own clock (packages/sim)
// calls isQuietMinute too. Daylight saving is outside this proof.

export interface QuietWindow {
  /** Local hour (0-23) quiet hours start. */
  startHour: number;
  /** Local hour (0-23) quiet hours end (exclusive). */
  endHour: number;
}

export function isQuietMinute(mins: number, w: QuietWindow): boolean {
  //@ verify
  //@ ensures w.startHour === w.endHour ==> !\result
  if (w.startHour === w.endHour) return false;
  const start = w.startHour * 60, end = w.endHour * 60;
  return start < end ? mins >= start && mins < end : mins >= start || mins < end;
}

/** `k` minutes after `mins`, on the clock of one day. */
export function quietAfter(mins: number, k: number, w: QuietWindow): boolean {
  //@ verify
  return isQuietMinute((mins + k) % 1440, w);
}

/** From a quiet minute: every minute before the result is quiet, and the minute it lands on is not. */
export function minutesUntilAllowed(mins: number, w: QuietWindow): number {
  //@ verify
  //@ requires 0 <= w.startHour && w.startHour < 24 && 0 <= w.endHour && w.endHour < 24
  //@ requires 0 <= mins && mins < 1440
  //@ requires isQuietMinute(mins, w)
  //@ ensures 0 < \result && \result <= 1440
  //@ ensures !quietAfter(mins, \result, w)
  //@ ensures forall(k: number, 0 <= k && k < \result ==> quietAfter(mins, k, w))
  const end = w.endHour * 60;
  return mins < end ? end - mins : 24 * 60 - mins + end;
}
