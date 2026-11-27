import { evaluateArrivalRelaySafe, isMinor, MIN_MEMBER_AGE, type MemberId, type Owned } from "@thenetwork/core";
import { initial as initialRelay, step as stepRelay, type DeliveryResult, type RelayVerdict } from "../../core/src/generated/relayLifecycle.ts";
import { relayAgeStatementRead, relayAgeStatementRefuses, relaySevereBlockCaseEvent, relayStartsMinorPolicy, relayTarget, relayThreadOpen, type RelayTargetChoice } from "../../core/src/generated/relayDecision.ts";
import { relayNameCollisionRefuses, relayTextRecipientAllowed } from "../../core/src/generated/relayRequestAddress.ts";
import {
  relayGuard, relayItemAsync, relaySenderMinorSign, relaySenderNotice, RELAY_LIMITS, threadMessage,
  type RelayClassifierHook, type RelayContext, type RelayItem, type RelayOpportunity, type RelayParty, type RelayRecord, type RelayResult, type RelayThreadMessage,
} from "../../engine/src/relay.ts";
import { appearanceLeak } from "../../engine/src/packs/slop/appearance.ts";

export const RELAY_SWAP_TTL_MS = RELAY_LIMITS.consentTtlMs;
export const SWAP_WITHDRAWN = "consent:withdrawn";
export const RELAY_LOG_MAX = 5000;
export const RELAY_AMBIGUOUS_NAME = "You've matched with more than one person with that name, so I can't tell who you mean.";
const THREAD_MAX = 50;
const VERDICT = { block: "Block", pass: "Pass" } as const satisfies Record<RelayResult["decision"], RelayVerdict>;
const SEVERE_REASON_FAMILIES = new Set(["harass_severe", "clef_severe"]);
const DELIVERY_RESULT = { sent: "Delivered", deferred: "Queued", refused: "Refused" } as const satisfies Record<ReturnType<RelayHost["send"]>, DeliveryResult>;

export interface RelayMember {
  id: MemberId;
  firstName: string;
  age: number | undefined;
  optedOut: boolean;
  held: boolean;
  markedMinor: boolean;
}
export interface RelayMatch {
  id: string;
  participants: [MemberId, MemberId];
  acceptedBy: MemberId[];
  status: RelayOpportunity["status"];
  negativeFeedback: boolean;
  metAt?: number;
  at: number;
}
export interface RelayHost {
  app: string;
  now(): number;
  member(id: MemberId): RelayMember | undefined;
  matchesOf(id: MemberId): RelayMatch[];
  blocked(a: MemberId, b: MemberId): boolean;
  privateFacts(): { forbidden: Owned[]; canaries: string[] };
  ratesPhotos: boolean;
  observeSenderAge?(memberId: MemberId, text: string): boolean;
  send(to: MemberId, body: string, o: { from: MemberId; matchId: string; key: string; contact?: string; noDefer?: boolean }): "sent" | "deferred" | "refused";
  minorSignal(id: MemberId, saysYounger: boolean): void;
  saysYounger?(id: MemberId, text: string): boolean;
  severeBlock(id: MemberId): void;
  teenPair?(matchId: string): boolean;
  onPanicExit?(id: MemberId, matchIds: string[]): void;
  classifierFailed(itemId: string, error: string): void;
}

type RelayAskKind = Exclude<RelayItem["kind"], "photo">;
interface RelayTargetResult { choice: RelayTargetChoice | "RelayAmbiguousName"; match?: RelayMatch }
export interface RelayThreadState { id: string; app: string; members: [MemberId, MemberId]; openedAt: number; messages: RelayThreadMessage[] }
export interface RelaySwap { itemId: string; matchId: string; from: MemberId; to: MemberId; at: number }

export interface RelayPanicHalt { memberId: MemberId; matchId: string; at: number }

export { withdrawsRelaySwap as withdrawsSwap } from "../../engine/src/relay.ts";
export interface RelayState { threads: RelayThreadState[]; log: RelayRecord[]; swaps: RelaySwap[]; panics?: RelayPanicHalt[] }
export const emptyRelayState = (): RelayState => ({ threads: [], log: [], swaps: [] });

export interface RelayAsk {
  itemId: string;
  from: MemberId;
  kind: RelayAskKind;
  text?: string;
  targetName?: string;
  matchId?: string;
}
export interface RelayOutcome {
  itemId: string; decision: "sent" | "waiting" | "refused" | "unnamed"; reason: string; replayed?: boolean;
  delivered?: boolean;
}
export interface RelayCallOptions {
  hook: RelayClassifierHook;
  contactOf?: (id: MemberId) => string | undefined;
  canonical?: ReadonlyMap<MemberId, RelayCanonical>;
}
export interface RelayCanonical { adult: boolean; optedOut: boolean; held: boolean; teenReady?: boolean; birthKey?: number }

const foldRelayName = (name: string) => name.normalize("NFKC").replace(/[‘’]/g, "'").toLowerCase();
const counterpart = (match: RelayMatch, from: MemberId) => match.participants.find(id => id !== from)!;

const NOTICE = {
  whichMatch: "You have more than one match, so I didn't send that. Send it again and say who it's for.",
  matchClosed: "That match is closed, so I can't pass anything on to them.",
  noMatch: "I can only pass messages on to someone you've matched with, and you don't have an open match right now.",
  swapWait: "I'll share your number as soon as they say they want to swap numbers too.",
  swapAlready: "I already asked them; I'll share your number if they want to swap too.",
  textOnly: "I can only pass on messages for this match, not numbers or photos.",
  undelivered: "I couldn't pass that on right now.",
  swapFailed: "I can't swap numbers right now.",
  late: "I'll pass that on when it's a reasonable hour for them.",
  panicHalted: "Messaging for this meetup has been stopped.",
  panicExitConfirm: "Got it — I've stopped messaging for this meetup right away. If you're ever in danger, call 911 first.",
};
const SEND_REFUSED = "send:refused";
const undeliveredNotice = (kind: RelayItem["kind"]) => (kind === "contact_share" ? NOTICE.swapFailed : NOTICE.undelivered);
const swapAsk = (name: string) => `${name} would like to swap numbers with you. If you'd like that too, say "send them my number" in the next 15 minutes and I'll share both.`;
const SHARED_NUMBER = (name: string) => `${name || "They"} shared their number.`;

const AGE_STATED = "minor:self_stated";
interface RelayTeen { pair: boolean; younger: boolean; ageStated: boolean }
const NOT_TEEN: RelayTeen = { pair: false, younger: false, ageStated: false };

const bodyOf = (rendered: string | null) => (rendered ? /^.{1,40}? says: "([\s\S]*)"$/.exec(rendered)?.[1] : undefined);

export class RelayDesk {
  private s: RelayState = emptyRelayState();
  constructor(private readonly host: RelayHost) {}

  exportState(clone = true): RelayState {
    const base: RelayState = { threads: this.s.threads, log: this.s.log, swaps: this.s.swaps };
    if (this.s.panics?.length) base.panics = this.s.panics;
    return clone ? (JSON.parse(JSON.stringify(base)) as RelayState) : base;
  }
  importState(s: RelayState | undefined, clone = true) {
    const x = s ? (clone ? (JSON.parse(JSON.stringify(s)) as RelayState) : s) : emptyRelayState();
    this.s = {
      threads: x.threads ?? [],
      log: x.log ?? [],
      swaps: x.swaps ?? [],
      ...(x.panics?.length ? { panics: x.panics } : {}),
    };
  }

  isPanicTriggered(memberId: MemberId, matchId?: string): boolean {
    return (this.s.panics ?? []).some(
      p => p.memberId === memberId && (matchId === undefined || p.matchId === "*" || p.matchId === matchId)
    );
  }

  triggerPanicExit(memberId: MemberId, matchId?: string): { haltedMatches: string[]; cancelledSwaps: number; notice: string } {
    const now = this.host.now();
    const matches = this.host.matchesOf(memberId).filter(m => matchId === undefined || m.id === matchId);
    const targetIds = matches.length ? matches.map(m => m.id) : [matchId ?? "*"];
    const panics = (this.s.panics ??= []);
    for (const id of targetIds) {
      if (!panics.some(p => p.memberId === memberId && p.matchId === id)) {
        panics.push({ memberId, matchId: id, at: now });
      }
    }
    const before = this.s.swaps.length;
    this.s.swaps = this.s.swaps.filter(x => x.from !== memberId && x.to !== memberId);
    const cancelledSwaps = (before - this.s.swaps.length) + this.cancelSwaps(memberId);
    this.host.onPanicExit?.(memberId, targetIds);
    return { haltedMatches: targetIds, cancelledSwaps, notice: NOTICE.panicExitConfirm };
  }

  canRelayArrivalSafe(params: {
    matchId: string;
    senderId: MemberId;
    recipientId: MemberId;
    senderConfirmed: boolean;
    recipientConfirmed: boolean;
    anyMinorInEvent?: boolean;
    panicTriggered?: boolean;
    startMs: number;
    alreadyMet: boolean;
    passedSafetyAndLeakCheck: boolean;
  }): boolean {
    const sender = this.host.member(params.senderId);
    const recipient = this.host.member(params.recipientId);
    const panicTriggered =
      Boolean(params.panicTriggered) ||
      this.isPanicTriggered(params.senderId, params.matchId) ||
      this.isPanicTriggered(params.recipientId, params.matchId);
    const senderAge = sender?.markedMinor ? MIN_MEMBER_AGE : (sender?.age ?? 0);
    const recipientAge = recipient?.markedMinor ? MIN_MEMBER_AGE : (recipient?.age ?? 0);
    const anyMinorInEvent = Boolean(params.anyMinorInEvent) || isMinor(senderAge) || isMinor(recipientAge);
    return evaluateArrivalRelaySafe({
      senderAge,
      recipientAge,
      anyMinorInEvent,
      senderConfirmed: params.senderConfirmed,
      recipientConfirmed: params.recipientConfirmed,
      blocked: this.host.blocked(params.senderId, params.recipientId),
      panicTriggered,
      senderOptedOut: sender ? sender.optedOut || sender.held : true,
      recipientOptedOut: recipient ? recipient.optedOut || recipient.held : true,
      nowMs: this.host.now(),
      startMs: params.startMs,
      alreadyMet: params.alreadyMet,
      passedSafetyAndLeakCheck: params.passedSafetyAndLeakCheck,
    });
  }

  liveMatches(from: MemberId): RelayMatch[] {
    return this.host.matchesOf(from).filter(m => relayThreadOpen(m.status === "mutual", m.participants.every(p => m.acceptedBy.includes(p)), m.negativeFeedback))
      .sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
  }

  matchFor(from: MemberId, matchId?: string, targetName?: string): RelayTargetResult {
    const live = this.liveMatches(from);
    const selected = matchId !== undefined;
    const candidate = selected ? live.find(m => m.id === matchId) : live[0];
    let liveCount = live.length;
    if (targetName !== undefined && candidate) {
      const name = foldRelayName(targetName);
      const recipient = counterpart(candidate, from);
      const firstName = this.host.member(recipient)?.firstName;
      if (!relayTextRecipientAllowed(true, firstName !== undefined && foldRelayName(firstName) === name)) return { choice: "RelayToNoMatch" };
      if (!selected) {
        const people = new Set(live.map(match => counterpart(match, from)));
        const otherHasName = [...people].some(id => id !== recipient && foldRelayName(this.host.member(id)?.firstName ?? "") === name);
        if (relayNameCollisionRefuses(selected, otherHasName)) return { choice: "RelayAmbiguousName" };
        // A name can select the newest match only when all of the live matches refer to the same person.
        liveCount = people.size;
      }
    }
    const choice = relayTarget(liveCount, selected, candidate !== undefined);
    const match = choice === "RelayToNamedMatch" || choice === "RelayToOnlyMatch" ? candidate : undefined;
    return match ? { choice, match } : { choice };
  }

  async request(ask: RelayAsk, o: RelayCallOptions): Promise<RelayOutcome> {
    const prior = this.prior(ask.itemId);
    if (prior) return { ...prior, replayed: true };
    const { choice, match } = this.matchFor(ask.from, ask.matchId, ask.targetName);
    if (choice === "RelayAskWhichMatch") return { itemId: ask.itemId, decision: "unnamed", reason: NOTICE.whichMatch };
    if (choice === "RelayAmbiguousName") return { itemId: ask.itemId, decision: "refused", reason: RELAY_AMBIGUOUS_NAME };
    if (!match) return { itemId: ask.itemId, decision: "refused", reason: choice === "RelayNamedNotLive" ? NOTICE.matchClosed : NOTICE.noMatch };
    const to = counterpart(match, ask.from);
    if (this.isPanicTriggered(ask.from, match.id) || this.isPanicTriggered(to, match.id)) {
      return { itemId: ask.itemId, decision: "refused", reason: NOTICE.panicHalted };
    }
    const now = this.host.now();
    const pair = this.host.teenPair?.(match.id) === true;
    if (ask.kind !== "text" && pair) return { itemId: ask.itemId, decision: "refused", reason: NOTICE.textOnly };
    if (ask.kind === "contact_share") return this.swap(ask, match, to, now, o);
    const text = (ask.text ?? "").trim();
    const item: RelayItem = { id: ask.itemId, kind: "text", from: ask.from, to, at: now, text };
    const younger = text !== "" && this.host.saysYounger?.(item.from, text) === true;
    const observed = relayAgeStatementRead(text !== "", pair, younger) && this.host.observeSenderAge?.(item.from, text) === true;
    const ageStated = relayAgeStatementRefuses(observed, pair, this.host.member(item.from)?.markedMinor !== false);
    const teen: RelayTeen = { pair, younger, ageStated };
    return this.apply(await this.decide(item, match, o, teen), match, item, undefined, younger || ageStated, younger);
  }

  private async decide(item: RelayItem, match: RelayMatch, o: RelayCallOptions, teen: RelayTeen = NOT_TEEN): Promise<RelayResult> {
    const res = await relayItemAsync(item, this.context(item, match, o, teen), { hook: o.hook });
    if (res.classifierError !== undefined) this.host.classifierFailed(item.id, res.classifierError);
    return teen.ageStated ? { ...res, record: { ...res.record, ageSignal: true } } : res;
  }

  private context(item: RelayItem, match: RelayMatch, o: RelayCallOptions, teen: RelayTeen): RelayContext {
    const party = (id: MemberId): RelayParty => {
      const m = this.host.member(id), c = o.canonical?.get(id);
      const strict = o.canonical !== undefined;
      return {
        id, firstName: m?.firstName ?? "", age: strict && !c?.adult ? undefined : m?.age,
        optedOut: (m ? m.optedOut : true) || (strict && (!c || c.optedOut)), held: (m?.held ?? false) || (strict && (!c || c.held)),
      };
    };
    const thread = this.thread(match.id);
    const mine = (thread?.messages ?? []).filter(x => x.from === item.from && x.kind === "text").map(x => bodyOf(x.rendered)).filter((x): x is string => !!x).slice(-3);
    const facts = this.host.privateFacts();
    const teenPair = item.kind === "text" && teen.pair && (o.canonical === undefined || match.participants.every(p => o.canonical?.get(p)?.teenReady === true));
    return {
      ...(teenPair ? { teenFriendPair: true } : {}),
      now: item.at,
      opportunity: { id: match.id, app: this.host.app, participants: match.participants, acceptedBy: match.acceptedBy, status: match.status, ...(match.metAt !== undefined ? { metAt: match.metAt } : {}) },
      sender: party(item.from), recipient: party(item.to),
      blocked: this.host.blocked(item.from, item.to),
      history: this.s.log.filter(r => r.opportunityId === match.id),
      recentTexts: mine,
      thread: (thread?.messages ?? []).map(x => x.rendered).filter((x): x is string => !!x).slice(-4),
      guard: relayGuard({ forbidden: facts.forbidden, facts: facts.forbidden.filter(f => (typeof f === "string" ? f : f.text).trim().split(/\s+/).length >= 2), canaries: facts.canaries }),
      ...(this.host.ratesPhotos || teenPair || teen.ageStated ? { extraRules: (t: string) => [
        ...(this.host.ratesPhotos && appearanceLeak(t) ? ["rating:appearance"] : []),
        ...(teenPair && teen.younger ? ["teen:age_talk"] : []),
        ...(teen.ageStated ? [AGE_STATED] : []),
      ] } : {}),
    };
  }

  private apply(res: RelayResult, match: RelayMatch, item: RelayItem, contact?: string, statedAge = false, saysYounger = false): RelayOutcome {
    const senderSign = res.record.ageSignal && !!item.text && relaySenderMinorSign(item.text);
    this.log(res.record);
    if (relayStartsMinorPolicy(statedAge, senderSign, res.classifierAgeSignal === true, this.host.member(item.from)?.markedMinor ?? false)) this.host.minorSignal(item.from, saysYounger);
    if (relaySevereBlockCaseEvent(VERDICT[res.decision], res.reasons.some(r => SEVERE_REASON_FAMILIES.has(r.split(":")[0]!)))) this.host.severeBlock(item.from);
    const decision = stepRelay(initialRelay, { type: "recordVerdict", verdict: VERDICT[res.decision] });
    if (decision.phase !== "ReadyToSend") return { itemId: item.id, decision: "refused", reason: res.senderNotice };

    const sent = this.deliver(res, match, item, contact);
    const delivery = stepRelay(decision, { type: "recordDelivery", delivery: DELIVERY_RESULT[sent] });
    if (delivery.phase === "SendRefused") { this.undelivered(res.record); return { itemId: item.id, decision: "refused", reason: undeliveredNotice(item.kind) }; }
    return { itemId: item.id, decision: "sent", reason: delivery.phase === "Deferred" ? NOTICE.late : res.senderNotice };
  }

  private undelivered(r: RelayRecord) {
    this.log({ ...r, decision: "block", contactShared: false, reasons: [...new Set([...r.reasons, SEND_REFUSED])].sort() });
  }

  private deliver(res: RelayResult, match: RelayMatch, item: RelayItem, contact?: string): "sent" | "deferred" | "refused" {
    const sent = this.host.send(item.to, res.rendered, { from: item.from, matchId: match.id, key: `relay:${item.id}`, ...(contact ? { contact } : {}) });
    if (sent === "refused") return sent;
    const t = this.openThread(match);
    const msg = threadMessage(res);
    if (item.kind === "contact_share") msg.rendered = SHARED_NUMBER((this.host.member(item.from)?.firstName ?? "").trim().split(/\s+/)[0] ?? "");
    t.messages.push(msg);
    if (t.messages.length > THREAD_MAX) t.messages.splice(0, t.messages.length - THREAD_MAX);
    return sent;
  }

  private async swap(ask: RelayAsk, match: RelayMatch, to: MemberId, now: number, o: RelayCallOptions): Promise<RelayOutcome> {
    this.s.swaps = this.s.swaps.filter(x => now - x.at <= RELAY_SWAP_TTL_MS && x.at <= now);
    const mineValue = o.contactOf?.(ask.from);
    if (!mineValue) return { itemId: ask.itemId, decision: "refused", reason: "I can't share your number right now." };
    const theirs = this.s.swaps.find(x => x.matchId === match.id && x.from === to && x.to === ask.from);
    if (!theirs) {
      if (this.s.swaps.some(x => x.matchId === match.id && x.from === ask.from)) return { itemId: ask.itemId, decision: "waiting", reason: NOTICE.swapAlready };
      const probe = await this.decide(this.share(ask.itemId, ask.from, to, now, mineValue), match, o);
      if (probe.decision !== "pass") return this.apply(probe, match, this.share(ask.itemId, ask.from, to, now, mineValue));
      const name = this.host.member(ask.from)?.firstName ?? "Your match";
      if (this.host.send(to, swapAsk(name), { from: ask.from, matchId: match.id, key: `relay:${ask.itemId}:ask`, noDefer: true }) !== "sent") {
        return { itemId: ask.itemId, decision: "refused", reason: NOTICE.swapFailed };
      }
      this.s.swaps.push({ itemId: ask.itemId, matchId: match.id, from: ask.from, to, at: now });
      return { itemId: ask.itemId, decision: "waiting", reason: NOTICE.swapWait };
    }
    const theirValue = o.contactOf?.(to);
    if (!theirValue) return { itemId: ask.itemId, decision: "refused", reason: NOTICE.swapFailed };
    this.s.swaps = this.s.swaps.filter(x => x !== theirs);
    const theirItem = this.share(theirs.itemId, to, ask.from, now, theirValue, theirs.at), myItem = this.share(ask.itemId, ask.from, to, now, mineValue);
    const theirRes = await this.decide(theirItem, match, o), myRes = await this.decide(myItem, match, o);
    if (theirRes.decision === "pass" && myRes.decision === "pass") {
      const first = this.apply(theirRes, match, theirItem, theirValue);
      if (first.decision !== "sent") {
        this.undelivered(myRes.record);
        return { itemId: ask.itemId, decision: "refused", reason: NOTICE.swapFailed };
      }
      return this.apply(myRes, match, myItem, mineValue);
    }
    if (theirRes.decision !== "pass") this.apply(theirRes, match, theirItem);
    if (myRes.decision !== "pass") return this.apply(myRes, match, myItem);
    this.undelivered(myRes.record);
    return { itemId: ask.itemId, decision: "refused", reason: NOTICE.swapFailed };
  }

  cancelSwaps(from: MemberId): number {
    const before = this.s.swaps.length;
    this.s.swaps = this.s.swaps.filter(x => x.from !== from);
    let changed = before - this.s.swaps.length;
    this.s.log = this.s.log.map(record => {
      if (record.kind !== "contact_share" || record.decision !== "pass" || (record.from !== from && record.to !== from) || record.reasons.includes(SWAP_WITHDRAWN)) return record;
      changed++;
      return { ...record, reasons: [...record.reasons, SWAP_WITHDRAWN].sort() };
    });
    return changed;
  }

  private share(id: string, from: MemberId, to: MemberId, at: number, value: string, consentAt = at): RelayItem {
    return { id, kind: "contact_share", from, to, at, contact: { kind: "phone", value }, consent: { kind: "contact_share", by: from, itemId: id, at: consentAt } };
  }

  private prior(itemId: string): Omit<RelayOutcome, "replayed"> | undefined {
    const r = this.s.log.find(x => x.itemId === itemId);
    if (r) return { itemId, decision: r.decision === "pass" ? "sent" : "refused", delivered: r.decision === "pass", reason: r.reasons.includes(SEND_REFUSED) ? undeliveredNotice(r.kind) : relaySenderNotice(r.decision === "pass" ? [] : r.reasons) };
    if (this.s.swaps.some(x => x.itemId === itemId)) return { itemId, decision: "waiting", reason: NOTICE.swapWait };
    return undefined;
  }

  private log(r: RelayRecord) {
    const i = this.s.log.findIndex(x => x.itemId === r.itemId);
    if (i >= 0) this.s.log[i] = r; else this.s.log.push(r);
    if (this.s.log.length > RELAY_LOG_MAX) this.s.log.splice(0, this.s.log.length - RELAY_LOG_MAX);
  }
  private thread(id: string) { return this.s.threads.find(t => t.id === id); }
  private openThread(m: RelayMatch): RelayThreadState {
    let t = this.thread(m.id);
    if (!t) { t = { id: m.id, app: this.host.app, members: [...m.participants] as [MemberId, MemberId], openedAt: this.host.now(), messages: [] }; this.s.threads.push(t); }
    return t;
  }

  records(): RelayRecord[] { return this.s.log.map(r => ({ ...r, reasons: [...r.reasons] })); }
  contactShareFrom(outboundId: string): MemberId | undefined {
    if (!outboundId.startsWith("relay:")) return undefined;
    const r = this.s.log.find(x => x.itemId === outboundId.slice(6));
    return r && r.kind === "contact_share" && r.decision === "pass" && r.contactShared ? r.from : undefined;
  }
  senderOf(outboundId: string): MemberId | undefined {
    if (!outboundId.startsWith("relay:")) return undefined;
    const r = this.s.log.find(x => x.itemId === outboundId.slice(6));
    return r && r.decision === "pass" ? r.from : undefined;
  }
  threads(): RelayThreadState[] { return this.exportState().threads; }

  forget(id: MemberId) {
    this.s.swaps = this.s.swaps.filter(x => x.from !== id && x.to !== id);
    this.s.panics = (this.s.panics ?? []).filter(p => p.memberId !== id);
    for (const t of this.s.threads) if (t.members.includes(id)) t.messages = [];
  }
}

export function checkArrivalRelaySafety(input: Parameters<typeof evaluateArrivalRelaySafe>[0]): boolean {
  return evaluateArrivalRelaySafe(input);
}
