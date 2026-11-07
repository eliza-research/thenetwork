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
