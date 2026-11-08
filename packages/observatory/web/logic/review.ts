//@ backend dafny
// The staff decisions of the review queue, the safety reports and the matching switch. React, the
// DOM and fetch stay in review.tsx and admin.tsx; those files call this module and do not decide again.
// Proofs: proofs/packages/observatory/web/logic/review.dfy. Values such as `number` are ideal in the
// proof: NaN and fractions are outside it, so each check that takes a time is written to fail closed.

/** "idle": no mode is open. The value is not "none": the proof language cannot build that member. */
export type Mode = "idle" | "reject" | "edit" | "reroll";
/**
 * What the keyboard and the buttons hold for one item.
 * boundId: the item that owns the mode and the drafts. chosen: the reviewer picked that item (j, k,
 * a click, a focus link) or the queue moved on after their decision. draftsId: boundId while edit
 * drafts exist, else "". A selection that moved by itself gives chosen = false.
 */
export interface Ctl { mode: Mode; boundId: string; draftsId: string; chosen: boolean }
export type Key = "a" | "r" | "e" | "s" | "digit" | "esc";
/** One key press or button press. digit is 1-based. reasons and swaps are the list lengths on the card. */
export interface Press { key: Key; digit: number; repeat: boolean; blocked: boolean; canAct: boolean; reasons: number; swaps: number }
export type Cmd =
  | { tag: "nothing" }
  | { tag: "approve"; id: string; withEdits: boolean }
  | { tag: "reject"; id: string; digit: number }
  | { tag: "reroll"; id: string; digit: number };
export interface Step { ctl: Ctl; cmd: Cmd }

/** The controller rule: drafts belong to the bound item, the editor needs drafts, an unchosen item has neither a mode nor drafts. */
function ctlOk(c: Ctl): boolean {
  //@ verify
  return (c.draftsId === "" || c.draftsId === c.boundId)
    && (c.mode !== "edit" || c.draftsId === c.boundId)
    && (c.chosen || (c.mode === "idle" && c.draftsId === ""));
}

/** The selection is selId. The mode and the drafts of another item never follow it. */
export function rebind(ctl: Ctl, selId: string): Ctl {
  //@ verify
  //@ requires selId !== ""
  //@ ensures \result.boundId === selId
  //@ ensures ctl.boundId === selId ==> \result === ctl
  //@ ensures ctl.boundId !== selId ==> \result.mode === "idle" && \result.draftsId === "" && !\result.chosen
  //@ ensures ctlOk(ctl) ==> ctlOk(\result)
  if (ctl.boundId === selId) return ctl;
  return { mode: "idle", boundId: selId, draftsId: "", chosen: false };
}

/** The reviewer picked id. What they had open on it stays; what was open on another item does not. */
export function choose(ctl: Ctl, id: string): Ctl {
  //@ verify
  //@ requires id !== ""
  //@ ensures \result.boundId === id && \result.chosen
  //@ ensures \result.mode !== "idle" ==> ctl.boundId === id
  //@ ensures \result.draftsId === id ==> ctl.boundId === id && ctl.draftsId === id
  //@ ensures ctlOk(ctl) ==> ctlOk(\result)
  const c = rebind(ctl, id);
  return { mode: c.mode, boundId: c.boundId, draftsId: c.draftsId, chosen: true };
}

/** Leave the open mode. Leaving the editor discards its drafts; leaving another mode keeps them. */
function leaveMode(c: Ctl): Ctl {
  //@ verify
  //@ ensures \result.mode === "idle" && \result.boundId === c.boundId && \result.chosen === c.chosen
  //@ ensures c.mode === "edit" ==> \result.draftsId === ""
  //@ ensures c.mode !== "edit" ==> \result.draftsId === c.draftsId
  //@ ensures ctlOk(c) ==> ctlOk(\result)
  return { mode: "idle", boundId: c.boundId, draftsId: c.mode === "edit" ? "" : c.draftsId, chosen: c.chosen };
}

/**
 * One press on the selected item. A decision goes only to the item the reviewer chose, on a fresh
 * press, and it carries that item's own drafts. Any other press decides nothing.
 */
export function keyStep(ctl0: Ctl, selId: string, p: Press): Step {
  //@ verify
  //@ requires selId !== ""
  //@ requires ctlOk(ctl0)
  //@ ensures \result.cmd.tag === "approve" ==> \result.cmd.id === selId && ctl0.boundId === selId && ctl0.chosen && p.key === "a" && p.canAct && !p.repeat && !p.blocked
  //@ ensures \result.cmd.tag === "approve" ==> \result.cmd.withEdits === (ctl0.draftsId === selId)
  //@ ensures \result.cmd.tag === "reject" ==> \result.cmd.id === selId && ctl0.boundId === selId && ctl0.chosen && ctl0.mode === "reject" && p.canAct && !p.repeat && 1 <= \result.cmd.digit && \result.cmd.digit <= p.reasons
  //@ ensures \result.cmd.tag === "reroll" ==> \result.cmd.id === selId && ctl0.boundId === selId && ctl0.chosen && ctl0.mode === "reroll" && p.canAct && !p.repeat && 1 <= \result.cmd.digit && \result.cmd.digit <= p.swaps
  //@ ensures p.repeat ==> \result.cmd.tag === "nothing"
  //@ ensures ctl0.boundId === selId && ctl0.chosen && p.key === "a" && p.canAct && !p.repeat && !p.blocked ==> \result.cmd.tag === "approve"
  //@ ensures p.key !== "a" && p.key !== "digit" ==> \result.cmd.tag === "nothing"
  //@ ensures \result.ctl.boundId === selId
  //@ ensures \result.ctl.mode !== "idle" ==> ctl0.boundId === selId && ctl0.chosen
  //@ ensures \result.ctl.draftsId === selId && ctl0.draftsId !== selId ==> p.key === "e" && ctl0.boundId === selId && ctl0.chosen
  //@ ensures ctlOk(\result.ctl)
  //@ ensures \result.cmd.tag === "reject" ==> \result.cmd.digit === p.digit
  //@ ensures \result.cmd.tag === "reroll" ==> \result.cmd.digit === p.digit
  //@ ensures ctl0.boundId === selId && ctl0.chosen && ctl0.mode === "reject" && p.key === "digit" && p.canAct && !p.repeat && 1 <= p.digit && p.digit <= p.reasons ==> \result.cmd.tag === "reject"
  //@ ensures ctl0.boundId === selId && ctl0.chosen && ctl0.mode === "reroll" && p.key === "digit" && p.canAct && !p.repeat && 1 <= p.digit && p.digit <= p.swaps ==> \result.cmd.tag === "reroll"
  //@ ensures p.key === "esc" ==> \result.ctl.mode === "idle"
  //@ ensures p.key !== "esc" && p.canAct && !p.repeat ==> \result.ctl.chosen
  //@ ensures ctl0.boundId === selId && ctl0.chosen && p.canAct && !p.repeat && p.key === "r" ==> \result.ctl.mode === "reject"
  //@ ensures ctl0.boundId === selId && ctl0.chosen && p.canAct && !p.repeat && p.key === "s" && p.swaps >= 1 ==> \result.ctl.mode === "reroll"
  //@ ensures ctl0.boundId === selId && ctl0.chosen && p.canAct && !p.repeat && p.key === "e" ==> \result.ctl.mode === "edit" && \result.ctl.draftsId === selId
  //@ ensures ctl0.boundId === selId && p.key !== "esc" && p.key !== "e" ==> \result.ctl.draftsId === ctl0.draftsId
  const ctl = rebind(ctl0, selId);
  if (p.key === "esc") return { ctl: leaveMode(ctl), cmd: { tag: "nothing" } };
  if (p.repeat || !p.canAct) return { ctl, cmd: { tag: "nothing" } };
  // The first press on a card that nobody chose only marks it as chosen.
  if (ctl0.boundId !== selId || !ctl0.chosen) return { ctl: choose(ctl0, selId), cmd: { tag: "nothing" } };
  if (p.key === "a") {
    if (p.blocked) return { ctl, cmd: { tag: "nothing" } };
    return { ctl, cmd: { tag: "approve", id: selId, withEdits: ctl.draftsId === selId } };
  }
  if (p.key === "digit") {
    if (ctl.mode === "reject" && p.digit >= 1 && p.digit <= p.reasons) return { ctl, cmd: { tag: "reject", id: selId, digit: p.digit } };
    if (ctl.mode === "reroll" && p.digit >= 1 && p.digit <= p.swaps) return { ctl, cmd: { tag: "reroll", id: selId, digit: p.digit } };
    return { ctl, cmd: { tag: "nothing" } };
  }
  if (p.key === "r") return { ctl: { mode: "reject", boundId: selId, draftsId: ctl.draftsId, chosen: true }, cmd: { tag: "nothing" } };
  if (p.key === "s") {
    if (p.swaps < 1) return { ctl, cmd: { tag: "nothing" } };
    return { ctl: { mode: "reroll", boundId: selId, draftsId: ctl.draftsId, chosen: true }, cmd: { tag: "nothing" } };
  }
  return { ctl: { mode: "edit", boundId: selId, draftsId: selId, chosen: true }, cmd: { tag: "nothing" } };
}

/** A button press on a mode: a second press on the open mode closes it. Closing the editor discards its drafts. */
export function toggleMode(ctl: Ctl, id: string, m: Mode): Ctl {
  //@ verify
  //@ requires id !== ""
  //@ requires m !== "idle"
  //@ requires ctlOk(ctl)
  //@ ensures \result.boundId === id && \result.chosen
  //@ ensures ctl.boundId === id && ctl.mode === m ==> \result.mode === "idle"
  //@ ensures !(ctl.boundId === id && ctl.mode === m) ==> \result.mode === m
  //@ ensures \result.draftsId === id && m !== "edit" ==> ctl.boundId === id && ctl.draftsId === id
  //@ ensures ctlOk(\result)
  const c = choose(ctl, id);
  if (c.mode === m) return leaveMode(c);
  return { mode: m, boundId: id, draftsId: m === "edit" ? id : c.draftsId, chosen: true };
}

/** The answer for item id came back as done. A late answer leaves alone what the reviewer has open on another item. */
export function settle(ctl: Ctl, id: string): Ctl {
  //@ verify
  //@ ensures ctl.boundId !== id ==> \result === ctl
  //@ ensures ctl.boundId === id ==> \result.mode === "idle" && \result.draftsId === "" && \result.boundId === id && \result.chosen === ctl.chosen
  //@ ensures ctlOk(ctl) ==> ctlOk(\result)
  if (ctl.boundId !== id) return ctl;
  return { mode: "idle", boundId: id, draftsId: "", chosen: ctl.chosen };
}

/**
 * The answer for item id arrived in one queue instance. That instance can move the selection only
 * when it is still mounted, and only when the reviewer did not choose another card. A queue that is
 * unmounted holds an old controller: its move would put a card that the reviewer did not choose in
 * front of the new queue.
 */
export function moveOnAfter(mounted: boolean, ctl: Ctl, id: string): boolean {
  //@ verify
  //@ ensures !mounted ==> !\result
  //@ ensures ctl.chosen && ctl.boundId !== id ==> !\result
  //@ ensures \result <==> (mounted && (!ctl.chosen || ctl.boundId === id))
  return mounted && (!ctl.chosen || ctl.boundId === id);
}

export interface Person { minor: boolean; declined?: boolean }
export type Block = "read_only" | "minor" | "declined" | "matching_off" | "expired" | "idle";

/**
 * Why approval is refused, in the order the page reports it. "idle": it is allowed. A participant
 * that the page does not know blocks like a minor, as ConsentNetwork.reviewBlock does. A time that
 * is not a number fails `now < deadline`, so it blocks too.
 */
export function approveBlock(canAct: boolean, ids: string[], people: Map<string, Person>, matchingOff: boolean, now: number, deadline: number): Block {
  //@ verify
  //@ ensures \result === "idle" <==> (canAct && !matchingOff && now < deadline && forall(k: nat, k < ids.length ==> people.has(ids[k]) && !people.get(ids[k]).minor && people.get(ids[k]).declined !== true))
  if (!canAct) return "read_only";
  for (let i = 0; i < ids.length; i++) {
    //@ invariant 0 <= i && i <= ids.length
    //@ invariant forall(k: nat, k < i ==> people.has(ids[k]) && !people.get(ids[k]).minor)
    //@ decreases ids.length - i
    const p = people.get(ids[i]);
    if (p === undefined || p.minor) return "minor";
  }
  for (let i = 0; i < ids.length; i++) {
    //@ invariant 0 <= i && i <= ids.length
    //@ invariant forall(k: nat, k < ids.length ==> people.has(ids[k]) && !people.get(ids[k]).minor)
    //@ invariant forall(k: nat, k < i ==> people.get(ids[k]).declined !== true)
    //@ decreases ids.length - i
    const p = people.get(ids[i]);
    if (p !== undefined && p.declined === true) return "declined";
  }
  if (matchingOff) return "matching_off";
  if (now < deadline) return "idle";
  return "expired";
}

export type ReportStatus = "open" | "held" | "banned" | "dismissed";
export interface Offer { hold: boolean; ban: boolean; dismiss: boolean; clear: boolean }

// The backend transition table of a report. These three functions copy packages/network/src/network.ts:
// decideReports (a hold takes open; a ban takes open and held) and dismissReport (open only). Change
// them only with that file. reportOffer below must agree with this table.
function backendHold(s: ReportStatus): boolean {
  //@ verify
  return s === "open";
}
function backendBan(s: ReportStatus): boolean {
  //@ verify
  return s === "open" || s === "held";
}
function backendDismiss(s: ReportStatus): boolean {
  //@ verify
  return s === "open";
}

/** The actions the page offers on a report. minorKind: a "minor" report; its clear action stays until the report is final. */
export function reportOffer(status: ReportStatus, canBan: boolean, safety: boolean, minorKind: boolean, canAct: boolean): Offer {
  //@ verify
  //@ ensures canBan && safety ==> \result.ban === backendBan(status) && \result.hold === backendHold(status) && \result.dismiss === backendDismiss(status)
  //@ ensures !(canBan && safety) ==> !\result.ban && !\result.hold && !\result.dismiss
  //@ ensures \result.clear <==> (minorKind && canAct && safety && backendBan(status))
  const live = status === "open" || status === "held";
  const clear = minorKind && canAct && safety && live;
  if (!canBan || !safety || !live) return { hold: false, ban: false, dismiss: false, clear };
  const open = status === "open";
  return { hold: open, ban: true, dismiss: open, clear };
}

export interface Pending { active: boolean; target: boolean }
export interface Flip { pending: Pending; send: boolean; on: boolean }

/**
 * The two presses of the matching switch. The first press stores what it asked for. The second
 * sends exactly that, or nothing when another admin has already made that change.
 */
export function flip(p: Pending, current: boolean): Flip {
  //@ verify
  //@ ensures \result.send ==> p.active && \result.on === p.target && \result.on !== current
  //@ ensures p.active && p.target !== current ==> \result.send
  //@ ensures !p.active ==> !\result.send && \result.pending.active && \result.pending.target === !current
  //@ ensures p.active ==> !\result.pending.active
  if (!p.active) return { pending: { active: true, target: !current }, send: false, on: current };
  if (p.target === current) return { pending: { active: false, target: current }, send: false, on: current };
  return { pending: { active: false, target: current }, send: true, on: p.target };
}

export type Decision = "pending" | "approve" | "reject" | "expired";
export type Line = "waiting" | "closed_unsent" | "expired_unsent" | "stopped" | "approved" | "rejected";
export interface ReviewFacts { decision: Decision; invalidated: boolean; inReview: boolean }

/** The state one line shows. Only an item that still waits has a countdown: a re-roll with no alternate closes with no decision. */
export function reviewStatus(r: ReviewFacts): Line {
  //@ verify
  //@ ensures \result === "waiting" <==> (r.inReview && r.decision === "pending")
  //@ ensures \result === "approved" <==> (r.decision === "approve" && !r.invalidated)
  //@ ensures \result === "rejected" <==> (r.decision === "reject" && !r.invalidated)
  //@ ensures \result === "expired_unsent" <==> r.decision === "expired"
  //@ ensures r.decision === "pending" && !r.inReview ==> \result === "closed_unsent"
  if (r.decision === "pending") return r.inReview ? "waiting" : "closed_unsent";
  if (r.decision === "expired") return "expired_unsent";
  if (r.invalidated) return "stopped";
  if (r.decision === "approve") return "approved";
  return "rejected";
}
