// Plan-invite cap and item gate rules (attention.ts), proved with LemmaScript. Import-free. These cover
// the attention path only: the intro caps and the person cap of 3 a day are elsewhere. `minor` is
// core's isMinor, passed in as a boolean. The caller sets `kindAllowedForMinor` and `reviewState`, so
// this gate is not the proof of human review; the network's review queue is.

export type AttentionState = "open" | "normal" | "quiet" | "receiving" | "paused";
export type ItemReview = "not_needed" | "pending" | "approved" | "rejected";
export interface CapValue { limit: number; periodDays: number }
export interface StateCaps { open: CapValue; normal: CapValue; quiet: CapValue; receiving: CapValue; paused: CapValue }
export interface CapMember { state: AttentionState; minor: boolean; onlyWhenAsked: boolean; capOverride: number | undefined }
export interface GateItem { memberId: string; expiresAt: number; reviewState: ItemReview; involvesMember: boolean; others: string[] }

/** Interruption cap: the state cap, minors the stricter of the minors cap and the state's, 0 when paused or only-when-asked. */
export function capValue(m: CapMember, caps: StateCaps, minorCap: CapValue): CapValue {
  //@ verify
  //@ requires minorCap.limit >= 0 && minorCap.periodDays > 0 && caps[m.state].limit >= 0 && caps[m.state].periodDays > 0
  //@ ensures \result.limit >= 0
  //@ ensures (m.state === "paused" || m.onlyWhenAsked) ==> \result.limit === 0
  //@ ensures !m.minor ==> \result.limit <= caps[m.state].limit
  const st = caps[m.state];
  // Cross-multiplied rate test: limit / period of the minors cap below the state's.
  const base = m.minor && minorCap.limit * st.periodDays < st.limit * minorCap.periodDays ? minorCap : st;
  if (m.state === "paused" || m.onlyWhenAsked) return { limit: 0, periodDays: base.periodDays };
  // An explicit request can lower the cap, or restore it, but never exceed the state cap.
  const limit = m.capOverride === undefined ? base.limit : Math.min(base.limit, Math.max(0, m.capOverride));
  return { limit, periodDays: base.periodDays };
}

/** The stricter of a state's cap and the plan allowance, by rate. The result is never above either rate. */
export function stricterCap(st: CapValue, allowance: CapValue): CapValue {
  //@ verify
  //@ requires st.periodDays > 0 && allowance.periodDays > 0
  //@ ensures \result.limit * st.periodDays <= st.limit * \result.periodDays
  //@ ensures \result.limit * allowance.periodDays <= allowance.limit * \result.periodDays
  return st.limit * allowance.periodDays < allowance.limit * st.periodDays ? st : allowance;
}

/** At the cap, an initial invite is skipped. */
export function capBlocks(used: number, limit: number, isInvite: boolean): boolean {
  //@ verify
  //@ ensures isInvite && used >= limit ==> \result
  //@ ensures \result ==> isInvite && used >= limit
  return used >= limit && isInvite;
}

/** The fixed start of the item gate. Null means: for this member, not expired, approved if it involves a member, safe for a minor. */
export function itemHardGate(memberId: string, minor: boolean, kindAllowedForMinor: boolean, it: GateItem, now: number): string | null {
  //@ verify
  //@ ensures \result === null ==> it.memberId === memberId && it.expiresAt > now && it.reviewState !== "rejected"
  //@ ensures \result === null && it.involvesMember ==> it.reviewState === "approved"
  //@ ensures \result === null && minor ==> it.others.length === 0 && !it.involvesMember && kindAllowedForMinor
  if (it.memberId !== memberId) return "wrong_member";
  if (it.expiresAt <= now) return "expired";
  if (it.reviewState === "rejected") return "review_rejected";
  if (it.involvesMember && it.reviewState !== "approved") return "awaiting_review";
  if (minor) {
    if (!(kindAllowedForMinor && it.others.length === 0 && !it.involvesMember)) return "minor_restricted";
  }
  return null;
}
