// The decisions of The Network's member and pair rules (rules.ts), proved with LemmaScript
// (docs/formal-verification.md). Import-free. rules.ts reads the World and the config and does the
// arithmetic of the windows (days * DAY). These functions take the plain facts and give the decision.
// A boolean input is trusted here: `minor` is isMinorAge(age) from filters.ts (core policy), read by
// the caller. Numbers are ideal in the proofs, so NaN and Infinity stay with the sims.

// ------------------------------------------------------------------------------------ budgets

/** A budget is used up when the count plus the planned extra is at or over the limit. */
export function budgetReached(used: number, extra: number, limit: number): boolean {
  //@ verify
  //@ type used real
  //@ type extra real
  //@ type limit real
  //@ ensures \result === (used + extra >= limit)
  return used + extra >= limit;
}

/** The interruption budget. A member at or over the limit of the state is refused. */
export function interruptionBudgetReason(used: number, extra: number, limit: number): string | null {
  //@ verify
  //@ type used real
  //@ type extra real
  //@ type limit real
  //@ ensures used + extra >= limit ==> \result === "interruption_budget"
  //@ ensures \result === null ==> used + extra < limit
  return budgetReached(used, extra, limit) ? "interruption_budget" : null;
}

/** The contribution budget. Only a contributor role counts against it. */
export function contributionBudgetReason(contributor: boolean, used: number, extra: number, limit: number): string | null {
  //@ verify
  //@ type used real
  //@ type extra real
  //@ type limit real
  //@ ensures contributor && used + extra >= limit ==> \result === "contribution_budget"
  //@ ensures \result === null ==> !contributor || used + extra < limit
  //@ ensures !contributor ==> \result === null
  return contributor && budgetReached(used, extra, limit) ? "contribution_budget" : null;
}

/** The category quota. No quota is no limit. */
export function categoryQuotaReason(quota: number | undefined, count: number): string | null {
  //@ verify
  //@ ensures quota === undefined ==> \result === null
  //@ ensures quota !== undefined ==> ((\result === null) === (count < quota))
  if (quota === undefined) return null;
  return count >= quota ? "category_quota" : null;
}

// ------------------------------------------------------------------------------------ windows

/** True while an event at `at` is less than `window` old. No event is no cooldown. */
export function inCooldown(now: number, at: number | undefined, window: number): boolean {
  //@ verify
  //@ ensures at === undefined ==> !\result
  //@ ensures at !== undefined ==> (\result === (now - at < window))
  return at === undefined ? false : now - at < window;
}

/** The category cooldown after a decline. A member who declined the category in the window is refused. */
export function categoryCooldownReason(now: number, declinedAt: number | undefined, window: number): string | null {
  //@ verify
  //@ ensures inCooldown(now, declinedAt, window) ==> \result === "category_cooldown"
  //@ ensures \result === null ==> !inCooldown(now, declinedAt, window)
  return inCooldown(now, declinedAt, window) ? "category_cooldown" : null;
}

/** The pair cooldown after negative feedback. The answer does not depend on the order of the pair. */
export function negativeFeedbackReason(now: number, feedbackAt: number | undefined, window: number): string | null {
  //@ verify
  //@ ensures inCooldown(now, feedbackAt, window) ==> \result === "negative_feedback_cooldown"
  //@ ensures \result === null ==> !inCooldown(now, feedbackAt, window)
  return inCooldown(now, feedbackAt, window) ? "negative_feedback_cooldown" : null;
}

/** True when the member asked in the window: the window here includes its last instant. */
export function askedRecently(now: number, intentAt: number | undefined, window: number): boolean {
  //@ verify
  //@ ensures intentAt === undefined ==> !\result
  //@ ensures intentAt !== undefined ==> (\result === (now - intentAt <= window))
  return intentAt === undefined ? false : now - intentAt <= window;
}

/** A member who asked for "only when asked", or who left 2 proactive messages unanswered, is refused unless they asked recently. */
export function onlyWhenAskedReason(onlyWhenAsked: boolean, unanswered: number, asked: boolean): string | null {
  //@ verify
  //@ ensures \result !== null <==> ((onlyWhenAsked || unanswered >= 2) && !asked)
  //@ ensures \result !== null ==> \result === "only_when_asked"
  return (onlyWhenAsked || unanswered >= 2) && !asked ? "only_when_asked" : null;
}

/** Two no-shows with no completed meetup since: only a one-to-one that is not time-sensitive is allowed. The caller passes only a known record. */
export function reliabilityHoldoutReason(noShows: number, completedSince: number, oneToOne: boolean, timeSensitive: boolean): string | null {
  //@ verify
  //@ ensures \result !== null <==> (noShows >= 2 && completedSince === 0 && (!oneToOne || timeSensitive))
  //@ ensures \result !== null ==> \result === "reliability_holdout"
  return noShows >= 2 && completedSince === 0 && (!oneToOne || timeSensitive) ? "reliability_holdout" : null;
}

// ------------------------------------------------------------------------------------ pair history

/** One past interaction of the pair. */
export interface PairRecord { outcome: string; at: number }

/** The outcomes that start a pair cooldown. A completed or accepted interaction never blocks (ME-005). */
export function coolingOutcome(outcome: string): boolean {
  //@ verify
  return outcome === "declined" || outcome === "expired" || outcome === "cancelled";
}

/** True when some declined, expired or cancelled interaction of the pair is less than `window` old. */
export function pairCooling(records: PairRecord[], now: number, window: number): boolean {
  //@ verify
  //@ ensures \result <==> exists(i: nat, i < records.length && coolingOutcome(records[i].outcome) && now - records[i].at < window)
  return records.some(r => coolingOutcome(r.outcome) && now - r.at < window);
}

/** The pair cooldown reason. */
export function pairCooldownReason(records: PairRecord[], now: number, window: number): string | null {
  //@ verify
  //@ ensures pairCooling(records, now, window) ==> \result === "pair_cooldown"
  //@ ensures \result === null ==> !pairCooling(records, now, window)
  return pairCooling(records, now, window) ? "pair_cooldown" : null;
}

// ------------------------------------------------------------------------------------ romance

/** A member's stated romance constraints (RomanceProfile in world.ts). */
export interface RomanceRange { ageMin: number; ageMax: number; seeks: string[] }

/** True when some sought value is in the other person's list. */
export function sharesOne(seeks: string[], is: string[]): boolean {
  //@ verify
  //@ ensures \result <==> exists(i: nat, i < seeks.length && is.includes(seeks[i]))
  return seeks.some(x => is.includes(x));
}

/**
 * One direction: the seeker's stated age range and orientation admit the other person. No stated
 * constraints admit everyone; the pair rule below adds the other direction, the minors and the opt-ins.
 * `otherIs` is the other person's list, or [] when they stated none.
 */
export function romanceAdmits(r: RomanceRange | undefined, otherAge: number, otherIs: string[]): boolean {
  //@ verify
  //@ ensures r === undefined ==> \result
  //@ ensures r !== undefined && \result ==> r.ageMin <= otherAge && otherAge <= r.ageMax
  //@ ensures r !== undefined && \result && r.seeks.length > 0 ==> sharesOne(r.seeks, otherIs)
  if (r === undefined) return true;
  if (otherAge < r.ageMin || otherAge > r.ageMax) return false;
  if (r.seeks.length > 0 && !sharesOne(r.seeks, otherIs)) return false;
  return true;
}

/** One side of a romance pair, as rules.ts reads it from the MemberIndex. */
export interface RomanceSide {
  optIn: boolean;
  /** isMinorAge(age): under 18, unknown or invalid (core policy). */
  minor: boolean;
  age: number;
  prefs: RomanceRange | undefined;
  /** The side's own list (RomanceProfile.is), or [] when none is stated. */
  is: string[];
}

/** True when the side stated what it seeks. */
export function statedSeeks(s: RomanceSide): boolean {
  //@ verify
  return s.prefs === undefined ? false : s.prefs.seeks.length > 0;
}

/**
 * The romance pair rule. Outside the romance lane it says nothing. In the lane, both sides must be
 * adults who opted in, with stated preferences when the config asks for them, and each side must
 * admit the other. The answer does not depend on the order of the pair.
 */
export function romancePairReason(lane: string, requireStated: boolean, a: RomanceSide, b: RomanceSide): string | null {
  //@ verify
  //@ ensures \result === romancePairReason(lane, requireStated, b, a)
  //@ ensures lane !== "romance" ==> \result === null
  //@ ensures lane === "romance" && (a.minor || b.minor) ==> \result === "romance_incompatible"
  //@ ensures lane === "romance" && \result === null ==> a.optIn && b.optIn && !a.minor && !b.minor
  //@ ensures lane === "romance" && \result === null ==> romanceAdmits(a.prefs, b.age, b.is) && romanceAdmits(b.prefs, a.age, a.is)
  //@ ensures lane === "romance" && \result === null && requireStated ==> statedSeeks(a) && statedSeeks(b)
  if (lane !== "romance") return null;
  if (a.minor || b.minor) return "romance_incompatible";
  if (!a.optIn || !b.optIn) return "romance_incompatible";
  if (requireStated && (!statedSeeks(a) || !statedSeeks(b))) return "romance_incompatible";
  if (!romanceAdmits(a.prefs, b.age, b.is) || !romanceAdmits(b.prefs, a.age, a.is)) return "romance_incompatible";
  return null;
}
