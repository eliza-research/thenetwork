// The pure decisions of the production service, proved with LemmaScript (docs/formal-verification.md).
// This file imports nothing: the callers in service.ts, inbox.ts, runtime.ts, relay-endpoint.ts,
// cloud-channel.ts, channel.ts, snapshot.ts, bias.ts, profile-suggestions.ts and photoIntake.ts read the
// facts (SQL, the consent ledger, parsed bodies) and call these functions. A proof here says only that the
// decision is right for its inputs: it does not prove that a caller reads an input correctly, or that two
// reads happen in one transaction. Age facts arrive as booleans from core/src/policy.ts (canJoin, isMinor,
// canBeMatched), so the age rules stay in one place.

export type ConsentState = "opted_in" | "opted_out";
export type MessageKind = "reply" | "compliance" | "proactive" | "transactional";
export type ReplyKind = "reply" | "compliance";
export type Refusal = "allowed" | "banned" | "suppressed" | "opted_out";

/**
 * The refusal of one send at send time. Compliance texts always go. Otherwise a suppressed number, a banned
 * number or person, and a number whose ledger reads opted out get nothing, on every app.
 */
export function sendRefusal(kind: MessageKind, suppressed: boolean, banned: boolean, consent: ConsentState | undefined): Refusal {
  //@ verify
  //@ ensures kind === "compliance" ==> \result === "allowed"
  //@ ensures kind !== "compliance" && suppressed ==> \result === "suppressed"
  //@ ensures kind !== "compliance" && banned && !suppressed ==> \result === "banned"
  //@ ensures kind !== "compliance" && consent === "opted_out" ==> \result !== "allowed"
  //@ ensures \result === "allowed" ==> kind === "compliance" || (!suppressed && !banned && consent !== "opted_out")
  if (kind === "compliance") return "allowed";
  if (suppressed) return "suppressed";
  if (banned) return "banned";
  return consent === "opted_out" ? "opted_out" : "allowed";
}

/** The current admission of a number: an ordinary reply could go to it now (the recycled-number hold included). */
export function numberAllowed(held: boolean, suppressed: boolean, banned: boolean, consent: ConsentState | undefined): boolean {
  //@ verify
  //@ ensures \result ==> !held && !suppressed && !banned && consent !== "opted_out"
  //@ ensures !held && !suppressed && !banned && consent !== "opted_out" ==> \result
  return !held && sendRefusal("reply", suppressed, banned, consent) === "allowed";
}

/** The one START hint goes only to an opted-out number that is neither banned nor suppressed: those stay quiet. */
export function stopHintDue(suppressed: boolean, banned: boolean, consent: ConsentState | undefined): boolean {
  //@ verify
  //@ ensures \result ==> consent === "opted_out" && !suppressed && !banned
  //@ ensures consent === "opted_out" && !suppressed && !banned ==> \result
  return sendRefusal("reply", suppressed, banned, consent) === "opted_out";
}

export type Collect = "collect" | "queue_for_review" | "refuse";
export interface ReplyFacts {
  kind: ReplyKind;
  suppressed: boolean;
  banned: boolean;
  held: boolean;
  /** The ledger reads opted out for this app (resolveConsent). */
  optedOut: boolean;
  /** network.members.opted_out, after the opt-out changes of this unit (a member from before the platform has no ledger event). */
  memberOptedOut: boolean;
  /** The queue's leak guard read this text. */
  leakChecked: boolean;
  leakClean: boolean;
  /** Fixed copy with no member data in it. */
  fixedCopy: boolean;
}

/**
 * The gate of the collected seam: a reply returned in a signed turn, which the outbound queue never sees.
 * A non-compliance reply needs the same consent, ban and suppression answer as a queued send, and no hold.
 * Every collected text is leak-clean or fixed copy that no guard read. A fixed compliance text always goes.
 */
export function collectGate(f: ReplyFacts): Collect {
  //@ verify
  //@ ensures \result === "collect" && f.kind !== "compliance" ==> !f.banned && !f.suppressed && !f.optedOut && !f.held && !f.memberOptedOut
  //@ ensures \result === "collect" ==> (f.leakChecked && f.leakClean) || f.fixedCopy
  //@ ensures \result === "collect" && f.leakChecked && !f.leakClean ==> f.kind === "compliance" && f.fixedCopy
  //@ ensures f.kind === "compliance" && f.fixedCopy ==> \result === "collect"
  //@ ensures \result === "refuse" ==> f.kind !== "compliance"
  if (f.kind === "compliance" && f.fixedCopy) return "collect";
  if (f.kind !== "compliance" && (f.held || f.suppressed || f.banned || f.optedOut || f.memberOptedOut)) return "refuse";
  if (f.leakChecked) return f.leakClean ? "collect" : "queue_for_review";
  return f.fixedCopy ? "collect" : "queue_for_review";
}

// ------------------------------------------------------------------ keywords and consent

export type Keyword = "stop" | "stop_all" | "start" | "help";
export type StopScope = "global" | "app";

/** Founder decision 7: on the shared line STOP stops every app. Only an app's own line may read the configured scope. */
export function stopScopeOf(kw: Keyword, shared: boolean, configured: StopScope): StopScope {
  //@ verify
  //@ ensures kw === "stop_all" ==> \result === "global"
  //@ ensures shared ==> \result === "global"
  //@ ensures !shared && kw !== "stop_all" ==> \result === configured
  return kw === "stop_all" || shared ? "global" : configured;
}

export type StartOutcome = "refused_banned" | "stale" | "opted_in";

/** What a START did. Only a ledger that reads opted in after the write reports an opt-in: an older START never undoes a newer STOP. */
export function startOutcome(banned: boolean, optedInAfterWrite: boolean): StartOutcome {
  //@ verify
  //@ ensures banned ==> \result === "refused_banned"
  //@ ensures \result === "opted_in" ==> !banned && optedInAfterWrite
  //@ ensures !banned && !optedInAfterWrite ==> \result === "stale"
  if (banned) return "refused_banned";
  return optedInAfterWrite ? "opted_in" : "stale";
}

/** The queue takes a person-cap slot by kind only, so a proactive send that is not a reply must carry the kind "proactive". */
export function outboundKind(reply: boolean, causal: boolean, replyingToMember: boolean, proactive: boolean): MessageKind {
  //@ verify
  //@ ensures proactive && !reply ==> \result === "proactive"
  //@ ensures \result === "reply" ==> reply && (causal || replyingToMember)
  //@ ensures \result !== "compliance"
  return reply && (causal || replyingToMember) ? "reply" : proactive ? "proactive" : "transactional";
}

// ------------------------------------------------------------------ ages

/** platform.apps.min_join_age must be a join age of 13 to 17: recordedAge relies on it. Checked when the rows load. */
export function joinAgeUsable(minJoinAge: number): boolean {
  //@ verify
  //@ ensures \result <==> minJoinAge >= 13 && minJoinAge < 18
  return minJoinAge >= 13 && minJoinAge < 18;
}

/**
 * The age kept for an age stated in chat. An under-13 statement the Network did not decline for (an attested
 * adult: staff decide) reads as the app's join age, which is still a minor; every other age stays as stated.
 */
export function recordedAge(age: number, declined: boolean, minJoinAge: number): number {
  //@ verify
  //@ requires joinAgeUsable(minJoinAge)
  //@ ensures age < 18 ==> \result < 18
  //@ ensures \result >= age
  //@ ensures declined ==> \result === age
  return declined ? age : Math.max(age, minJoinAge);
}

/** "What are you looking for?" never enrolls a minor or an unknown age in slop. `adult`: core canBeMatched of the lowest age. */
export function mayEnroll(app: string, adult: boolean): boolean {
  //@ verify
  //@ ensures \result && app === "slop" ==> adult
  //@ ensures adult ==> \result
  return app !== "slop" || adult;
}

// ------------------------------------------------------------------ join

export type JoinStep = "refuse_banned" | "invite_only" | "ask" | "decline_under_age" | "need_name" | "need_home" | "join";
export interface JoinFacts {
  banned: boolean;
  held: boolean;
  /** The app is invite-only here, and this person came by no other door (the invite, or the shared line of The Network). */
  inviteOnly: boolean;
  invited: boolean;
  hasAge: boolean;
  stated: number;
  /** A usable lowest age for the person or the phone (core validAge). */
  hasFloor: boolean;
  floor: number;
  minJoinAge: number;
  maxAge: number;
  hasName: boolean;
  invalidHome: boolean;
}

/** The lowest of the stated age and the phone's or person's floor: age is a person-level fact. */
export function effectiveAge(f: JoinFacts): number {
  //@ verify
  //@ ensures \result <= f.stated
  //@ ensures f.hasFloor ==> \result <= f.floor
  if (f.hasFloor && f.floor < f.stated) return f.floor;
  return f.stated;
}

/** The next step of a join. One rule for text (NetworkService.join) and the web (Accounts.joinLocked). */
export function joinStep(f: JoinFacts): JoinStep {
  //@ verify
  //@ requires f.minJoinAge >= 13
  //@ ensures \result === "join" ==> !f.banned && !f.held && f.hasAge && f.hasName && !f.invalidHome
  //@ ensures \result === "join" ==> f.stated >= 13 && f.stated <= f.maxAge && (f.hasFloor ==> f.floor >= 13)
  //@ ensures \result === "join" && f.inviteOnly ==> f.invited
  //@ ensures f.banned || f.held ==> \result === "refuse_banned"
  if (f.banned || f.held) return "refuse_banned";
  if (f.inviteOnly && !f.invited) return "invite_only";
  if (!f.hasAge) return f.invalidHome ? "need_home" : "ask";
  const age = effectiveAge(f);
  if (f.stated > f.maxAge || age > f.maxAge || age < f.minJoinAge) return "decline_under_age";
  if (f.invalidHome) return "need_home";
  if (!f.hasName) return "need_name";
  return "join";
}

// ------------------------------------------------------------------ the signed turn

export type TurnTag = "open" | "ignored" | "handled";
export interface TurnFacts {
  outcome: string;
  replies: number;
  hasApp: boolean;
  hasMember: boolean;
  /** The canonical membership of this sender is this member (Accounts.activeMembership). */
  bound: boolean;
  /** The shared context was read and passed its own recheck. */
  contextReady: boolean;
  policyAllowed: boolean;
  ageKnown: boolean;
  /** core canJoin of the lowest age. */
  joinableAge: boolean;
}
export interface TurnDecision {
  tag: TurnTag;
  accountEligible: boolean;
  onboarding: boolean;
  contextLost: boolean;
}

/** Unknown age never admits an account, history or matching. */
export function accountEligible(f: TurnFacts): boolean {
  //@ verify
  //@ ensures \result ==> f.policyAllowed && f.ageKnown && f.joinableAge
  return f.policyAllowed && f.ageKnown && f.joinableAge;
}

/** The turn may read the shared context: nothing else answers it, and the membership is bound. */
export function contextWanted(f: TurnFacts): boolean {
  //@ verify
  //@ ensures \result ==> f.outcome === "open" && f.replies === 0 && f.hasApp && f.hasMember && f.bound && f.policyAllowed
  return f.outcome === "open" && f.replies === 0 && f.hasApp && f.hasMember && f.bound && f.policyAllowed;
}

/** The answer to a signed turn. `open` lets the model talk to the person, so it needs every check to hold. */
export function turnDecision(f: TurnFacts): TurnDecision {
  //@ verify
  //@ ensures \result.tag === "open" ==> f.outcome === "open" && f.replies === 0 && f.hasMember && f.hasApp && f.bound && f.contextReady && f.policyAllowed
  //@ ensures \result.accountEligible ==> f.policyAllowed && f.ageKnown && f.joinableAge
  //@ ensures \result.onboarding ==> f.policyAllowed && !f.ageKnown && f.outcome === "join_asked" && !f.hasMember
  //@ ensures f.outcome === "no_network" || f.outcome === "unknown_sender" ==> \result.tag === "ignored"
  const eligible = accountEligible(f);
  const onboarding = f.policyAllowed && !f.ageKnown && f.outcome === "join_asked" && !f.hasMember;
  if (contextWanted(f) && f.contextReady) return { tag: "open", accountEligible: eligible, onboarding: false, contextLost: false };
  if (f.outcome === "no_network" || f.outcome === "unknown_sender") return { tag: "ignored", accountEligible: false, onboarding: false, contextLost: false };
  return { tag: "handled", accountEligible: eligible, onboarding, contextLost: f.outcome === "open" };
}

/** The member a turn answers for: nobody after a leave, and nobody below the join age. */
export function keepsMember(left: boolean, ageKnown: boolean, joinableAge: boolean): boolean {
  //@ verify
  //@ ensures \result ==> !left && (ageKnown ==> joinableAge)
  return !left && (!ageKnown || joinableAge);
}

/** The kind of a reply list. No replies is never "compliance". */
export function replyKindOf(kinds: ReplyKind[]): ReplyKind {
  //@ verify
  //@ ensures \result === "compliance" ==> kinds.length > 0 && forall(i: nat, i < kinds.length ==> kinds[i] === "compliance")
  return kinds.length > 0 && kinds.every(k => k === "compliance") ? "compliance" : "reply";
}

/**
 * A stored handled turn read again (or for the first time). An unsent onboarding prompt needs the current
 * admission and a still unknown age; a stored non-compliance reply needs the current admission, so a replay
 * after a later STOP or ban hands out nothing. Compliance replies always go.
 */
export function storedTurnAdmitted(onboarding: boolean, kind: ReplyKind, replies: number, allowedNow: boolean, ageKnownNow: boolean): boolean {
  //@ verify
  //@ requires replies >= 0
  //@ ensures onboarding && (!allowedNow || ageKnownNow) ==> !\result
  //@ ensures kind === "reply" && replies > 0 && !allowedNow ==> !\result
  //@ ensures !onboarding && kind === "compliance" ==> \result
  if (onboarding) return allowedNow && !ageKnownNow;
  return kind === "compliance" || replies === 0 || allowedNow;
}

// ------------------------------------------------------------------ turn receipts

export type ReceiptOutcome = "accepted" | "unknown" | "rejected";
export type ReceiptAction = "unavailable" | "replay" | "conflict" | "scope_invalid" | "invalid" | "store";
export type DeliveryStatus = "sent" | "send_unknown" | "refused_gateway";
export interface ReceiptFacts {
  turnDone: boolean;
  handled: boolean;
  hasPrior: boolean;
  identical: boolean;
  priorUnknown: boolean;
  collected: number;
  replyIds: number;
  idsMatch: boolean;
  providerIds: number;
  history: boolean;
  accountFree: boolean;
  outcome: ReceiptOutcome;
}

/** A persisted policy reply or the canonical join prompt may be accepted with no history; a member reply may not. */
export function accountFreeReply(eligible: boolean, kind: ReplyKind, onboardingPrompt: boolean, noMember: boolean, knownApp: boolean): boolean {
  //@ verify
  //@ ensures \result ==> !eligible
  //@ ensures \result && kind !== "compliance" ==> onboardingPrompt && noMember && knownApp
  return !eligible && (kind === "compliance" || (onboardingPrompt && kind === "reply" && noMember && knownApp));
}

/**
 * The receipt of one handled turn. A stored receipt is final, except that `unknown` may become accepted or
 * rejected. Accepted needs provider ids and history (or an account-free reply); anything else claims no history.
 */
export function receiptAction(r: ReceiptFacts): ReceiptAction {
  //@ verify
  //@ requires r.collected >= 0 && r.replyIds >= 0 && r.providerIds >= 0
  //@ ensures \result === "store" ==> r.turnDone && r.handled
  //@ ensures \result === "store" ==> !r.hasPrior || (r.priorUnknown && r.outcome !== "unknown")
  //@ ensures \result === "store" && r.collected > 0 && r.outcome === "accepted" ==> r.providerIds > 0 && (r.history || r.accountFree)
  //@ ensures \result === "store" && r.collected > 0 && r.outcome !== "accepted" ==> !r.history
  //@ ensures \result === "store" && r.collected === 0 ==> r.replyIds === 0 && r.providerIds === 0 && !r.history
  //@ ensures \result === "store" && r.collected > 0 ==> r.idsMatch
  //@ ensures r.hasPrior && !r.identical && !r.priorUnknown && r.turnDone && r.handled ==> \result === "conflict"
  if (!r.turnDone || !r.handled) return "unavailable";
  if (r.hasPrior && r.identical) return "replay";
  if (r.hasPrior && !(r.priorUnknown && r.outcome !== "unknown")) return "conflict";
  if (r.collected === 0) return r.replyIds > 0 || r.providerIds > 0 || r.history ? "scope_invalid" : "store";
  if (!r.idsMatch) return "scope_invalid";
  if ((r.outcome === "accepted" && (r.providerIds === 0 || (!r.history && !r.accountFree))) || (r.outcome !== "accepted" && r.history)) return "invalid";
  return "store";
}

/** Accepted is the only path to `sent`. */
export function receiptStatus(o: ReceiptOutcome): DeliveryStatus {
  //@ verify
  //@ ensures \result === "sent" <==> o === "accepted"
  return o === "accepted" ? "sent" : o === "unknown" ? "send_unknown" : "refused_gateway";
}

// ------------------------------------------------------------------ the inbox

/** A new signed turn waits for a running turn. Compliance text waits for nothing else, whatever is pending or unresolved. */
export function turnHeldBack(compliance: boolean, processing: boolean, pending: boolean, recentUnresolved: boolean): boolean {
  //@ verify
  //@ ensures compliance ==> (\result <==> processing)
  //@ ensures !processing && !pending && !recentUnresolved ==> !\result
  return processing || (!compliance && (pending || recentUnresolved));
}

export type PriorAnswer = "busy" | "conflict" | "replay" | "unresolved";

/** The answer to a turn id that was not claimed. A row with another hash never replays. */
export function priorAnswer(found: boolean, sameHash: boolean, done: boolean, hasResponse: boolean, processing: boolean): PriorAnswer {
  //@ verify
  //@ ensures \result === "replay" ==> found && sameHash && done && hasResponse
  //@ ensures found && !sameHash ==> \result === "conflict"
  //@ ensures !found ==> \result === "busy"
  if (!found) return "busy";
  if (!sameHash) return "conflict";
  if (done && hasResponse) return "replay";
  return processing ? "busy" : "unresolved";
}

/** The next waiting row: the first compliance row, else the oldest. */
export function pickWaiting(compliance: boolean[]): number {
  //@ verify
  //@ requires compliance.length > 0
  //@ ensures \result >= 0 && \result < compliance.length
  //@ ensures forall(i: nat, i < compliance.length && compliance[i] ==> compliance[\result])
  //@ ensures compliance[\result] ==> forall(i: nat, i < \result ==> !compliance[i])
  //@ ensures !compliance[\result] ==> \result === 0
  const at = compliance.findIndex(c => c);
  return at >= 0 ? at : 0;
}

export type RescueAction = "release" | "seal";

/** A failed compliance turn. A committed consent change or a collected reply is never released for a retry. */
export function rescueAction(hasConsent: boolean, collected: number): RescueAction {
  //@ verify
  //@ requires collected >= 0
  //@ ensures hasConsent ==> \result === "seal"
  //@ ensures collected > 0 ==> \result === "seal"
  //@ ensures !hasConsent && collected === 0 ==> \result === "release"
  return !hasConsent && collected === 0 ? "release" : "seal";
}

// ------------------------------------------------------------------ Cloud deliver

export type OkField = "yes" | "no" | "other";
export type DeliverError = "opted_out" | "rejected" | "unknown" | "other";
export interface DeliverView {
  status: number;
  ok: OkField;
  error: DeliverError;
  retryable: boolean;
  wellFormedAccept: boolean;
}
export type DeliverClass = "accepted" | "blocked" | "retryable" | "invalid" | "not_admitted" | "unknown";

/** An HTTP status that states a refusal. */
export function refusalStatus(s: number): boolean {
  //@ verify
  return s === 400 || s === 401 || s === 403 || s === 404 || s === 409 || s === 422;
}

/**
 * Never a resend on doubt. Cloud's `unknown` or a malformed body stays unknown; a retry needs an explicit
 * retryable refusal; a receipt lookup never blocks, invalidates or retries by itself.
 */
export function classifyDeliver(v: DeliverView, receiptOnly: boolean): DeliverClass {
  //@ verify
  //@ ensures \result === "accepted" ==> v.status === 200 && v.ok === "yes" && v.wellFormedAccept
  //@ ensures v.error === "unknown" && v.ok !== "yes" ==> \result === "unknown"
  //@ ensures v.ok === "other" ==> \result === "unknown"
  //@ ensures \result === "retryable" ==> !receiptOnly && v.ok === "no" && v.error === "rejected" && v.retryable
  //@ ensures \result === "blocked" ==> !receiptOnly && v.ok === "no" && v.error === "opted_out"
  //@ ensures receiptOnly ==> \result === "accepted" || \result === "not_admitted" || \result === "unknown"
  //@ ensures \result === "invalid" ==> !receiptOnly && refusalStatus(v.status) && v.ok === "no" && v.error !== "unknown" && v.error !== "opted_out"
  //@ ensures \result === "not_admitted" ==> receiptOnly && v.ok === "no" && v.error === "rejected" && v.retryable
  if (v.status === 200 && v.ok === "yes" && v.wellFormedAccept) return "accepted";
  if (receiptOnly && v.ok === "no" && v.error === "rejected" && v.retryable) return "not_admitted";
  if (!receiptOnly && v.ok === "no" && v.error !== "unknown") {
    if (v.error === "opted_out") return "blocked";
    if (v.error === "rejected" && v.retryable) return "retryable";
    if (refusalStatus(v.status)) return "invalid";
  }
  return "unknown";
}

/** Both live flags, and the app's own flag. */
export function liveAllowed(allowSend: boolean, networkApproved: boolean, appApproved: boolean): boolean {
  //@ verify
  //@ ensures \result <==> allowSend && networkApproved && appApproved
  return allowSend && networkApproved && appApproved;
}

// ------------------------------------------------------------------ relay

export type WireDecision = "pass" | "hold" | "block" | "none";
export type DeskDecision = "sent" | "held" | "refused";

/** The desk's outcome on the Cloud wire: only a send is a pass. */
export function relayWire(d: DeskDecision): WireDecision {
  //@ verify
  //@ ensures \result === "pass" <==> d === "sent"
  //@ ensures \result !== "none"
  return d === "sent" ? "pass" : d === "held" ? "hold" : "block";
}

/** The outbound statuses that mean Cloud took the row. */
export function rowAccepted(status: string): boolean {
  //@ verify
  return status === "accepted" || status === "sent" || status === "delivered" || status === "read";
}

/** Delivered only for a pass whose row Cloud accepted with provider ids and history. */
export function relayDelivered(decision: WireDecision, hasRow: boolean, status: string, history: boolean, providerIds: number): boolean {
  //@ verify
  //@ requires providerIds >= 0
  //@ ensures \result ==> decision === "pass" && hasRow && history && providerIds > 0 && rowAccepted(status)
  if (decision !== "pass") return false;
  return hasRow && rowAccepted(status) && history && providerIds > 0;
}

export interface RelayParty {
  adult: boolean;
  optedOut: boolean;
  held: boolean;
}
export type PairReason = "ok" | "party:age" | "party:opted_out" | "party:held";

/** One member as the canonical owners see it. No row or no binding fails closed. */
export function relayCanonical(hasRow: boolean, rowOptedOut: boolean, accountActive: boolean, bound: boolean, adult: boolean): RelayParty {
  //@ verify
  //@ ensures !hasRow ==> \result.optedOut && \result.held
  //@ ensures !bound ==> \result.optedOut
  //@ ensures !\result.optedOut && !\result.held ==> hasRow && bound && !rowOptedOut && accountActive
  return { adult, optedOut: !hasRow || rowOptedOut || !bound, held: !hasRow || !accountActive };
}

/** Final relay dispatch: every party is an adult, not opted out and not held. */
export function pairReason(ps: RelayParty[]): PairReason {
  //@ verify
  //@ ensures \result === "ok" ==> forall(i: nat, i < ps.length ==> ps[i].adult && !ps[i].optedOut && !ps[i].held)
  for (let i = 0; i < ps.length; i++) {
    //@ invariant 0 <= i && i <= ps.length
    //@ invariant forall(j: nat, j < i ==> ps[j].adult && !ps[j].optedOut && !ps[j].held)
    //@ decreases ps.length - i
    if (!ps[i].adult) return "party:age";
    if (ps[i].optedOut) return "party:opted_out";
    if (ps[i].held) return "party:held";
  }
  return "ok";
}

// ------------------------------------------------------------------ participation

export type WindowState = "open" | "busy" | "traveling" | "paused";
export type Participation = "open" | "normal" | "quiet" | "receiving" | "paused";
export interface WindowTimes {
  optedOut: boolean;
  hasWindow: boolean;
  hasFrom: boolean;
  fromMs: number;
  hasUntil: boolean;
  untilMs: number;
  now: number;
}

/** A stored window counts between its bounds, and never for an opted-out member. */
export function windowActive(w: WindowTimes): boolean {
  //@ verify
  //@ ensures \result ==> !w.optedOut && w.hasWindow
  //@ ensures \result && w.hasFrom ==> w.fromMs <= w.now
  //@ ensures \result && w.hasUntil ==> w.untilMs > w.now
  return !w.optedOut && w.hasWindow && (!w.hasFrom || w.fromMs <= w.now) && (!w.hasUntil || w.untilMs > w.now);
}

/** STOP outranks every window: the agent's set-state cannot undo it. */
export function effectiveState(optedOut: boolean, active: boolean, w: WindowState, base: Participation): Participation {
  //@ verify
  //@ ensures optedOut ==> \result === "paused"
  //@ ensures active && !optedOut && w === "paused" ==> \result === "paused"
  //@ ensures !optedOut && !active ==> \result === base
  if (optedOut) return "paused";
  if (!active) return base;
  return w === "open" ? "normal" : w === "paused" ? "paused" : "quiet";
}

/** A state with a date or a note is a scheduled window; traveling always is. */
export function isScheduled(state: WindowState, hasFrom: boolean, hasUntil: boolean, hasNote: boolean): boolean {
  //@ verify
  //@ ensures state === "traveling" ==> \result
  //@ ensures !\result ==> !hasFrom && !hasUntil && !hasNote
  return state === "traveling" || hasFrom || hasUntil || hasNote;
}

/** Unchanged writes no event and no row. */
export function stateUnchanged(sameBase: boolean, scheduled: boolean, hadWindow: boolean, sameWindow: boolean): boolean {
  //@ verify
  //@ ensures \result ==> sameBase
  //@ ensures \result && scheduled ==> hadWindow && sameWindow
  //@ ensures \result && !scheduled ==> !hadWindow
  return sameBase && (scheduled ? hadWindow && sameWindow : !hadWindow);
}

// ------------------------------------------------------------------ profile suggestions and photos

export type CleanupOp = "disconnect" | "delete" | "readback" | "withdraw";
export type RowAction = "keep" | "withdraw" | "delete";

/** One suggestion row in a cleanup: readback changes nothing, delete ignores retention, withdraw keeps decided rows, disconnect honors retention. */
export function cleanupAction(op: CleanupOp, status: string, retain: boolean): RowAction {
  //@ verify
  //@ ensures op === "readback" ==> \result === "keep"
  //@ ensures op === "delete" ==> \result === "delete"
  //@ ensures op === "withdraw" && status !== "proposed" ==> \result === "keep"
  //@ ensures op === "disconnect" && status === "accepted" && retain ==> \result === "keep"
  //@ ensures op === "disconnect" && !retain ==> \result === "withdraw"
  if (op === "readback") return "keep";
  if (op === "delete") return "delete";
  if (op === "withdraw") return status === "proposed" ? "withdraw" : "keep";
  return status === "accepted" && retain ? "keep" : "withdraw";
}

export type ReviewPath = "preview" | "saved";

/** An edit or a scope change is a new preview, never an acceptance. */
export function reviewPath(anyEdit: boolean, anyScopeChange: boolean): ReviewPath {
  //@ verify
  //@ ensures anyEdit || anyScopeChange ==> \result === "preview"
  //@ ensures !anyEdit && !anyScopeChange ==> \result === "saved"
  return anyEdit || anyScopeChange ? "preview" : "saved";
}

export type PhotoStep = "drop" | "refuse" | "ask" | "fetch";

/** A photo by text: no attachment is fetched before the membership, the adult check and the consent all hold. */
export function photoIntakeStep(member: boolean, refused: boolean, consented: boolean): PhotoStep {
  //@ verify
  //@ ensures \result === "fetch" <==> member && !refused && consented
  //@ ensures !member ==> \result === "drop"
  if (!member) return "drop";
  if (refused) return "refuse";
  return consented ? "fetch" : "ask";
}

/** The bias monitor counts adult members with at least one day in the window. */
export function biasEligible(adult: boolean, hasJoined: boolean, joinedAt: number, now: number, windowFrom: number, day: number): boolean {
  //@ verify
  //@ requires day > 0
  //@ ensures \result ==> adult && hasJoined && now - joinedAt >= day && now - windowFrom >= day
  if (!adult || !hasJoined) return false;
  return now - Math.max(joinedAt, windowFrom) >= day;
}
