// Pure notification decisions, proved with LemmaScript. This file imports nothing. The stored counts
// come from the store; the 3-a-day person cap is SQL in the outbound queue and is not part of this proof.

export type Urgency = "urgent" | "normal" | "requested";
export interface CapItem { urgency: Urgency; }

/** A message counts against the weekly cap if any item in it is more than a reminder the member asked for. */
export function countsTowardCap(items: CapItem[]): boolean {
  //@ verify
  //@ ensures \result === exists(k: number, 0 <= k && k < items.length && items[k].urgency !== "requested")
  return items.some(i => i.urgency !== "requested");
}

/** At the weekly cap only requested items remain (PRD 32.9). Under the cap nothing changes. */
export function capFilter<T extends CapItem>(items: T[], recent: number, cap: number): T[] {
  //@ verify
  //@ ensures forall(k: number, 0 <= k && k < \result.length ==> \result[k].urgency === "requested" || recent < cap)
  //@ ensures \result.length <= items.length
  //@ ensures recent < cap ==> \result === items
  if (recent >= cap && items.some(i => i.urgency !== "requested")) return items.filter(i => i.urgency === "requested");
  return items;
}

export type ExplicitRoute = "explicit" | "explicit_thread" | "explicit_link_unused" | "explicit_not_connected";

/** The member's explicit choice. `active` and `ignoredStreak` are 0 and false for a surface with no signal. */
export function explicitRoute(assistant: boolean, active: boolean, ignoredStreak: number, maxIgnored: number): ExplicitRoute {
  //@ verify
  //@ ensures \result === "explicit" ==> assistant && active && ignoredStreak < maxIgnored
  //@ ensures !assistant ==> \result === "explicit_thread"
  //@ ensures assistant && !active ==> \result === "explicit_not_connected"
  if (!assistant) return "explicit_thread";
  if (!active) return "explicit_not_connected";
  if (ignoredStreak >= maxIgnored) return "explicit_link_unused";
  return "explicit";
}
