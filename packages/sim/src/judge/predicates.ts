// Judge rules as pure functions, proved with LemmaScript. This file imports nothing, and the limits are
// the judge's own: the caller passes the PRD budget, never the system's config.

/** The instants inside the span that ends at `now`. */
export function inWindow(ts: number[], now: number, span: number): number[] {
  //@ verify
  //@ ensures forall(k: number, 0 <= k && k < \result.length ==> now - \result[k] < span)
  //@ ensures \result.length <= ts.length
  return ts.filter(t => now - t < span);
}

export function underBudget(ts: number[], now: number, span: number, n: number): boolean {
  //@ verify
  //@ ensures \result === (inWindow(ts, now, span).length <= n)
  return inWindow(ts, now, span).length <= n;
}

/**
 * What a Network age log (age_resolved, age_confirmed) says about a member the judge flagged as a minor
 * (from age_unknown, minor_signal or minor_reported). `saysMinor` / `saysAdult`: the log's `minor` field
 * is true / false; `hasAge` and `age`: a stated age in the log.
 */
export interface AgeLog { saysMinor: boolean; saysAdult: boolean; hasAge: boolean; age: number; }

/** The judge clears the flag only on a log that says adult: `minor: false`, or an adult age (18 to 120). */
export function clearsMinorFlag(l: AgeLog): boolean {
  //@ verify
  //@ ensures \result ==> !l.saysMinor
  //@ ensures \result ==> l.saysAdult || (l.hasAge && l.age >= 18 && l.age <= 120)
  //@ ensures !l.saysMinor && l.saysAdult ==> \result
  if (l.saysMinor) return false;
  if (l.saysAdult) return true;
  return l.hasAge && l.age >= 18 && l.age <= 120;
}

export interface Streak { streak: number; reengageUsed: boolean; }
export interface StreakStep { ok: boolean; next: Streak; }

/** The two-unanswered rule: one proactive message past two, once, and only as the single re-engagement. */
export function stepStreak(s: Streak, reengagement: boolean): StreakStep {
  //@ verify
  //@ requires s.streak >= 0
  //@ ensures \result.next.streak === s.streak + 1
  //@ ensures \result.ok ==> s.streak < 2 || (s.streak === 2 && reengagement && !s.reengageUsed)
  //@ ensures s.streak > 2 ==> !\result.ok
  if (s.streak >= 2) {
    if (s.streak === 2 && reengagement && !s.reengageUsed) return { ok: true, next: { streak: s.streak + 1, reengageUsed: true } };
    return { ok: false, next: { streak: s.streak + 1, reengageUsed: s.reengageUsed } };
  }
  return { ok: true, next: { streak: s.streak + 1, reengageUsed: s.reengageUsed } };
}
