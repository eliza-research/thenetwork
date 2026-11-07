// Decisions of the plan path (plans.ts, attention.ts), proved with LemmaScript. Import-free. plans.ts
// keeps the planner search and the run records and calls these for the safety-relevant steps.

export interface PlanPick { index: number; invited: string[]; alternates: string[] }

/** True if the member is in this plan in any role. */
export function inPlan(p: PlanPick, id: string): boolean {
  //@ verify
  return p.invited.includes(id) || p.alternates.includes(id);
}

/** True if the member is invited to one of the plans. */
export function invitedIn(out: PlanPick[], id: string): boolean {
  //@ verify
  return out.some(p => p.invited.includes(id));
}

/** True if the member is in one of the plans in any role. */
export function takenIn(out: PlanPick[], id: string): boolean {
  //@ verify
  return out.some(p => inPlan(p, id));
}

/**
 * Best plans first (`cands` is in rank order): a plan needs all its invited members free. Then each
 * plan keeps the alternates who are not invited anywhere and are not an alternate of a better plan.
 * In the result each member is in at most one plan, in any role, and there are at most `maxPlans`.
 */
export function pickPlans(cands: PlanPick[], maxPlans: number): PlanPick[] {
  //@ verify
  //@ type maxPlans nat
  //@ ensures \result.length <= maxPlans
  //@ ensures forall(i: nat, forall(j: nat, forall(m: string, i < j && j < \result.length ==> !(inPlan(\result[i], m) && inPlan(\result[j], m)))))
  let chosen: PlanPick[] = [];
  let k = 0;
  while (k < cands.length) {
    //@ type k nat
    //@ invariant k <= cands.length
    //@ invariant chosen.length <= maxPlans
    //@ invariant forall(i: nat, forall(j: nat, forall(m: string, i < j && j < chosen.length ==> !(chosen[i].invited.includes(m) && chosen[j].invited.includes(m)))))
    //@ decreases cands.length - k
    if (chosen.length >= maxPlans) break;
    const c = cands[k]!;
    k = k + 1;
    if (c.invited.some(id => invitedIn(chosen, id))) continue;
    chosen = [...chosen, c];
  }
  let out: PlanPick[] = [];
  let n = 0;
  while (n < chosen.length) {
    //@ type n nat
    //@ invariant n <= chosen.length
    //@ invariant out.length === n
    //@ invariant chosen.length <= maxPlans
    //@ invariant forall(i: nat, forall(j: nat, forall(m: string, i < j && j < chosen.length ==> !(chosen[i].invited.includes(m) && chosen[j].invited.includes(m)))))
    //@ invariant forall(i: nat, i < n ==> out[i].invited === chosen[i].invited)
    //@ invariant forall(i: nat, forall(j: nat, forall(m: string, i < j && j < out.length ==> !(inPlan(out[i], m) && inPlan(out[j], m)))))
    //@ invariant forall(i: nat, forall(m: string, i < n && out[i].alternates.includes(m) ==> !invitedIn(chosen, m)))
    //@ decreases chosen.length - n
    const c = chosen[n]!;
    let alts: string[] = [];
    let a = 0;
    while (a < c.alternates.length) {
      //@ type a nat
      //@ invariant a <= c.alternates.length
      //@ invariant forall(m: string, alts.includes(m) ==> !invitedIn(chosen, m) && !takenIn(out, m))
      //@ decreases c.alternates.length - a
      const id = c.alternates[a]!;
      a = a + 1;
      if (!invitedIn(chosen, id) && !takenIn(out, id)) alts = [...alts, id];
    }
    out = [...out, { index: c.index, invited: c.invited, alternates: alts }];
    n = n + 1;
  }
  return out;
}

export type PlanStage = "probing" | "booked" | "closed";
export interface PlanFacts { stage: PlanStage; isPending: boolean; yes: boolean; yesAfter: number; quorum: number; partner: boolean; isFirst: boolean; beforeDeadline: boolean; lateJoinOpen: boolean }
export type PlanStep = "ignore" | "join" | "late" | "book" | "next_partner" | "no_change" | "close" | "next_alternate";

/**
 * What one probe answer does (recordPlanAnswer). A closed run or a member who is not pending changes
 * nothing. Only a yes at quorum books. A booked plan is never closed by a no.
 */
export function planStep(f: PlanFacts): PlanStep {
  //@ verify
  //@ ensures \result === "book" ==> f.stage === "probing" && f.isPending && f.yes && f.yesAfter >= f.quorum
  //@ ensures \result === "join" ==> f.stage === "booked" && f.isPending && f.yes && f.lateJoinOpen
  //@ ensures (f.stage === "closed" || !f.isPending) ==> \result === "ignore"
  //@ ensures f.stage === "booked" ==> \result !== "close" && \result !== "book"
  //@ ensures \result === "close" ==> !f.yes && f.partner && f.isFirst
  //@ ensures \result === "next_partner" ==> f.yes && f.partner && f.beforeDeadline && f.yesAfter < f.quorum
  //@ ensures \result === "next_alternate" ==> !f.yes && f.beforeDeadline
  if (f.stage === "closed" || !f.isPending) return "ignore";
  if (f.yes) {
    if (f.stage === "booked") return f.lateJoinOpen ? "join" : "late";
    if (f.yesAfter >= f.quorum) return "book";
    if (f.partner && f.beforeDeadline) return "next_partner";
    return "no_change";
  }
  if (f.stage === "booked") return "no_change";
  if (f.partner && f.isFirst) return "close";
  if (f.beforeDeadline) return "next_alternate";
  return "no_change";
}

/** After a no with nobody left to ask: the run closes only when nobody is pending and quorum is out of reach. */
export function planSettles(pendingCount: number, yesCount: number, quorum: number): boolean {
  //@ verify
  //@ ensures \result ==> pendingCount === 0 && yesCount < quorum
  return pendingCount === 0 && yesCount < quorum;
}

export type SmallerKind = "smaller_group" | "partner_plan" | "other";

/** Fallback shape: a pair of yes-sayers is never booked directly, it becomes a fresh partner plan. */
export function smallerKind(yesCount: number, smallerOn: boolean, minGroup: number, leadOk: boolean): SmallerKind {
  //@ verify
  //@ ensures \result === "smaller_group" ==> yesCount >= 3
  //@ ensures yesCount === 2 ==> \result !== "smaller_group"
  //@ ensures \result === "partner_plan" ==> yesCount === 2
  if (smallerOn && yesCount >= 2 && minGroup <= 2 && leadOk) {
    if (yesCount === 2) return "partner_plan";
    return "smaller_group";
  }
  return "other";
}

/** Group quorum: at least three and never more than the group. */
export function groupQuorum(n: number): number {
  //@ verify
  //@ requires n >= 3
  //@ ensures \result >= 3 && \result <= n
  return Math.max(3, Math.ceil(n * 0.66));
}
