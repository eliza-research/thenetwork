import type { MemberId, Owned } from "@thenetwork/core";
import { initial as initialRelay, step as stepRelay, storedHold, type DeliveryResult, type RelayVerdict } from "../../core/src/generated/relayLifecycle.ts";
import { relaySevereBlockCaseEvent, relayStartsMinorPolicy, relayTarget, relayThreadOpen, type RelayTargetChoice } from "../../core/src/generated/relayDecision.ts";
import type { ApprovedRelayPhoto } from "../../core/src/svc/contract.ts";
import {
  relayGuard, relayItem, relayItemAsync, RELAY_LIMITS, RELAY_WORDING, threadMessage,
  type RelayClassifierHook, type RelayContext, type RelayItem, type RelayOpportunity, type RelayParty, type RelayRecord, type RelayResult, type RelayThreadMessage,
} from "../../engine/src/relay.ts";
import { appearanceLeak } from "../../engine/src/packs/slop/appearance.ts";

const HOUR = 3_600_000, DAY = 24 * HOUR;
export const RELAY_SWAP_TTL_MS = RELAY_LIMITS.consentTtlMs;
export const RELAY_LOG_MAX = 5000;
const THREAD_MAX = 50;
const VERDICT = { block: "Block", hold: "Hold", pass: "Pass" } as const satisfies Record<RelayResult["decision"], RelayVerdict>;
const SEVERE_REASON_FAMILIES = new Set(["harass_severe", "llm_severe", "clef_severe"]);
const CLASSIFIER_REASON_FAMILIES = new Set(["llm", "clef", "llm_severe", "clef_severe"]);
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
  reviewWindowMs: number;
  send(to: MemberId, body: string, o: { from: MemberId; matchId: string; key: string; contact?: string; photoIds?: string[]; approvedPhotos?: ApprovedRelayPhoto[] }): "sent" | "deferred" | "refused";
  minorSignal(id: MemberId): void;
  severeBlock(id: MemberId): void;
}

export interface RelayHeld {
  itemId: string; matchId: string; app: string; kind: RelayItem["kind"]; from: MemberId; to: MemberId; at: number;
  reasons: string[];
  text?: string;
  textHidden?: "minor";
  photoIds?: string[];
  status: "held" | "released" | "rejected" | "expired";
  decidedBy?: string; decidedAt?: number;
}
export type RelayHeldItem = RelayHeld & { deadline: number };
export interface RelayHoldExpired { itemId: string; matchId: string; from: MemberId; notice: string }
export interface RelayTargetResult { choice: RelayTargetChoice; match?: RelayMatch }
export interface RelayThreadState { id: string; app: string; members: [MemberId, MemberId]; openedAt: number; messages: RelayThreadMessage[] }
export interface RelaySwap { itemId: string; matchId: string; from: MemberId; to: MemberId; at: number }

const NOT_A_NO = /\b(?:don'?t|dont|do not) (?:mind|care|wait|worry)\b|\bstop asking\b|\bnever had\b|\bno (?:problem|worries|prob|rush|hurry)\b|\bnot a problem\b/g;
export function withdrawsSwap(text: string): boolean {
  const t = text.replace(/[\u2019\u2018`\u00b4]/g, "'").toLowerCase().replace(NOT_A_NO, " ");
  return /\b(?:no|not|don'?t|dont|do not|never|stop|cancel|hold off|rather|keep|changed my mind|never ?mind|nvm|take back|scratch)\b/.test(t)
    && /\b(?:my (?:phone number|number|phone|digits|cell|contact(?: info)?)|(?:number|numbers) swap|(?:the|that|our) swap|swap(?:ping)? numbers)\b/.test(t);
}
export interface RelayState { threads: RelayThreadState[]; log: RelayRecord[]; held: RelayHeld[]; swaps: RelaySwap[] }
export const emptyRelayState = (): RelayState => ({ threads: [], log: [], held: [], swaps: [] });

export interface RelayAsk {
  itemId: string;
  from: MemberId;
  kind: RelayItem["kind"];
  text?: string;
  photoIds?: string[];
  matchId?: string;
}
export interface RelayOutcome {
  itemId: string; decision: "sent" | "held" | "refused" | "unnamed"; reason: string; replayed?: boolean;
  delivered?: boolean;
}
export interface RelayCallOptions {
  hook?: RelayClassifierHook;
  contactOf?: (id: MemberId) => string | undefined;
  photos?: { ids: string[]; showConsent: boolean; approved?: ApprovedRelayPhoto[] };
  canonical?: ReadonlyMap<MemberId, RelayCanonical>;
}
export interface RelayCanonical { adult: boolean; optedOut: boolean; held: boolean }

const NOTICE = {
  whichMatch: "You have more than one match, so I didn't send that. Send it again and say who it's for.",
  matchClosed: "That match is closed, so I can't pass anything on to them.",
  holdExpired: "I couldn't check what you asked me to pass on to your match in time, so I didn't send it. You can send it again.",
  noMatch: "I can only pass messages on to someone you've matched with, and you don't have an open match right now.",
  swapWait: "I'll share your number as soon as they say they want to swap numbers too.",
  swapAlready: "I already asked them; I'll share your number if they want to swap too.",
  photoOff: "I can't send photos to a match yet.",
  undelivered: "I couldn't pass that on right now.",
  late: "I'll pass that on when it's a reasonable hour for them.",
};
const swapAsk = (name: string) => `${name} would like to swap numbers with you. If you'd like that too, say "send them my number" in the next 15 minutes and I'll share both.`;
const SHARED_NUMBER = (name: string) => `${name || "They"} shared their number.`;

const bodyOf = (rendered: string | null) => (rendered ? /^.{1,40}? says: "([\s\S]*)"$/.exec(rendered)?.[1] : undefined);

export class RelayDesk {
  private s: RelayState = emptyRelayState();
  constructor(private readonly host: RelayHost) {}

  exportState(): RelayState { return JSON.parse(JSON.stringify(this.s)) as RelayState; }
  importState(s: RelayState | undefined) {
    const x = s ? (JSON.parse(JSON.stringify(s)) as RelayState) : emptyRelayState();
    this.s = { threads: x.threads ?? [], log: x.log ?? [], held: x.held ?? [], swaps: x.swaps ?? [] };
  }

  liveMatches(from: MemberId): RelayMatch[] {
    return this.host.matchesOf(from).filter(m => relayThreadOpen(m.status === "mutual", m.participants.every(p => m.acceptedBy.includes(p)), m.negativeFeedback))
      .sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
  }

  matchFor(from: MemberId, matchId?: string): RelayTargetResult {
    const live = this.liveMatches(from), named = matchId === undefined ? undefined : live.find(m => m.id === matchId);
    const choice = relayTarget(live.length, matchId !== undefined, named !== undefined);
    const match = choice === "RelayToNamedMatch" ? named : choice === "RelayToOnlyMatch" ? live[0] : undefined;
    return match ? { choice, match } : { choice };
  }

  async request(ask: RelayAsk, o: RelayCallOptions = {}): Promise<RelayOutcome> {
    const prior = this.prior(ask.itemId);
    if (prior) return { ...prior, replayed: true };
    const { choice, match } = this.matchFor(ask.from, ask.matchId);
    if (choice === "RelayAskWhichMatch") return { itemId: ask.itemId, decision: "unnamed", reason: NOTICE.whichMatch };
    if (!match) return { itemId: ask.itemId, decision: "refused", reason: choice === "RelayNamedNotLive" ? NOTICE.matchClosed : NOTICE.noMatch };
    const to = match.participants.find(p => p !== ask.from)!;
    const now = this.host.now();
    if (ask.kind === "contact_share") return this.swap(ask, match, to, now, o);
    const item: RelayItem = ask.kind === "photo"
      ? { id: ask.itemId, kind: "photo", from: ask.from, to, at: now, photoIds: [...new Set(ask.photoIds ?? [])], ...(ask.text?.trim() ? { text: ask.text.trim() } : {}),
          consent: { kind: "photo", by: ask.from, itemId: ask.itemId, at: now, photoIds: [...new Set(ask.photoIds ?? [])] } }
      : { id: ask.itemId, kind: "text", from: ask.from, to, at: now, text: (ask.text ?? "").trim() };
    const res = await this.decide(item, match, o);
    const out = this.apply(res, match, item, o);
    if (ask.kind === "photo" && res.reasons.includes("photo:no_consent")) return { ...out, reason: NOTICE.photoOff };
    return out;
  }

  private async decide(item: RelayItem, match: RelayMatch, o: RelayCallOptions, at = item.at): Promise<RelayResult> {
    const ctx = this.context(item, match, o, at);
    return o.hook ? relayItemAsync(item, ctx, { hook: o.hook }) : relayItem(item, ctx);
  }

  private context(item: RelayItem, match: RelayMatch, o: RelayCallOptions, now: number): RelayContext {
    const party = (id: MemberId): RelayParty => {
      const m = this.host.member(id), c = o.canonical?.get(id);
      const strict = o.canonical !== undefined;
      return {
        id, firstName: m?.firstName ?? "", age: strict && !c?.adult ? undefined : m?.age,
        optedOut: (m ? m.optedOut : true) || (strict && (!c || c.optedOut)), held: (m?.held ?? false) || (strict && (!c || c.held)),
        ...(id === item.from && o.photos ? { photoIds: o.photos.ids, photoConsent: o.photos.showConsent } : {}),
      };
    };
    const thread = this.thread(match.id);
    const mine = (thread?.messages ?? []).filter(x => x.from === item.from && x.kind === "text").map(x => bodyOf(x.rendered)).filter((x): x is string => !!x).slice(-3);
    const facts = this.host.privateFacts();
    return {
      now,
      opportunity: { id: match.id, app: this.host.app, participants: match.participants, acceptedBy: match.acceptedBy, status: match.status, ...(match.metAt !== undefined ? { metAt: match.metAt } : {}) },
      sender: party(item.from), recipient: party(item.to),
      blocked: this.host.blocked(item.from, item.to),
      history: this.s.log.filter(r => r.opportunityId === match.id),
      recentTexts: mine,
      thread: (thread?.messages ?? []).map(x => x.rendered).filter((x): x is string => !!x).slice(-4),
      guard: relayGuard({ forbidden: facts.forbidden, facts: facts.forbidden.filter(f => (typeof f === "string" ? f : f.text).trim().split(/\s+/).length >= 2), canaries: facts.canaries }),
      ...(this.host.ratesPhotos ? { extraRules: (t: string) => (appearanceLeak(t) ? ["rating:appearance"] : []) } : {}),
    };
  }

  private apply(res: RelayResult, match: RelayMatch, item: RelayItem, o: RelayCallOptions, contact?: string): RelayOutcome {
    const ageSignal = res.record.ageSignal || res.reasons.some(r => { const [family, code] = r.split(":"); return CLASSIFIER_REASON_FAMILIES.has(family!) && code === "minor_signal"; });
    this.log({ ...res.record, ageSignal });
    if (relayStartsMinorPolicy(ageSignal, this.host.member(item.from)?.markedMinor ?? false)) this.host.minorSignal(item.from);
    if (relaySevereBlockCaseEvent(VERDICT[res.decision], res.reasons.some(r => SEVERE_REASON_FAMILIES.has(r.split(":")[0]!)))) this.host.severeBlock(item.from);
    const decision = stepRelay(initialRelay, {
      type: "recordVerdict", verdict: VERDICT[res.decision],
      rateOnly: res.decision === "hold" && res.reasons.every(r => r.startsWith("rate:") || r === "rate"),
      hasText: !!item.text, ageSignal,
    });
    if (decision.phase === "Blocked") return { itemId: item.id, decision: "refused", reason: res.senderNotice };
    if (decision.phase === "Held") this.s.held.push({
      itemId: item.id, matchId: match.id, app: this.host.app, kind: item.kind, from: item.from, to: item.to, at: item.at, reasons: res.reasons, status: "held",
      ...(decision.retainsText ? { text: item.text } : {}), ...(item.photoIds?.length ? { photoIds: [...item.photoIds] } : {}),
    });
    if (decision.phase !== "ReadyToSend") return { itemId: item.id, decision: "held", reason: res.senderNotice };

    const sent = this.deliver(res, match, item, o, contact);
    const delivery = stepRelay(decision, { type: "recordDelivery", delivery: DELIVERY_RESULT[sent], policyPermits: res.decision === "pass" });
    if (delivery.phase === "SendRefused") { this.undelivered(res.record); return { itemId: item.id, decision: "refused", reason: NOTICE.undelivered }; }
    return { itemId: item.id, decision: "sent", reason: delivery.phase === "Deferred" ? NOTICE.late : res.senderNotice };
  }

  private undelivered(r: RelayRecord) {
    this.log({ ...r, decision: "block", contactShared: false, reasons: [...new Set([...r.reasons, "send:refused"])].sort() });
  }

  private deliver(res: RelayResult, match: RelayMatch, item: RelayItem, o: RelayCallOptions, contact?: string): "sent" | "deferred" | "refused" {
    const sent = this.host.send(item.to, res.rendered, { from: item.from, matchId: match.id, key: `relay:${item.id}`, ...(contact ? { contact } : {}), ...(res.photos?.length ? { photoIds: res.photos, approvedPhotos: o.photos?.approved } : {}) });
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
      if (this.s.swaps.some(x => x.matchId === match.id && x.from === ask.from)) return { itemId: ask.itemId, decision: "held", reason: NOTICE.swapAlready };
      const probe = await this.decide(this.share(ask.itemId, ask.from, to, now, mineValue), match, o);
      if (probe.decision !== "pass") return this.apply(probe, match, this.share(ask.itemId, ask.from, to, now, mineValue), o);
      this.s.swaps.push({ itemId: ask.itemId, matchId: match.id, from: ask.from, to, at: now });
      const name = this.host.member(ask.from)?.firstName ?? "Your match";
      this.host.send(to, swapAsk(name), { from: ask.from, matchId: match.id, key: `relay:${ask.itemId}:ask` });
      return { itemId: ask.itemId, decision: "held", reason: NOTICE.swapWait };
    }
    const theirValue = o.contactOf?.(to);
    if (!theirValue) return { itemId: ask.itemId, decision: "refused", reason: "I can't swap numbers right now." };
    this.s.swaps = this.s.swaps.filter(x => x !== theirs);
    const theirItem = this.share(theirs.itemId, to, ask.from, now, theirValue, theirs.at), myItem = this.share(ask.itemId, ask.from, to, now, mineValue);
    const theirRes = await this.decide(theirItem, match, o), myRes = await this.decide(myItem, match, o);
    if (theirRes.decision === "pass" && myRes.decision === "pass") {
      const first = this.apply(theirRes, match, theirItem, o, theirValue);
      if (first.decision !== "sent") {
        this.undelivered(myRes.record);
        return { itemId: ask.itemId, decision: "refused", reason: "I can't swap numbers right now." };
      }
      return this.apply(myRes, match, myItem, o, mineValue);
    }
    if (theirRes.decision !== "pass") this.apply(theirRes, match, theirItem, o);
    if (myRes.decision !== "pass") return this.apply(myRes, match, myItem, o);
    this.undelivered(myRes.record);
    return { itemId: ask.itemId, decision: "refused", reason: "I can't swap numbers right now." };
  }

  cancelSwaps(from: MemberId): number {
    const before = this.s.swaps.length;
    this.s.swaps = this.s.swaps.filter(x => x.from !== from);
    return before - this.s.swaps.length;
  }

  private share(id: string, from: MemberId, to: MemberId, at: number, value: string, consentAt = at): RelayItem {
    return { id, kind: "contact_share", from, to, at, contact: { kind: "phone", value }, consent: { kind: "contact_share", by: from, itemId: id, at: consentAt } };
  }

  private prior(itemId: string): Omit<RelayOutcome, "replayed"> | undefined {
    const r = this.s.log.find(x => x.itemId === itemId);
    if (r) return { itemId, decision: r.decision === "pass" ? "sent" : r.decision === "hold" ? "held" : "refused", delivered: r.decision === "pass", reason: r.decision === "pass" ? "Sent." : r.decision === "hold" ? "I'm holding that one for a quick check before I pass it on." : "I can't pass that on." };
    if (this.s.swaps.some(x => x.itemId === itemId)) return { itemId, decision: "held", reason: NOTICE.swapWait };
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

  held(): RelayHeldItem[] { return this.s.held.filter(h => h.status === "held").map(h => ({ ...h, reasons: [...h.reasons], deadline: this.deadline(h) })); }
  private deadline(h: RelayHeld): number { return h.at + this.host.reviewWindowMs; }

  release(itemId: string, actor: string, o: RelayCallOptions = {}): { ok: true; delivered: boolean } | { ok: false; reason: string } {
    const h = this.s.held.find(x => x.itemId === itemId && x.status === "held");
    if (!h) return { ok: false, reason: "not_held" };
    const decided = () => this.decideHold(h, actor, true);
    const match = this.liveMatches(h.from).find(m => m.id === h.matchId);
    const item: RelayItem | undefined = h.kind === "photo"
      ? { id: h.itemId, kind: "photo", from: h.from, to: h.to, at: h.at, photoIds: h.photoIds ?? [], ...(h.text ? { text: h.text } : {}), consent: { kind: "photo", by: h.from, itemId: h.itemId, at: h.at, photoIds: h.photoIds ?? [] } }
      : h.kind === "text" && h.text ? { id: h.itemId, kind: "text", from: h.from, to: h.to, at: h.at, text: h.text } : undefined;
    if (!match || !item) { decided(); return { ok: true, delivered: false }; }
    const again = relayItem(item, this.context(item, match, o, h.at));
    const first = (this.host.member(h.from)?.firstName ?? "").trim().split(/\s+/)[0] || "Your match";
    const rendered = again.decision === "pass" ? again.rendered : again.decision === "hold" && item.kind === "text" ? RELAY_WORDING.text(first, item.text!) : "";
    const released = decided();
    if (!rendered) return { ok: true, delivered: false };
    const res: RelayResult = { ...again, decision: "pass", rendered, photos: again.photos, record: { ...again.record, decision: "pass", reasons: [...again.record.reasons, "staff:released"].sort() } };
    const sent = this.deliver(res, match, item, o);
    const result = stepRelay(released, { type: "recordDelivery", delivery: DELIVERY_RESULT[sent], policyPermits: rendered !== "" });
    const delivered = result.phase === "Sent" || result.phase === "Deferred";
    if (delivered) this.log(res.record);
    return { ok: true, delivered };
  }

  reject(itemId: string, actor: string): { ok: true } | { ok: false; reason: string } {
    const h = this.s.held.find(x => x.itemId === itemId && x.status === "held");
    if (!h) return { ok: false, reason: "not_held" };
    this.decideHold(h, actor, false);
    const r = this.s.log.find(x => x.itemId === itemId);
    if (r) this.log({ ...r, reasons: [...new Set([...r.reasons, "staff:rejected"])].sort() });
    return { ok: true };
  }

  private decideHold(h: RelayHeld, actor: string, released: boolean) {
    const result = stepRelay({ ...storedHold, retainsText: !!h.text }, { type: "reviewHold", released });
    h.status = result.phase === "Released" ? "released" : "rejected";
    h.decidedBy = actor;
    h.decidedAt = this.host.now();
    if (!result.retainsText) delete h.text;
    return result;
  }

  expireHolds(now: number): RelayHoldExpired[] {
    const out: RelayHoldExpired[] = [];
    for (const h of this.s.held) {
      if (h.status !== "held") continue;
      const result = stepRelay({ ...storedHold, retainsText: !!h.text }, { type: "expireHold", now, deadline: this.deadline(h) });
      if (result.phase !== "Expired") continue;
      h.status = "expired";
      h.decidedBy = "system:expired";
      h.decidedAt = now;
      if (!result.retainsText) delete h.text;
      const r = this.s.log.find(x => x.itemId === h.itemId);
      if (r) this.log({ ...r, reasons: [...new Set([...r.reasons, "review:expired"])].sort() });
      out.push({ itemId: h.itemId, matchId: h.matchId, from: h.from, notice: NOTICE.holdExpired });
    }
    return out;
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
    for (const h of this.s.held) if ((h.from === id || h.to === id) && h.status === "held") this.decideHold(h, "system:forget", false);
    this.s.swaps = this.s.swaps.filter(x => x.from !== id && x.to !== id);
    for (const t of this.s.threads) if (t.members.includes(id)) t.messages = [];
  }

  prune(now: number) {
    this.s.held = this.s.held.filter(h => h.status === "held" || now - (h.decidedAt ?? h.at) < 30 * DAY);
  }
}
