// The pure decisions of the ConsentNetwork, proved with LemmaScript (docs/formal-verification.md).
// This file imports nothing and has only top-level functions: the class in network.ts cannot be
// annotated in place (private Maps, regexes, hooks, I/O), so each decision lives here and the class,
// the trust ledger, the relay desk, the outreach rules and the job posts call it. A proof here says
// what the decision does with its inputs. The inputs are read by the callers (Maps, regexes,
// syncRecord, the core age policy) and are trusted. Reason strings are the ones the logs and the
// staff API already use, and "ok" means nothing refused. Numbers are ideal in the proofs.

// ------------------------------------------------------------------ consent: only a yes is a yes
export type Reading = "yes" | "no" | "counter" | "unclear";
export type ReadingWhy = "affirm" | "refusal" | "mixed" | "conditional" | "hedged" | "counter" | "no_signal";
export type ProbeAnswer = "yes" | "no" | "unclear";
/**
 * What a reply to a probe does. "picked", "open" and "none_fit" are the three kinds of yes (named
 * times, every time not ruled out, a yes to the plan with none of the times). "ask_times" is not a
 * yes: other times may be offered once, and nothing is recorded.
 */
export type ProbeRoute = "no" | "unclear" | "mixed" | "picked" | "open" | "none_fit" | "ask_times";
/** What a reply says about the offered times. All false when the probe offered none. */
export interface TimePicks { hasOptions: boolean; picked: boolean; firmPick: boolean; neither: boolean; anyOf: boolean; openLeft: boolean }
export type LlmConsent = "yes" | "no" | "other";

/** The last step of consentOf: the signals of a reply, refusals first, into why it reads as it does. */
export function readingWhy(refused: boolean, affirmAfterRefusal: boolean, counter: boolean, conditional: boolean, hedged: boolean, affirmed: boolean, sharedNo: boolean): ReadingWhy {
  //@ verify
  //@ ensures \result === "affirm" ==> affirmed && !refused && !counter && !conditional && !hedged && !sharedNo
  //@ ensures refused && !affirmAfterRefusal ==> \result === "refusal"
  //@ ensures refused ==> \result === "refusal" || \result === "mixed"
  if (refused) return affirmAfterRefusal ? "mixed" : "refusal";
  if (counter) return "counter";
  if (conditional) return "conditional";
  if (hedged) return "hedged";
  if (affirmed) return sharedNo ? "mixed" : "affirm";
  return "no_signal";
}

/** The answer a reading gives. Only "affirm" is a yes. */
export function readingOf(why: ReadingWhy): Reading {
  //@ verify
  //@ ensures \result === "yes" <==> why === "affirm"
  //@ ensures \result === "no" <==> why === "refusal"
  //@ ensures \result === "counter" <==> why === "counter"
  if (why === "affirm") return "yes";
  if (why === "refusal") return "no";
  return why === "counter" ? "counter" : "unclear";
}

/** True for the routes that are a yes to the probe. */
export function routeIsYes(r: ProbeRoute): boolean {
  //@ verify
  //@ ensures \result <==> r === "picked" || r === "open" || r === "none_fit"
  return r === "picked" || r === "open" || r === "none_fit";
}

/**
 * The last step of parseProbeReply. Founder decision 11: only a yes is consent, and a counter is not
 * a yes. A reply may also be a firm pick of an offered time ("Saturday works") with no yes word: that
 * answers the question that was asked. A counter, a bare "neither", a refusal, a conditional, a hedge
 * and a mixed reply are never a yes.
 */
export function probeRoute(c: Reading, why: ReadingWhy, p: TimePicks): ProbeRoute {
  //@ verify
  //@ ensures routeIsYes(\result) ==> c === "yes" || (c === "unclear" && (p.anyOf || (p.picked && p.firmPick)))
  //@ ensures routeIsYes(\result) ==> c !== "counter" && c !== "no"
  //@ ensures routeIsYes(\result) ==> why !== "refusal" && why !== "mixed" && why !== "conditional" && why !== "hedged" && why !== "counter"
  //@ ensures \result === "none_fit" ==> c === "yes"
  //@ ensures why === "refusal" && !p.firmPick ==> \result === "no"
  //@ ensures \result === "ask_times" ==> p.hasOptions
  if (why === "refusal") return p.firmPick ? "mixed" : "no";
  if (why === "mixed" || why === "conditional" || why === "hedged") return "unclear";
  if (c === "no") return "unclear";
  if (c === "counter" || why === "counter") return p.hasOptions ? "ask_times" : "unclear";
  if (p.picked && (c === "yes" || p.firmPick)) return "picked";
  if (p.neither) return c === "yes" ? "none_fit" : p.hasOptions ? "ask_times" : "unclear";
  if (p.anyOf) return p.openLeft ? "open" : "unclear";
  return c === "yes" ? "open" : "unclear";
}

/** mergeConsent and yesNoOf: the LLM's word counts only where the rules found no signal at all. */
export function llmReading(a: Reading, why: ReadingWhy, llm: LlmConsent): Reading {
  //@ verify
  //@ ensures \result === "yes" ==> a === "yes" || (a === "unclear" && why === "no_signal" && llm === "yes")
  //@ ensures a !== "unclear" || why !== "no_signal" ==> \result === a
  if (a !== "unclear" || why !== "no_signal") return a;
  if (llm === "yes") return "yes";
  return llm === "no" ? "no" : a;
}

/** A bare "ok" after two or more messages in a row may answer either one: not a yes to meeting someone. */
export function afterBareAck(a: ProbeAnswer, outboundBefore: number, ackOnly: boolean): ProbeAnswer {
  //@ verify
  //@ ensures \result === "yes" ==> a === "yes" && (outboundBefore < 2 || !ackOnly)
  //@ ensures a !== "yes" ==> \result === a
  return a === "yes" && outboundBefore >= 2 && ackOnly ? "unclear" : a;
}

// ------------------------------------------------------------------ opportunity stages and probes
export type Stage = "review" | "probing" | "scheduled" | "done" | "closed";
export type PStatus = "queued" | "probing" | "available" | "unavailable" | "yes" | "no" | "dropped";
/** What happened to a member's probe. "silence" and "send_refused" are not answers. */
export type ProbeEvent = "said_yes" | "said_no" | "primed" | "silence" | "send_refused";

/**
 * The one step that can make a probed member available. `recordedYes` is what the Network stored
 * earlier (they asked for this, or said yes). Silence or a refused send keeps a yes that was recorded
 * and never makes one: both-yes needs a yes from each member.
 */
export function statusAfter(prev: PStatus, e: ProbeEvent, recordedYes: boolean): PStatus {
  //@ verify
  //@ ensures \result === "available" ==> prev === "available" || e === "said_yes" || recordedYes
  //@ ensures (e === "silence" || e === "send_refused") && !recordedYes && prev === "probing" ==> \result === "unavailable"
  //@ ensures e === "said_no" && prev === "probing" ==> \result === "unavailable"
  //@ ensures prev !== "probing" && prev !== "queued" ==> \result === prev
  if (prev !== "probing" && prev !== "queued") return prev;
  if (e === "said_yes") return "available";
  if (e === "said_no") return "unavailable";
  return recordedYes ? "available" : "unavailable";
}

/** The review gate: to probing only on an approval, before the SLA deadline, with every gate passed. */
export function afterReview(stage: Stage, approved: boolean, now: number, deadline: number, gatesOk: boolean): Stage {
  //@ verify
  //@ ensures \result === "probing" && stage === "review" ==> approved && now < deadline && gatesOk
  //@ ensures stage !== "review" ==> \result === stage
  //@ ensures stage === "review" ==> \result === "probing" || \result === "closed"
  if (stage !== "review") return stage;
  if (!approved || now >= deadline || !gatesOk) return "closed";
  return "probing";
}

/** The SLA tick: an item past its deadline closes, unsent. Nothing else moves. */
export function afterSla(stage: Stage, now: number, deadline: number): Stage {
  //@ verify
  //@ ensures stage === "review" && now >= deadline ==> \result === "closed"
  //@ ensures \result === "review" ==> now < deadline
  //@ ensures stage !== "review" ==> \result === stage
  if (stage === "review" && now >= deadline) return "closed";
  return stage;
}

/** Only a reject may be decided past the deadline: approve, edit and reroll would start or extend the item. */
export function reviewLate(rejecting: boolean, now: number, deadline: number): boolean {
  //@ verify
  //@ ensures !\result && !rejecting ==> now < deadline
  //@ ensures rejecting ==> !\result
  return !rejecting && now >= deadline;
}

export function allAvailable(statuses: PStatus[]): boolean {
  //@ verify
  //@ ensures \result === (forall(i, 0 <= i && i < statuses.length ==> statuses[i] === "available"))
  return statuses.every(s => s === "available");
}

/** Reveal: scheduled only with every participant available. */
export function afterAnswers(stage: Stage, statuses: PStatus[]): Stage {
  //@ verify
  //@ ensures \result === "scheduled" && stage === "probing" ==> (forall(i, 0 <= i && i < statuses.length ==> statuses[i] === "available"))
  //@ ensures stage !== "probing" ==> \result === stage
  if (stage !== "probing") return stage;
  return allAvailable(statuses) ? "scheduled" : "probing";
}

/** Sequential probes: a non-first member is probed only after the first said yes (peon: the manager after the candidate). */
export function mayProbe(isFirst: boolean, firstIn: boolean, st: PStatus): boolean {
  //@ verify
  //@ ensures \result ==> st === "queued" || st === "probing"
  //@ ensures \result && !isFirst ==> firstIn
  if (st !== "queued" && st !== "probing") return false;
  return isFirst || firstIn;
}

/** A plan books at its quorum; a two-person activity needs only the pair. */
export function quorumMet(going: number, quorum: number, pairActivity: boolean): boolean {
  //@ verify
  //@ ensures \result ==> going >= quorum || (going >= 2 && pairActivity)
  return going >= quorum || (going >= 2 && pairActivity);
}

/** What a person may be put into. Each fact false or true as named: a reader of Maps fills them in. */
export interface SeatFacts { minor: boolean; account: boolean; optedOut: boolean; active: boolean; onlyWhenAsked: boolean; trustOk: boolean; ageKnown: boolean; reportHeld: boolean; free: boolean }

/** eligible and planSeatOk: never a minor, a paused or restricted account, an opt-out, a watch or hold, or an open urgent report. */
export function seatOk(s: SeatFacts): boolean {
  //@ verify
  //@ ensures \result ==> !s.minor && !s.account && !s.optedOut && s.active && !s.onlyWhenAsked && s.trustOk && s.ageKnown && !s.reportHeld && s.free
  return !s.minor && !s.account && !s.optedOut && s.active && !s.onlyWhenAsked && s.trustOk && s.ageKnown && !s.reportHeld && s.free;
}

export interface ApprovalFacts { declined: boolean; known: boolean; optedOut: boolean; held: boolean; trustOk: boolean; minor: boolean; reportHeld: boolean; busy: boolean }

/** The gates again at approval, for one participant. */
export function approvalVerdict(p: ApprovalFacts): string {
  //@ verify
  //@ ensures \result === "ok" ==> !p.declined && p.known && !p.optedOut && p.trustOk && !p.held && !p.minor && !p.reportHeld && !p.busy
  if (p.declined) return "participant_declined";
  if (!p.known) return "unknown_member";
  if (p.optedOut) return "opted_out";
  if (p.held) return "held";
  if (!p.trustOk) return "on_watch";
  if (p.minor) return "participant_minor";
  if (p.reportHeld) return "report_held";
  if (p.busy) return "busy_elsewhere";
  return "ok";
}

// ------------------------------------------------------------------ the minors policy
/** One person's ages as the core policy reads them. `*Known` is validAge; `*Adult` also means canBeMatched. */
export interface AgeFacts { attestedKnown: boolean; attestedAdult: boolean; statedKnown: boolean; statedAdult: boolean }

/** Decline and delete only on the record age or an explicit age under the join age. An attested adult is never deleted. */
export function mustDecline(attestedAdult: boolean, attestedUnder: boolean, explicitUnder: boolean): boolean {
  //@ verify
  //@ ensures attestedAdult ==> !\result
  //@ ensures \result ==> attestedUnder || explicitUnder
  //@ ensures !attestedAdult && (attestedUnder || explicitUnder) ==> \result
  if (attestedAdult) return false;
  return attestedUnder || explicitUnder;
}

/**
 * An age the LLM reader found (extract.ts) only ever makes the member younger: with no age from the
 * rules it counts only when it is a minor's age (`llmMinor`, core isMinor); with one, only when it is
 * lower. The lowest age wins, and an LLM guess never turns an unknown age into an adult.
 */
export function llmAgeCounts(rulesKnown: boolean, rulesAge: number, llmAge: number, llmMinor: boolean): boolean {
  //@ verify
  //@ ensures \result && !rulesKnown ==> llmMinor
  //@ ensures \result && rulesKnown ==> llmAge < rulesAge
  //@ ensures !llmMinor && !rulesKnown ==> !\result
  return rulesKnown ? llmAge < rulesAge : llmMinor;
}

/** A stated adult age resolves a missing record age, unless something else reads like a minor. */
export function minorClears(wasMinor: boolean, attestedKnown: boolean, knownAdult: boolean, signal: boolean, conflict: boolean, reported: boolean): boolean {
  //@ verify
  //@ ensures \result ==> wasMinor && !attestedKnown && knownAdult && !signal && !conflict && !reported
  return wasMinor && !attestedKnown && knownAdult && !signal && !conflict && !reported;
}

/**
 * Must this message make the member a minor? `current` is false only when the member is not one yet.
 * After this step a member who is not a minor has a known age, every known age is adult, and this
 * message had no minor signal. The lowest age wins: one young age is enough.
 */
export function minorRises(current: boolean, a: AgeFacts, newSignal: boolean): boolean {
  //@ verify
  //@ ensures !current && !\result ==> !newSignal && (a.attestedKnown || a.statedKnown) && (!a.attestedKnown || a.attestedAdult) && (!a.statedKnown || a.statedAdult)
  //@ ensures current ==> !\result
  if (current) return false;
  const anyKnown = a.attestedKnown || a.statedKnown;
  const young = (a.attestedKnown && !a.attestedAdult) || (a.statedKnown && !a.statedAdult);
  return !anyKnown || young || newSignal;
}

/** Staff clear a minor signal only for a record age that says adult, and no stated age that says otherwise. */
export function signalClearVerdict(recordKnown: boolean, recordAdult: boolean, statedKnown: boolean, statedAdult: boolean): string {
  //@ verify
  //@ ensures \result === "ok" ==> recordKnown && recordAdult && (!statedKnown || statedAdult)
  if (!recordKnown) return "age_unknown";
  if (!recordAdult) return "record_minor";
  if (statedKnown && !statedAdult) return "stated_minor";
  return "ok";
}

// ------------------------------------------------------------------ the recipient gate
/** `cannotJoin`: core canJoin is false for the record age (under 13; an age lowered on another app, journeys B6). */
export interface RecipientFacts { declined: boolean; known: boolean; optedOut: boolean; cannotJoin: boolean; account: boolean; held: boolean; trustOk: boolean; minor: boolean; onlyWhenAsked: boolean }
/** One other person a message is about. */
export interface OtherFacts { blocked: boolean; known: boolean; minor: boolean; account: boolean; declined: boolean; trustOk: boolean }
/** What the send is: `aboutOthers` is ABOUT_OTHERS, `askKind` is ASK_KINDS. */
export interface SendClass { reply: boolean; safety: boolean; proactive: boolean; askKind: boolean; reengage: boolean; aboutOthers: boolean }

export function otherVerdict(x: OtherFacts): string {
  //@ verify
  //@ ensures \result === "ok" ==> !x.blocked && x.known && !x.minor && !x.account && !x.declined && x.trustOk
  if (x.blocked) return "blocked_pair";
  if (!x.known || x.minor || x.account || x.declined) return "other_not_matchable";
  if (!x.trustOk) return "other_on_watch";
  return "ok";
}

/**
 * The send-time recipient policy. Never to a declined, unknown or opted-out member. A member who
 * cannot join (under 13) gets safety notices only (the decline itself): under 13 cannot use any app. A held or paused
 * account gets replies and safety notices only. Anything about another member never reaches a minor
 * or a member on watch, and every other person is a known adult, not blocked, not on watch.
 * `account_` is the prefix of the reason: the caller adds the account status.
 */
export function recipientVerdict(r: RecipientFacts, s: SendClass, about: OtherFacts[]): string {
  //@ verify
  //@ ensures \result === "ok" ==> !r.declined && r.known && !r.optedOut
  //@ ensures \result === "ok" && !s.safety ==> !r.cannotJoin
  //@ ensures \result === "ok" && !s.reply && !s.safety ==> !r.account && !r.held
  //@ ensures \result === "ok" && s.proactive && !s.reengage ==> !r.onlyWhenAsked
  //@ ensures \result === "ok" && s.askKind && !s.reply && !s.reengage ==> !r.onlyWhenAsked
  //@ ensures \result === "ok" && s.aboutOthers ==> !r.minor && r.trustOk
  //@ ensures \result === "ok" && s.aboutOthers ==> (forall(i, 0 <= i && i < about.length ==> !about[i].blocked && about[i].known && !about[i].minor && !about[i].account && !about[i].declined && about[i].trustOk))
  if (r.declined) return "declined";
  if (!r.known) return "unknown_member";
  if (r.optedOut) return "opted_out";
  if (r.cannotJoin && !s.safety) return "cannot_join";
  if (r.account && !s.reply && !s.safety) return "account_";
  if (!s.reply && !s.safety && r.held) return "held";
  if (r.onlyWhenAsked && !s.reengage && (s.proactive || (s.askKind && !s.reply))) return "only_when_asked";
  if (!s.aboutOthers) return "ok";
  if (r.minor) return "minor";
  if (!r.trustOk) return "on_watch";
  let i = 0;
  while (i < about.length) {
    //@ type i nat
    //@ invariant i <= about.length
    //@ invariant forall(j, 0 <= j && j < i ==> !about[j].blocked && about[j].known && !about[j].minor && !about[j].account && !about[j].declined && about[j].trustOk)
    //@ decreases about.length - i
    const v = otherVerdict(about[i]!);
    if (v !== "ok") return v;
    i = i + 1;
  }
  return "ok";
}

/**
 * The whole send-time check: the recipient gate first, then, for an invite or an introduction
 * (`invite`: a probe or a reveal), the engine's send-time re-check (filters.ts eligibilityFor with the
 * opportunity's lane, CLAUDE.md decision 11). `engineReason` is its reason, "" for none. The engine
 * adds what the gate does not hold: the lane opt-in, a paused participation state, a held report or
 * a minor signal (the engine's safety holds), and the effective match age of the config and the pack.
 */
export function sendTimeVerdict(gate: string, invite: boolean, engineReason: string): string {
  //@ verify
  //@ ensures gate !== "ok" ==> \result === gate
  //@ ensures \result === "ok" ==> gate === "ok"
  //@ ensures \result === "ok" && invite ==> engineReason === ""
  //@ ensures gate === "ok" && (!invite || engineReason === "") ==> \result === "ok"
  if (gate !== "ok") return gate;
  // An engine reason that reads "ok" is still a refusal (fail closed).
  if (invite && engineReason !== "") return engineReason === "ok" ? "engine_refused" : engineReason;
  return "ok";
}

// ------------------------------------------------------------------ budgets
/** How many send times fall inside the window. */
export function windowCount(ts: number[], now: number, windowMs: number): number {
  //@ verify
  //@ ensures \result >= 0 && \result <= ts.length
  if (ts.length === 0) return 0;
  const head = ts[0]!;
  return (now - head < windowMs ? 1 : 0) + windowCount(ts.slice(1), now, windowMs);
}

/** May one more go out under this cap? */
export function mayPush(ts: number[], now: number, windowMs: number, cap: number): boolean {
  //@ verify
  //@ ensures \result <==> windowCount(ts, now, windowMs) < cap
  return windowCount(ts, now, windowMs) < cap;
}

/** Record one send, oldest first. A send under the cap keeps the window at or under the cap. */
export function withSend(ts: number[], now: number): number[] {
  //@ verify
  //@ ensures \result.length === ts.length + 1
  //@ ensures \result[ts.length] === now
  return [...ts, now];
}

/**
 * Why an unsolicited send may not go out now, or "ok". Never a third in a row with no answer, except
 * the one re-engagement. A state with no budget gets nothing. A send that is not about an opportunity
 * never takes the last slot of the state budget.
 */
export function unsolVerdict(streak: number, reengagement: boolean, stateBudget: number, used: number, laneBudget: number, stateLane: boolean, invite: boolean): string {
  //@ verify
  //@ ensures \result === "ok" ==> streak < 2 || (reengagement && streak === 2)
  //@ ensures \result === "ok" ==> stateBudget > 0 && used < laneBudget
  //@ ensures \result === "ok" && stateLane && !invite ==> used + 1 < laneBudget
  if (streak >= 2 && !(reengagement && streak === 2)) return "two_unanswered";
  if (stateBudget <= 0) return "prd_budget";
  if (used >= laneBudget) return "prd_budget";
  if (stateLane && !invite && used + 1 >= laneBudget) return "prd_budget_reserved";
  return "ok";
}

/** Inside a daily window [s, e), which may wrap past midnight. An empty window holds nothing. */
export function inHourWindow(h: number, s: number, e: number): boolean {
  //@ verify
  //@ type h real
  //@ type s real
  //@ type e real
  //@ ensures s === e ==> !\result
  //@ ensures s < e ==> \result === (h >= s && h < e)
  //@ ensures s > e ==> \result === (h >= s || h < e)
  if (s === e) return false;
  return s < e ? h >= s && h < e : h >= s || h < e;
}

// ------------------------------------------------------------------ trust
export type TrustLevel = "ok" | "watch" | "hold";
export const WATCH = 3;
export const HOLD = 6;
export const REPORT_POINTS = 3;

/** Hold is sticky: only a person lifts it (Trust.lift, not this step). */
export function nextLevel(prev: TrustLevel, score: number): TrustLevel {
  //@ verify
  //@ ensures prev === "hold" ==> \result === "hold"
  //@ ensures score >= HOLD ==> \result === "hold"
  //@ ensures \result === "ok" ==> score < WATCH
  //@ ensures \result === "watch" ==> score >= WATCH && score < HOLD
  return prev === "hold" || score >= HOLD ? "hold" : score >= WATCH ? "watch" : "ok";
}

/** One message from a clean record never reaches hold. */
export function abusePoints(score: number, risk: number): number {
  //@ verify
  //@ ensures score <= 0 && risk >= 0 ==> score + \result < HOLD
  //@ ensures score > 0 ==> \result === risk
  return score <= 0 ? Math.min(risk, HOLD - 1) : risk;
}

/** A staff hold always reaches hold, and adds at least a point. */
export function staffHoldPoints(score: number): number {
  //@ verify
  //@ ensures score + \result >= HOLD
  //@ ensures \result >= 1
  const need = Math.max(HOLD - score, 0);
  return need === 0 ? 1 : need;
}

/** A report weighs only from a credible reporter who met the target, once per reporter. */
export function reportCounts(credible: boolean, met: boolean, already: boolean): boolean {
  //@ verify
  //@ ensures \result <==> credible && met && !already
  return credible && met && !already;
}

/** Points need corroboration: a second distinct reporter, or a target already at risk. `reporters` includes this one. */
export function reportPoints(reporters: number, score: number): number {
  //@ verify
  //@ ensures \result === 0 || \result === REPORT_POINTS
  //@ ensures \result > 0 ==> reporters >= 2 || score > 0
  return reporters >= 2 || score > 0 ? REPORT_POINTS : 0;
}

/** Clean time pays the score down. A hold does not decay, and the score never goes below zero. */
export function decayedScore(level: TrustLevel, score: number, steps: number): number {
  //@ verify
  //@ requires steps >= 0
  //@ ensures level === "hold" ==> \result === score
  //@ ensures level !== "hold" && score > 0 ==> \result >= 0 && \result <= score
  if (level === "hold" || score <= 0) return score;
  return Math.max(0, score - steps);
}

// ------------------------------------------------------------------ relay
export type RelayStatus = "mutual" | "cancelled" | "closed" | "probing";
/** One member as the final relay dispatch sees them. `adultSure`: a known adult age and no doubt flag. */
export interface RelayPartyFacts { known: boolean; declined: boolean; adultSure: boolean; optedOut: boolean; held: boolean }
export interface RelayDispatchFacts { samePerson: boolean; pairOk: boolean; status: RelayStatus; bothAccepted: boolean; from: RelayPartyFacts; to: RelayPartyFacts; blocked: boolean }

/** A match is mutual only while scheduled or done. */
export function relayStatusOf(stage: Stage, closedFromScheduled: boolean): RelayStatus {
  //@ verify
  //@ ensures \result === "mutual" <==> stage === "scheduled" || stage === "done"
  //@ ensures \result === "probing" <==> stage === "review" || stage === "probing"
  if (stage === "scheduled" || stage === "done") return "mutual";
  if (stage === "closed") return closedFromScheduled ? "cancelled" : "closed";
  return "probing";
}

export function relayPartyVerdict(p: RelayPartyFacts): string {
  //@ verify
  //@ ensures \result === "ok" ==> p.known && !p.declined && p.adultSure && !p.optedOut && !p.held
  if (!p.known || p.declined) return "party:unknown";
  if (!p.adultSure) return "party:age";
  if (p.optedOut) return "party:opted_out";
  if (p.held) return "party:held";
  return "ok";
}

/** The last gate before a relayed item leaves: two different members, a mutual match both accepted, both clear, no block. */
export function relayDispatchVerdict(f: RelayDispatchFacts): string {
  //@ verify
  //@ ensures \result === "ok" ==> !f.samePerson && f.pairOk && f.status === "mutual" && f.bothAccepted && !f.blocked
  //@ ensures \result === "ok" ==> f.from.known && !f.from.declined && f.from.adultSure && !f.from.optedOut && !f.from.held
  //@ ensures \result === "ok" ==> f.to.known && !f.to.declined && f.to.adultSure && !f.to.optedOut && !f.to.held
  if (f.samePerson || !f.pairOk) return "relay:pair";
  if (f.status !== "mutual" || !f.bothAccepted) return "state:closed";
  const first = relayPartyVerdict(f.from);
  if (first !== "ok") return first;
  const second = relayPartyVerdict(f.to);
  if (second !== "ok") return second;
  return f.blocked ? "party:blocked" : "ok";
}

/** How many numbers a swap sends: both or none. Each pass and each preflight must hold before the first send. */
export function swapPlan(theirPass: boolean, myPass: boolean, canFirst: boolean, canSecond: boolean): number {
  //@ verify
  //@ ensures \result === 0 || \result === 2
  //@ ensures \result === 2 <==> theirPass && myPass && canFirst && canSecond
  if (!theirPass || !myPass || !canFirst || !canSecond) return 0;
  return 2;
}

export type HeldStatus = "held" | "released" | "rejected";
export type HeldAction = "release" | "reject";

/** A staff decision on a held item. Only a held item moves, and a decided item stays as it is. */
export function heldAfter(status: HeldStatus, a: HeldAction): HeldStatus {
  //@ verify
  //@ ensures status !== "held" ==> \result === status
  //@ ensures status === "held" ==> \result !== "held"
  //@ ensures status === "held" && a === "reject" ==> \result === "rejected"
  if (status !== "held") return status;
  return a === "reject" ? "rejected" : "released";
}

/** The text of an item stays only while it is held. */
export function keepsHeldText(status: HeldStatus): boolean {
  //@ verify
  //@ ensures \result <==> status === "held"
  return status === "held";
}

// ------------------------------------------------------------------ job posts
export type PostingAction = "skip" | "close" | "save";

/** What a confirmed draft does. A close never saves, and a save always has a title and a pay range. */
export function postingAction(hasId: boolean, close: boolean, hasPrev: boolean, hasTitle: boolean, hasPay: boolean): PostingAction {
  //@ verify
  //@ ensures \result === "save" ==> hasId && !close && hasTitle && hasPay
  //@ ensures \result === "close" ==> hasId && close && hasPrev
  //@ ensures close ==> \result !== "save"
  if (!hasId) return "skip";
  if (close) return hasPrev ? "close" : "skip";
  return hasTitle && hasPay ? "save" : "skip";
}

/** A pay range in thousands. Never a job without a real range. */
export function payRangeOk(payMin: number, payMax: number): boolean {
  //@ verify
  //@ type payMin real
  //@ type payMax real
  //@ ensures \result ==> payMin >= 10 && payMin <= payMax && payMax <= 999
  return payMin >= 10 && payMax >= payMin && payMax <= 999;
}
