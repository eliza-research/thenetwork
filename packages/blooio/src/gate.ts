// The send decisions of the outbound queue as pure functions, proved with LemmaScript (lemmascript.json,
// bun run sim --only formal). dispatch() reads the facts; these functions decide. This file imports
// nothing, and its proof says nothing about the facts: a wrong fact gives a wrong decision. The SQL
// fences in OutboundQueue.send and the caps' counts stay with the integration tests.

export type MessageKind =
  | "reply"          // the answer to the member's own message; quiet-hours exempt
  | "compliance"     // STOP/START/HELP confirmations and declines; exempt from the opt-out and quiet hours
  | "proactive"      // Network-initiated; quiet hours, consent, the person cap and the line caps apply
  | "safety"         // a safety notice (a hold); consent and the leak guard apply; quiet hours, the streak and the line caps do not
  | "transactional"; // everything else the Network starts (reminders, scheduling); quiet hours apply

/** Everything except a direct reply and a compliance text is agent-initiated (any new kind is too). */
export function isAgentInitiated(kind: MessageKind): boolean {
  //@ verify
  return kind !== "reply" && kind !== "compliance";
}

/** What dispatch() read about one row, before the person cap. */
export interface GateFacts {
  kind: MessageKind;
  tooOld: boolean;
  stale: boolean;
  live: boolean;
  optedOut: boolean;
  recipientOk: boolean;
  hasRecentInbound: boolean;
  zoneValid: boolean;
  quiet: boolean;
  hasConv: boolean;
  unanswered: number;
  maxUnanswered: number;
  reengagementUsed: boolean;
  quietForEnough: boolean;
  /** Blooio's safety state of the line; "" when the line has none. */
  safety: string;
  recipientCount: number;
  perRecipient: number;
  lineCount: number;
  perLine: number;
  newChats: number;
  newChatsCap: number;
}

export type Gate =
  | { tag: "expired" }
  | { tag: "refused_not_approved" }
  | { tag: "refused_opted_out" }
  | { tag: "suppressed_ineligible" }
  | { tag: "suppressed_no_inbound" }
  | { tag: "parked_invalid_timezone" }
  | { tag: "deferred_quiet" }
  | { tag: "held_awaiting_reply" }
  | { tag: "line_safety" }
  | { tag: "retry_recipient_cap" }
  | { tag: "retry_line_cap" }
  | { tag: "retry_new_chat_cap" }
  | { tag: "refused_person_cap" }
  | { tag: "parked_leak_review" }
  | { tag: "pass"; reengagement: boolean }
  | { tag: "send"; reengagement: boolean };

/** Steps 0 to 8 of dispatch, in order. "pass" means the row may ask for a person-cap slot. */
export function preCapGate(f: GateFacts): Gate {
  //@ verify
  //@ ensures \result.tag !== "send" && \result.tag !== "refused_person_cap" && \result.tag !== "parked_leak_review"
  const agent = isAgentInitiated(f.kind);
  const compliance = f.kind === "compliance";
  // A safety notice (a hold) goes at once: it skips quiet hours, the unanswered streak and the line caps.
  const timed = agent && f.kind !== "safety";
  if (f.tooOld || f.stale) return { tag: "expired" };
  if (!f.live) return { tag: "refused_not_approved" };
  if (!compliance && f.optedOut) return { tag: "refused_opted_out" };
  if (!compliance && !f.recipientOk) return { tag: "suppressed_ineligible" };
  if (f.kind === "reply" && !f.hasRecentInbound) return { tag: "suppressed_no_inbound" };
  if (timed && !f.zoneValid) return { tag: "parked_invalid_timezone" };
  if (timed && f.quiet) return { tag: "deferred_quiet" };
  const overStreak = !compliance && f.kind !== "safety" && f.hasConv && f.unanswered >= f.maxUnanswered;
  if (overStreak && !(agent && !f.reengagementUsed && f.quietForEnough)) return { tag: "held_awaiting_reply" };
  const isNew = !f.hasConv;
  // Blooio's safety state of the line holds new and agent texts; compliance texts (STOP, HELP) still go.
  if (!compliance && (f.safety === "review" || (f.safety === "reply_only" && (agent || isNew)) || (f.safety === "pause_new" && isNew))) return { tag: "line_safety" };
  if (!compliance && f.recipientCount >= f.perRecipient) return { tag: "retry_recipient_cap" };
  if (!compliance && timed && f.lineCount >= f.perLine) return { tag: "retry_line_cap" };
  if (!compliance && timed && isNew && f.newChats >= f.newChatsCap) return { tag: "retry_new_chat_cap" };
  return { tag: "pass", reengagement: overStreak };
}

/** Step 9 asks for a slot only here: a row an earlier step stopped never takes one, and only proactive rows do. */
export function takesSlot(f: GateFacts): boolean {
  //@ verify
  //@ ensures \result === (preCapGate(f).tag === "pass" && f.kind === "proactive")
  //@ ensures \result ==> f.live && !f.tooOld && !f.stale && !f.optedOut && f.recipientOk && !f.quiet && f.zoneValid
  return preCapGate(f).tag === "pass" && f.kind === "proactive";
}

/**
 * The whole chain, steps 0 to 10. It runs preCapGate again on the same facts, so "send" below holds
 * whatever dispatch did in between. `capTaken` is true when no cap hook is set (no cap on this queue).
 */
export function finalGate(f: GateFacts, capTaken: boolean, leakClean: boolean, leakReleased: boolean): Gate {
  //@ verify
  //@ ensures preCapGate(f).tag !== "pass" ==> \result === preCapGate(f)
  //@ ensures \result.tag !== "pass"
  //@ ensures \result.tag === "send" ==> !f.tooOld && !f.stale && f.live
  //@ ensures \result.tag === "send" ==> leakClean || leakReleased
  //@ ensures \result.tag === "send" && f.kind !== "compliance" ==> !f.optedOut && f.recipientOk
  //@ ensures \result.tag === "send" && f.kind === "reply" ==> f.hasRecentInbound
  //@ ensures \result.tag === "send" && isAgentInitiated(f.kind) && f.kind !== "safety" ==> !f.quiet && f.zoneValid
  //@ ensures \result.tag === "send" && f.kind === "proactive" ==> capTaken && takesSlot(f)
  //@ ensures \result.tag === "send" && f.kind !== "compliance" ==> f.recipientCount < f.perRecipient
  //@ ensures \result.tag === "send" && isAgentInitiated(f.kind) && f.kind !== "safety" ==> f.lineCount < f.perLine
  //@ ensures \result.tag === "send" && f.kind !== "compliance" && f.kind !== "safety" && f.hasConv && f.unanswered >= f.maxUnanswered ==> isAgentInitiated(f.kind) && !f.reengagementUsed && f.quietForEnough && \result.reengagement
  //@ ensures \result.tag === "send" && f.kind !== "compliance" ==> f.safety !== "review"
  //@ ensures \result.tag === "send" && f.kind !== "compliance" && f.safety === "reply_only" ==> !isAgentInitiated(f.kind) && f.hasConv
  //@ ensures \result.tag === "send" && f.kind !== "compliance" && f.safety === "pause_new" ==> f.hasConv
  //@ ensures \result.tag === "send" && !f.hasConv && isAgentInitiated(f.kind) && f.kind !== "safety" ==> f.newChats < f.newChatsCap
  //@ ensures \result.tag === "send" && f.kind === "safety" ==> !f.optedOut && f.recipientOk && f.recipientCount < f.perRecipient && f.safety !== "review" && (f.hasConv || (f.safety !== "reply_only" && f.safety !== "pause_new"))
  const pre = preCapGate(f);
  if (pre.tag !== "pass") return pre;
  if (f.kind === "proactive" && !capTaken) return { tag: "refused_person_cap" };
  if (!leakClean && !leakReleased) return { tag: "parked_leak_review" };
  return { tag: "send", reengagement: pre.reengagement };
}

/** Every status an outbound row, or a send another transport reports, can hold. */
export type OutboundStatus =
  | "pending" | "retry_scheduled" | "deferred_quiet_hours" | "held_awaiting_reply" | "sending" | "unknown_acceptance"
  | "accepted" | "queued" | "sent" | "delivered" | "read" | "dry_run"
  | "collected" | "send_unknown" | "failed_unknown"
  | "failed" | "failed_no_address" | "expired" | "blocked"
  | "refused_not_approved" | "refused_opted_out" | "refused_person_cap" | "refused_photo_transport" | "refused_gateway"
  | "suppressed_ineligible" | "parked_invalid_timezone" | "parked_leak_review" | "parked_error"
  | "dropped_forgotten" | "dropped_leak_review";

/** The message may have reached the provider, or the provider's answer never came. */
export function mayHaveGone(s: OutboundStatus): boolean {
  //@ verify
  return s === "sending" || s === "unknown_acceptance" || s === "accepted" || s === "queued" || s === "sent" || s === "delivered" || s === "read"
    || s === "dry_run" || s === "collected" || s === "send_unknown" || s === "failed_unknown";
}

/**
 * Statuses that did not go out: their person-cap slot goes back. A status that is not named here keeps
 * its slot, and so does a row whose acceptance stayed unknown: the text may have gone, and one slot too
 * many is safe where one text too many is not.
 */
export function isNotSent(s: OutboundStatus): boolean {
  //@ verify
  //@ ensures \result ==> !mayHaveGone(s)
  //@ ensures s === "failed_unknown" || s === "unknown_acceptance" ==> !\result
  return s === "failed" || s === "failed_no_address" || s === "expired" || s === "blocked"
    || s === "refused_not_approved" || s === "refused_opted_out" || s === "refused_person_cap" || s === "refused_photo_transport" || s === "refused_gateway"
    || s === "suppressed_ineligible" || s === "parked_invalid_timezone" || s === "parked_leak_review" || s === "parked_error"
    || s === "dropped_forgotten" || s === "dropped_leak_review";
}

/** How far a row got at the provider. 0: a row that did not go out, or one that ended. */
export function rowRank(s: OutboundStatus): number {
  //@ verify
  //@ ensures 0 <= \result && \result <= 4
  if (s === "accepted" || s === "queued") return 1;
  if (s === "sent") return 2;
  if (s === "delivered") return 3;
  if (s === "read") return 4;
  return 0;
}

export type ReceiptStatus = "queued" | "sent" | "delivered" | "read" | "failed";

export function receiptRank(u: ReceiptStatus): number {
  //@ verify
  if (u === "queued") return 1;
  if (u === "sent") return 2;
  if (u === "delivered") return 3;
  if (u === "read") return 4;
  return 0;
}

export type Move = { tag: "ignore" } | { tag: "fail" } | { tag: "advance" };

/** A delivery receipt on a row. Statuses never go back; a failure only hits a row still in flight. */
export function nextStatus(cur: OutboundStatus, u: ReceiptStatus): Move {
  //@ verify
  //@ ensures \result.tag === "advance" ==> rowRank(cur) >= 1 && receiptRank(u) > rowRank(cur)
  //@ ensures \result.tag === "fail" ==> u === "failed" && (cur === "accepted" || cur === "sent")
  //@ ensures cur === "read" || cur === "failed" || cur === "expired" || cur === "pending" || cur === "sending" ==> \result.tag === "ignore"
  //@ ensures cur === "delivered" && \result.tag !== "ignore" ==> u === "read"
  if (u === "failed") return cur === "accepted" || cur === "sent" ? { tag: "fail" } : { tag: "ignore" };
  const c = rowRank(cur);
  if (c === 0 || receiptRank(u) <= c) return { tag: "ignore" };
  return { tag: "advance" };
}
