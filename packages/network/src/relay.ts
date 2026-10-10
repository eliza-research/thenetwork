// Relay between matched members (PRD 40.5; founder decision 9; AGENTS.md "Relay (#7)"). After a
// mutual yes the two members never talk directly: every item one of them wants the other to get (a
// text, "send them my number", a photo) goes through the RelayDesk, which asks the engine relay policy
// (packages/engine/src/relay.ts `relayItemAsync`) for the decision and keeps the platform's side:
//  - The engine decides. Parties (adults only, no block, no opt-out, no safety hold), the match state,
//    per-item consent, photo items, the leak guard over the sender's recent texts (checkThread), the
//    rules (scams, moving off-platform, harassment, rating talk, a minor's self-disclosure), rate
//    limits, and block vs hold are all the engine's. The optional classifier hook (production: Clef,
//    engine relayClef.ts) can only raise a decision. On an app that rates photos the slop pack's
//    `appearanceLeak` runs as an extra rule (`rating:appearance`, a hold). Nothing here re-implements
//    those rules.
//  - Only the engine's `rendered` text goes out, through the Network's own send path (kind "relay":
//    the recipient checks, quiet hours and the leak guard apply) with the outbound id "relay:<item>",
//    which the Cloud channel delivers with DeliverRequest kind "relay".
//  - A number goes out only after both members asked to swap: the first "send them my number" waits
//    (and the other member is asked once); the second runs both shares through the engine, each with
//    its own consent. A photo needs its own explicit send and the sender's consent to show photos to a
//    match, which no member can give yet (Legal must approve the consent text first), so photos are
//    refused for now.
//  - A held item waits for staff (GET /staff/relay/held; release or reject). Its text is kept only while
//    it is held and is dropped on the decision. A blocked item keeps no text at all.
//  - The relay log is the engine's RelayRecord (ids, kind, decision, reason codes with leak matches as
//    keyed hashes, counts; never a body or a contact value). It is the rate-limit history, so it is in
//    the stored state and in network.relay_records (PgStore), and survives a restart.
// Everything here is plain JSON (exportState). Deterministic: the host passes the time.
import type { MemberId, Owned } from "@thenetwork/core";
import {
  relayGuard, relayItem, relayItemAsync, RELAY_LIMITS, RELAY_WORDING, threadMessage,
  type RelayClassifierHook, type RelayContext, type RelayItem, type RelayOpportunity, type RelayParty, type RelayRecord, type RelayResult, type RelayThreadMessage,
} from "../../engine/src/relay.ts";
import { appearanceLeak } from "../../engine/src/packs/slop/appearance.ts";

const HOUR = 3_600_000, DAY = 24 * HOUR;
/** A thread stays open this long after the meeting (then the match is "expired" for the relay). */
export const RELAY_OPEN_AFTER_MEETING_MS = 7 * DAY;
/**
 * A swap request waits this long for the other member's own request: the engine's consent TTL. The
 * first member's consent is the time of their own request, so a share later than this would rest on
 * stale consent (the engine refuses it, and nothing is backdated to get past that check). After it
 * runs out, the other member's request starts a new swap and the first member is asked again.
 */
export const RELAY_SWAP_TTL_MS = RELAY_LIMITS.consentTtlMs;
/** Log rows kept in the state (the rate limits look back one day; staff and ban notices further). */
export const RELAY_LOG_MAX = 5000;
const THREAD_MAX = 50;

/** What the desk needs to know about a member (the Network's view; never hidden persona truth). */
export interface RelayMember {
  id: MemberId;
  firstName: string;
  /** Lowest known age; undefined when unknown or the member is treated as a minor (fails closed). */
  age: number | undefined;
  optedOut: boolean;
  /** A safety hold, a paused or restricted account. */
  held: boolean;
}
/** A two-person match as the relay sees it. */
export interface RelayMatch {
  id: string;
  participants: [MemberId, MemberId];
  acceptedBy: MemberId[];
  status: RelayOpportunity["status"];
  metAt?: number;
  /** For choosing the newest match. */
  at: number;
}
/** What the ConsentNetwork lends the desk. */
export interface RelayHost {
  app: string;
  now(): number;
  member(id: MemberId): RelayMember | undefined;
  /** The member's matches (two-person opportunities they are in), any state. */
  matchesOf(id: MemberId): RelayMatch[];
  blocked(a: MemberId, b: MemberId): boolean;
  /** Agent-private facts with their owner, and canaries (the relay's leak guard). */
  privateFacts(): { forbidden: Owned[]; canaries: string[] };
  /** The app rates photos (slop): run `appearanceLeak` on relayed text. */
  ratesPhotos: boolean;
  /** Send `body` to `to` through the Network's send path. `key` is the outbound id. "sent", "deferred" or "refused". */
  send(to: MemberId, body: string, o: { from: MemberId; matchId: string; key: string; contact?: string }): "sent" | "deferred" | "refused";
}

/** A held item waiting for staff. `text` only while held (dropped on release or reject). */
export interface RelayHeld {
  itemId: string; matchId: string; app: string; kind: RelayItem["kind"]; from: MemberId; to: MemberId; at: number;
  reasons: string[];
  text?: string;
  /** Set on a listing (ConsentNetwork.relayHeld) when the sender's age is now in doubt: the text is withheld. */
  textHidden?: "minor";
  photoIds?: string[];
  status: "held" | "released" | "rejected";
  decidedBy?: string; decidedAt?: number;
}
/** One relay thread per match: the delivered wording only (the engine's RelayThreadMessage). */
export interface RelayThreadState { id: string; app: string; members: [MemberId, MemberId]; openedAt: number; messages: RelayThreadMessage[] }
/** A member asked to swap numbers; waiting for the other member's own request. */
export interface RelaySwap { itemId: string; matchId: string; from: MemberId; to: MemberId; at: number }

/**
 * "Don't send my number", "cancel the number swap", "never mind about my number": the member takes
 * back a pending swap request. A negation or a cancel word together with their number.
 */
export function withdrawsSwap(text: string): boolean {
  const t = text.replace(/[\u2019\u2018`\u00b4]/g, "'").toLowerCase();
  return /\b(?:don'?t|dont|do not|never|stop|cancel|hold off|rather not|changed my mind|never ?mind|nvm|take back|scratch)\b/.test(t)
    && /\b(?:my (?:phone number|number|phone|digits|cell|contact(?: info)?)|(?:number|numbers) swap|swap(?:ping)? numbers)\b/.test(t);
}
export interface RelayState { threads: RelayThreadState[]; log: RelayRecord[]; held: RelayHeld[]; swaps: RelaySwap[] }
export const emptyRelayState = (): RelayState => ({ threads: [], log: [], held: [], swaps: [] });

/** A member's relay request (POST /internal/relay). The recipient is always the member's current match. */
export interface RelayAsk {
  /** Idempotent item id (the service derives it from the signed request id). */
  itemId: string;
  from: MemberId;
  kind: RelayItem["kind"];
  /** The message (text) or a caption (photo). */
  text?: string;
  /** Photos the member chose (opaque ids); the service checks they are the member's own. */
  photoIds?: string[];
}
/** The answer to the member. `reason` is safe to say to the sender as it is. */
export interface RelayOutcome { itemId: string; decision: "sent" | "held" | "refused"; reason: string; replayed?: boolean }
export interface RelayCallOptions {
  /** The classifier hook (production: clefRelayClassifierFromEnv). Without it: rules only. */
  hook?: RelayClassifierHook;
  /** The member's verified contact (the person record's phone), for a number swap. Never from a message. */
  contactOf?: (id: MemberId) => string | undefined;
  /** The sender's own photo ids and whether they may be shown to a match (no consent exists yet: false). */
  photos?: { ids: string[]; showConsent: boolean };
}

const NOTICE = {
  noMatch: "I can only pass messages on to someone you've matched with, and you don't have an open match right now.",
  swapWait: "I'll share your number as soon as they say they want to swap numbers too.",
  swapAlready: "I already asked them; I'll share your number if they want to swap too.",
  photoOff: "I can't send photos to a match yet.",
  undelivered: "I couldn't pass that on right now.",
  late: "I'll pass that on when it's a reasonable hour for them.",
};
const swapAsk = (name: string) => `${name} would like to swap numbers with you. If you'd like that too, say "send them my number" in the next 15 minutes and I'll share both.`;
/** What the relay thread (and the classifier's context) keeps for a delivered number: never the number. */
const SHARED_NUMBER = (name: string) => `${name || "They"} shared their number.`;

/** The text inside the engine's wording (`Name says: "..."`), for the leak guard's thread check. */
const bodyOf = (rendered: string | null) => (rendered ? /^.{1,40}? says: "([\s\S]*)"$/.exec(rendered)?.[1] : undefined);

export class RelayDesk {
  private s: RelayState = emptyRelayState();
  constructor(private readonly host: RelayHost) {}

  exportState(): RelayState { return JSON.parse(JSON.stringify(this.s)) as RelayState; }
  importState(s: RelayState | undefined) {
    const x = s ? (JSON.parse(JSON.stringify(s)) as RelayState) : emptyRelayState();
    this.s = { threads: x.threads ?? [], log: x.log ?? [], held: x.held ?? [], swaps: x.swaps ?? [] };
  }

  /** The member's open match (newest first), if any. */
  matchFor(from: MemberId): RelayMatch | undefined {
    const now = this.host.now();
    return this.host.matchesOf(from).filter(m => m.status === "mutual" && m.participants.every(p => m.acceptedBy.includes(p)))
      .filter(m => m.metAt === undefined || now - m.metAt <= RELAY_OPEN_AFTER_MEETING_MS).sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1))[0];
  }

  /** One member request: decide through the engine, deliver `rendered`, keep the log. Idempotent on `itemId`. */
  async request(ask: RelayAsk, o: RelayCallOptions = {}): Promise<RelayOutcome> {
    const prior = this.prior(ask.itemId);
    if (prior) return { ...prior, replayed: true };
    const match = this.matchFor(ask.from);
    if (!match) return { itemId: ask.itemId, decision: "refused", reason: NOTICE.noMatch };
    const to = match.participants.find(p => p !== ask.from)!;
    const now = this.host.now();
    if (ask.kind === "contact_share") return this.swap(ask, match, to, now, o);
    const item: RelayItem = ask.kind === "photo"
      ? { id: ask.itemId, kind: "photo", from: ask.from, to, at: now, photoIds: [...new Set(ask.photoIds ?? [])], ...(ask.text?.trim() ? { text: ask.text.trim() } : {}),
          consent: { kind: "photo", by: ask.from, itemId: ask.itemId, at: now, photoIds: [...new Set(ask.photoIds ?? [])] } }
      : { id: ask.itemId, kind: "text", from: ask.from, to, at: now, text: (ask.text ?? "").trim() };
    const res = await this.decide(item, match, o);
    const out = this.apply(res, match, item, o);
    // Photos cannot be shown to a match until a photo consent exists (Legal); say so plainly.
    if (ask.kind === "photo" && res.reasons.includes("photo:no_consent")) return { ...out, reason: NOTICE.photoOff };
    return out;
  }

  /** The engine's decision for one item in this match. */
  private async decide(item: RelayItem, match: RelayMatch, o: RelayCallOptions, at = item.at): Promise<RelayResult> {
    const ctx = this.context(item, match, o, at);
    return o.hook ? relayItemAsync(item, ctx, { hook: o.hook }) : relayItem(item, ctx);
  }

  private context(item: RelayItem, match: RelayMatch, o: RelayCallOptions, now: number): RelayContext {
    const party = (id: MemberId): RelayParty => {
      const m = this.host.member(id);
      return {
        id, firstName: m?.firstName ?? "", age: m?.age, optedOut: m ? m.optedOut : true, held: m?.held ?? false,
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
      // Multi-word facts are also matched fuzzily (as the outbound queue's leak sources do).
      guard: relayGuard({ forbidden: facts.forbidden, facts: facts.forbidden.filter(f => (typeof f === "string" ? f : f.text).trim().split(/\s+/).length >= 2), canaries: facts.canaries }),
      ...(this.host.ratesPhotos ? { extraRules: (t: string) => (appearanceLeak(t) ? ["rating:appearance"] : []) } : {}),
    };
  }

  /** Log the decision, deliver a pass, queue a hold; the answer for the sender. */
  private apply(res: RelayResult, match: RelayMatch, item: RelayItem, o: RelayCallOptions, contact?: string): RelayOutcome {
    this.log(res.record);
    if (res.decision === "block") return { itemId: item.id, decision: "refused", reason: res.senderNotice };
    if (res.decision === "hold") {
      // A hold that is only the rate limit or consent is answered, not queued: the member can try again.
      const fam = (r: string) => r.split(":")[0]!;
      if (res.reasons.every(r => fam(r) === "rate")) return { itemId: item.id, decision: "held", reason: res.senderNotice };
      this.s.held.push({
        itemId: item.id, matchId: match.id, app: this.host.app, kind: item.kind, from: item.from, to: item.to, at: item.at, reasons: res.reasons, status: "held",
        // The text waits for staff only from an adult sender with no age signal (never a minor's words).
        ...(item.text && !res.record.ageSignal ? { text: item.text } : {}), ...(item.photoIds?.length ? { photoIds: [...item.photoIds] } : {}),
      });
      return { itemId: item.id, decision: "held", reason: res.senderNotice };
    }
    const sent = this.deliver(res, match, item, contact);
    if (sent === "refused") { this.undelivered(res.record); return { itemId: item.id, decision: "refused", reason: NOTICE.undelivered }; }
    return { itemId: item.id, decision: "sent", reason: sent === "deferred" ? NOTICE.late : res.senderNotice };
  }

  /** The send path refused a passed item: the log says it was not delivered (and no number was shared), so a replay never answers "Sent." */
  private undelivered(r: RelayRecord) {
    this.log({ ...r, decision: "block", contactShared: false, reasons: [...new Set([...r.reasons, "send:refused"])].sort() });
  }

  private deliver(res: RelayResult, match: RelayMatch, item: RelayItem, contact?: string): "sent" | "deferred" | "refused" {
    const sent = this.host.send(item.to, res.rendered, { from: item.from, matchId: match.id, key: `relay:${item.id}`, ...(contact ? { contact } : {}) });
    if (sent === "refused") return sent;
    const t = this.openThread(match);
    const msg = threadMessage(res);
    // A number swap keeps no number: the thread (and the classifier context built from it) says only that it was shared.
    if (item.kind === "contact_share") msg.rendered = SHARED_NUMBER((this.host.member(item.from)?.firstName ?? "").trim().split(/\s+/)[0] ?? "");
    t.messages.push(msg);
    if (t.messages.length > THREAD_MAX) t.messages.splice(0, t.messages.length - THREAD_MAX);
    return sent;
  }

  /** "Send them my number": waits for the other member's own request, then both numbers go, each through the engine. */
  private async swap(ask: RelayAsk, match: RelayMatch, to: MemberId, now: number, o: RelayCallOptions): Promise<RelayOutcome> {
    this.s.swaps = this.s.swaps.filter(x => now - x.at <= RELAY_SWAP_TTL_MS && x.at <= now);
    const mineValue = o.contactOf?.(ask.from);
    if (!mineValue) return { itemId: ask.itemId, decision: "refused", reason: "I can't share your number right now." };
    const theirs = this.s.swaps.find(x => x.matchId === match.id && x.from === to && x.to === ask.from);
    if (!theirs) {
      if (this.s.swaps.some(x => x.matchId === match.id && x.from === ask.from)) return { itemId: ask.itemId, decision: "held", reason: NOTICE.swapAlready };
      // Check the request itself first (parties, state, consent, rate) with the engine; only a pass waits.
      const probe = await this.decide(this.share(ask.itemId, ask.from, to, now, mineValue), match, o);
      if (probe.decision !== "pass") return this.apply(probe, match, this.share(ask.itemId, ask.from, to, now, mineValue), o);
      this.s.swaps.push({ itemId: ask.itemId, matchId: match.id, from: ask.from, to, at: now });
      const name = this.host.member(ask.from)?.firstName ?? "Your match";
      this.host.send(to, swapAsk(name), { from: ask.from, matchId: match.id, key: `relay:${ask.itemId}:ask` });
      return { itemId: ask.itemId, decision: "held", reason: NOTICE.swapWait };
    }
    // Both asked. Each share runs through the engine with its own consent (the other member's was given at
    // their own request, within the consent TTL; never backdated). Both go out only when both pass and the
    // first one was delivered, so nobody's number goes one way.
    const theirValue = o.contactOf?.(to);
    if (!theirValue) return { itemId: ask.itemId, decision: "refused", reason: "I can't swap numbers right now." };
    this.s.swaps = this.s.swaps.filter(x => x !== theirs);
    const theirItem = this.share(theirs.itemId, to, ask.from, now, theirValue, theirs.at), myItem = this.share(ask.itemId, ask.from, to, now, mineValue);
    const theirRes = await this.decide(theirItem, match, o), myRes = await this.decide(myItem, match, o);
    if (theirRes.decision === "pass" && myRes.decision === "pass") {
      const first = this.apply(theirRes, match, theirItem, o, theirValue);
      if (first.decision !== "sent") {
        // The first share was refused at send time: the second never goes, and neither record says a number was shared.
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

  /** The member takes back their pending number swap ("don't send my number"). Returns how many requests were removed. */
  cancelSwaps(from: MemberId): number {
    const before = this.s.swaps.length;
    this.s.swaps = this.s.swaps.filter(x => x.from !== from);
    return before - this.s.swaps.length;
  }

  private share(id: string, from: MemberId, to: MemberId, at: number, value: string, consentAt = at): RelayItem {
    return { id, kind: "contact_share", from, to, at, contact: { kind: "phone", value }, consent: { kind: "contact_share", by: from, itemId: id, at: consentAt } };
  }

  /** An item this desk already decided (replay of the same signed request). */
  private prior(itemId: string): Omit<RelayOutcome, "replayed"> | undefined {
    const r = this.s.log.find(x => x.itemId === itemId);
    if (r) return { itemId, decision: r.decision === "pass" ? "sent" : r.decision === "hold" ? "held" : "refused", reason: r.decision === "pass" ? "Sent." : r.decision === "hold" ? "I'm holding that one for a quick check before I pass it on." : "I can't pass that on." };
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

  // ------------------------------------------------------------------ staff
  /** Held items, oldest first. Never a minor's words; never a score. */
  held(): RelayHeld[] { return this.s.held.filter(h => h.status === "held").map(h => ({ ...h, reasons: [...h.reasons] })); }

  /**
   * Staff release a held item. The engine checks it again: anything that would now block (parties,
   * the match state, consent, a minor) stays undelivered. Otherwise staff override the hold reasons
   * and the engine's wording goes out.
   */
  release(itemId: string, actor: string, o: RelayCallOptions = {}): { ok: true; delivered: boolean } | { ok: false; reason: string } {
    const h = this.s.held.find(x => x.itemId === itemId && x.status === "held");
    if (!h) return { ok: false, reason: "not_held" };
    const decided = () => { h.status = "released"; h.decidedBy = actor; h.decidedAt = this.host.now(); delete h.text; };
    const match = this.host.matchesOf(h.from).find(m => m.id === h.matchId);
    const item: RelayItem | undefined = h.kind === "photo"
      ? { id: h.itemId, kind: "photo", from: h.from, to: h.to, at: h.at, photoIds: h.photoIds ?? [], ...(h.text ? { text: h.text } : {}), consent: { kind: "photo", by: h.from, itemId: h.itemId, at: h.at, photoIds: h.photoIds ?? [] } }
      : h.kind === "text" && h.text ? { id: h.itemId, kind: "text", from: h.from, to: h.to, at: h.at, text: h.text } : undefined;
    if (!match || !item) { decided(); return { ok: true, delivered: false }; }
    // Rate limits are judged at the original time (the item's own attempt is excluded by the engine).
    const again = relayItem(item, this.context(item, match, o, h.at));
    const first = (this.host.member(h.from)?.firstName ?? "").trim().split(/\s+/)[0] || "Your match";
    const rendered = again.decision === "pass" ? again.rendered : again.decision === "hold" && item.kind === "text" ? RELAY_WORDING.text(first, item.text!) : "";
    decided();
    if (!rendered) return { ok: true, delivered: false };
    const res: RelayResult = { ...again, decision: "pass", rendered, photos: again.photos, record: { ...again.record, decision: "pass", reasons: [...again.record.reasons, "staff:released"].sort() } };
    const sent = this.deliver(res, match, item);
    if (sent !== "refused") this.log(res.record);
    return { ok: true, delivered: sent !== "refused" };
  }

  /** Staff reject a held item: it is never delivered; the text is dropped. */
  reject(itemId: string, actor: string): { ok: true } | { ok: false; reason: string } {
    const h = this.s.held.find(x => x.itemId === itemId && x.status === "held");
    if (!h) return { ok: false, reason: "not_held" };
    h.status = "rejected"; h.decidedBy = actor; h.decidedAt = this.host.now(); delete h.text;
    const r = this.s.log.find(x => x.itemId === itemId);
    if (r) this.log({ ...r, reasons: [...new Set([...r.reasons, "staff:rejected"])].sort() });
    return { ok: true };
  }

  /** The relay log (no bodies, no contact values). */
  records(): RelayRecord[] { return this.s.log.map(r => ({ ...r, reasons: [...r.reasons] })); }
  /**
   * The member whose number this outbound id carries, for an agreed swap the engine passed (the
   * queue's leak guard lets exactly that number through). Undefined for anything else.
   */
  contactShareFrom(outboundId: string): MemberId | undefined {
    if (!outboundId.startsWith("relay:")) return undefined;
    const r = this.s.log.find(x => x.itemId === outboundId.slice(6));
    return r && r.kind === "contact_share" && r.decision === "pass" && r.contactShared ? r.from : undefined;
  }
  /** The sender of the relayed item an outbound id ("relay:<item>") delivers, when the item passed. Not the swap ask ("relay:<item>:ask"). */
  senderOf(outboundId: string): MemberId | undefined {
    if (!outboundId.startsWith("relay:")) return undefined;
    const r = this.s.log.find(x => x.itemId === outboundId.slice(6));
    return r && r.decision === "pass" ? r.from : undefined;
  }
  threads(): RelayThreadState[] { return this.exportState().threads; }

  /** Forget a member (delete, under-13 decline): their held texts and pending swaps go; the log keeps ids only. */
  forget(id: MemberId) {
    for (const h of this.s.held) if ((h.from === id || h.to === id) && h.status === "held") { h.status = "rejected"; h.decidedBy = "system:forget"; h.decidedAt = this.host.now(); delete h.text; }
    this.s.swaps = this.s.swaps.filter(x => x.from !== id && x.to !== id);
    for (const t of this.s.threads) if (t.members.includes(id)) t.messages = [];
  }

  /** Held items older than this are dropped from the state once decided (the log row stays). */
  prune(now: number) {
    this.s.held = this.s.held.filter(h => h.status === "held" || now - (h.decidedAt ?? h.at) < 30 * DAY);
  }
}
