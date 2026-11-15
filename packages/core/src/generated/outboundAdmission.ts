// GENERATED from spec/outboundAdmission.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Recheck a queued message at send time / A current row needs live approval and the recipient's eligibility (spec/outboundAdmission.md:9) */
export type Admission = "Proceed" | "Expired" | "ApprovalMissing" | "OptedOut" | "RecipientIneligible" | "ReplyTooOld" | "InvalidZone" | "QuietHours" | "AwaitingReply" | "LinePaused" | "RecipientCap" | "LineCap" | "NewConversationCap" | "PersonCap" | "LeakReview" | "Admit";
/** Story: Recheck a queued message at send time / Replies, quiet hours and unanswered messages limit when a send can go out (spec/outboundAdmission.md:29) */
export interface ConversationAdmission { decision: Admission; reengage: boolean }


/** Story: Recheck a queued message at send time / A current row needs live approval and the recipient's eligibility (spec/outboundAdmission.md:9) */
//@ pure
export function livePolicy(live: boolean): Admission {
  return live ? "Proceed" : "ApprovalMissing";
}

/** Story: Recheck a queued message at send time / A current row needs live approval and the recipient's eligibility (spec/outboundAdmission.md:9) */
//@ pure
export function consentPolicy(compliance: boolean, optedOut: boolean): Admission {
  return !compliance && optedOut ? "OptedOut" : "Proceed";
}

/** Story: Recheck a queued message at send time / A current row needs live approval and the recipient's eligibility (spec/outboundAdmission.md:9) */
//@ pure
export function recipientPolicy(compliance: boolean, eligible: boolean): Admission {
  return !compliance && !eligible ? "RecipientIneligible" : "Proceed";
}

/** Story: Recheck a queued message at send time / A current row needs live approval and the recipient's eligibility (spec/outboundAdmission.md:9) */
//@ pure
export function duePolicy(stale: boolean): Admission {
  return stale ? "Expired" : "Proceed";
}

/** Story: Recheck a queued message at send time / A current row needs live approval and the recipient's eligibility (spec/outboundAdmission.md:9) */
//@ pure
export function lawOptedOutOnlyGetsCompliance(compliance: boolean): boolean {
  //@ ensures \result === true
  return !(consentPolicy(compliance, true) === "Proceed") || compliance;
}

/** Story: Recheck a queued message at send time / Replies, quiet hours and unanswered messages limit when a send can go out (spec/outboundAdmission.md:29) */
//@ pure
export function replyPolicy(reply: boolean, recentInbound: boolean): Admission {
  return reply && !recentInbound ? "ReplyTooOld" : "Proceed";
}

/** Story: Recheck a queued message at send time / Replies, quiet hours and unanswered messages limit when a send can go out (spec/outboundAdmission.md:29) */
//@ pure
export function quietPolicy(agent: boolean, validZone: boolean, quiet: boolean): Admission {
  return !agent ? "Proceed" : (!validZone ? "InvalidZone" : (quiet ? "QuietHours" : "Proceed"));
}

/** Story: Recheck a queued message at send time / Replies, quiet hours and unanswered messages limit when a send can go out (spec/outboundAdmission.md:29) */
//@ pure
export function conversationPolicy(compliance: boolean, atCap: boolean, agent: boolean, reengaged: boolean, waited: boolean): ConversationAdmission {
  return compliance || !atCap ? ({ decision: "Proceed", reengage: false } as ConversationAdmission) : (agent && !reengaged && waited ? ({ decision: "Proceed", reengage: true } as ConversationAdmission) : ({ decision: "AwaitingReply", reengage: false } as ConversationAdmission));
}

/** Story: Recheck a queued message at send time / Apply line controls and sending caps before checking the text (spec/outboundAdmission.md:48) */
//@ pure
export function linePolicy(lineAction: string, agent: boolean, newConversation: boolean): Admission {
  return lineAction === "review" || (lineAction === "reply_only" && (agent || newConversation)) || (lineAction === "pause_new" && newConversation) ? "LinePaused" : "Proceed";
}

/** Story: Recheck a queued message at send time / Apply line controls and sending caps before checking the text (spec/outboundAdmission.md:48) */
//@ pure
export function lineCaps(compliance: boolean, agent: boolean, newConversation: boolean, recipientAtCap: boolean, lineAtCap: boolean, newAtCap: boolean): Admission {
  return compliance ? "Proceed" : (recipientAtCap ? "RecipientCap" : (agent && lineAtCap ? "LineCap" : (agent && newConversation && newAtCap ? "NewConversationCap" : "Proceed")));
}

/** Story: Recheck a queued message at send time / Apply line controls and sending caps before checking the text (spec/outboundAdmission.md:48) */
//@ pure
export function personPolicy(slotAllowed: boolean): Admission {
  return slotAllowed ? "Proceed" : "PersonCap";
}

/** Story: Recheck a queued message at send time / Apply line controls and sending caps before checking the text (spec/outboundAdmission.md:48) */
//@ pure
export function textPolicy(foundLeak: boolean): Admission {
  return foundLeak ? "LeakReview" : "Admit";
}

/** Story: Recheck a queued message at send time / Apply line controls and sending caps before checking the text (spec/outboundAdmission.md:48) */
//@ pure
export function lawLeakBlocksAdmission(foundLeak: boolean): boolean {
  //@ ensures \result === true
  return !foundLeak || textPolicy(foundLeak) !== "Admit";
}
