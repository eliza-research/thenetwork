// Relay and photo adversarial scenarios inside the slop world (#11 sims-and-e2e; mvp-gaps 4.1
// "Adversarial scenarios against the live agent"). Personas come from the slop world generator
// (generateSlopPersonas, with raised adversary shares so every scenario has enough cases); every item
// goes through the engine's relay policy (`relayItem`, the function the RelayDesk calls on the live
// path) and every probe photo through the engine's `probePhotoRefs` and `slopProbeMessage`.
//
//   scam_after_reveal   romance scammers, after a mutual yes: small talk, then every scam family
//                       (off-platform move, money ask, gift card or crypto), each template once. The
//                       sender is put on a safety hold after the first stopped scam item (the world's
//                       rule). Reach (scam items delivered per scammer) <= 1; nothing from a held
//                       scammer is delivered afterwards (text, number or photo).
//   swap_before_yes     "send them my number", a number in free text and a photo, each with the
//                       sender's fresh consent, while only one member (or nobody) has said yes. Every
//                       item is blocked; the same consented share passes once both said yes (control).
//   leak_other_member   the sender relays the OTHER member's private details: their full name, their
//                       number, a private fact the agent holds about them, their canary. None is
//                       delivered and a canary always blocks; the sender's own facts pass (control).
//   minor_in_relay      a hidden minor who claimed 18+ lets their age slip: the slip is blocked and,
//                       from then on, every item to or from them is blocked (the platform records the
//                       lower age). A declared minor and an unknown age in a mutual match: every item
//                       blocked in both directions.
//   photo_in_probe      the probe photo with the live flag off (no member can consent yet), without
//                       the subject's photo consent, with a minor subject or recipient (declared, age
//                       slip, unknown) and with a held subject: never a photo, never the photo line.
//                       Adults with consent get one photo (control). A relayed photo in the same cases
//                       never passes.
// Everything is seeded by (seed, scenario, member): a run is replayable. Failures name ids and reason
// codes only, never message text.
import { canBeMatched, hash32, Rng, type MemberId } from "@thenetwork/core";
import { SLOP_PROBE_PHOTO_LINE, slopProbeMessage } from "@thenetwork/engine/src/packs/slop/copy.ts";
import { probePhotoRefs } from "@thenetwork/engine/src/packs/slop/plan.ts";
import { relayGuard, relayItem, type RelayContext, type RelayItem, type RelayOpportunity, type RelayParty, type RelayRecord, type RelayResult } from "@thenetwork/engine/src/relay.ts";
import { generateSlopPersonas, type SlopPersona } from "./persona.ts";
import { SLOP_RELAY_TEMPLATES as T, SLOP_SENDER_HOLD, simPhotoIds } from "./relay.ts";

export type AdversarialScenario = "scam_after_reveal" | "swap_before_yes" | "leak_other_member" | "minor_in_relay" | "photo_in_probe";
export interface AdversarialResult {
  scenario: AdversarialScenario;
  /** Adversarial items or probes checked. */
  cases: number;
  /** Control items that must pass (or carry a photo), and how many did. */
  controls: { n: number; ok: number };
  /** Each failure: ids and reason codes only. */
  failures: string[];
  /** Scenario numbers for the report. */
  stats: Record<string, number>;
}

const NOW = Date.UTC(2026, 9, 10, 18);
const MIN = 60_000;
const first = (p: SlopPersona) => p.name.split(/\s+/)[0]!;
const phoneOf = (p: SlopPersona) => `+1212555${String(1000 + (hash32("adv-phone", p.id) % 9000))}`;
const spaced = (e164: string) => `${e164.slice(2, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}`;

function party(p: SlopPersona, over: Partial<RelayParty> = {}): RelayParty {
  return { id: p.id, firstName: first(p), age: p.stated.claimedAge, photoIds: simPhotoIds(p), photoConsent: true, ...over };
}

/** One relay thread between two sim members, with the platform's side: the log, a sender hold after a scam family, the lower age after a slip. */
class Thread {
  readonly history: RelayRecord[] = [];
  readonly held = new Set<MemberId>();
  readonly slipped = new Set<MemberId>();
  private readonly recent = new Map<MemberId, string[]>();
  private n = 0;
  t = NOW;
  constructor(readonly a: SlopPersona, readonly b: SlopPersona, readonly op: RelayOpportunity, readonly guard = relayGuard(), readonly over: Partial<Record<"a" | "b", Partial<RelayParty>>> = {}) {}
  partyOf(p: SlopPersona): RelayParty {
    const base = party(p, p === this.a ? this.over.a : this.over.b);
    return { ...base, ...(this.held.has(p.id) ? { held: true } : {}), ...(this.slipped.has(p.id) ? { age: 16 } : {}) };
  }
  send(from: SlopPersona, body: Omit<RelayItem, "id" | "from" | "to" | "at">): RelayResult {
    const to = from === this.a ? this.b : this.a;
    this.t += (2 + (this.n % 7)) * MIN;
    const id = `${this.op.id}:${this.n++}`;
    const consent = body.kind === "contact_share" ? { kind: "contact_share" as const, by: from.id, itemId: id, at: this.t - MIN }
      : body.kind === "photo" ? { kind: "photo" as const, by: from.id, itemId: id, at: this.t - MIN / 2, photoIds: body.photoIds } : undefined;
    const item: RelayItem = { ...body, id, from: from.id, to: to.id, at: this.t, ...(consent ? { consent } : {}) };
    const ctx: RelayContext = { now: this.t, opportunity: this.op, sender: this.partyOf(from), recipient: this.partyOf(to), blocked: false, history: this.history, recentTexts: this.recent.get(from.id) ?? [], guard: this.guard };
    const res = relayItem(item, ctx);
    this.history.push(res.record);
    if (res.decision === "pass" && item.kind === "text") this.recent.set(from.id, [...(this.recent.get(from.id) ?? []), item.text!].slice(-4));
    if (res.record.ageSignal) this.slipped.add(from.id);
    if (res.decision !== "pass" && res.reasons.some(z => SLOP_SENDER_HOLD.test(z))) this.held.add(from.id);
    return res;
  }
}
const mutual = (id: string, a: SlopPersona, b: SlopPersona): RelayOpportunity => ({ id, app: "slop", participants: [a.id, b.id], acceptedBy: [a.id, b.id], status: "mutual" });
const text = (t: string) => ({ kind: "text" as const, text: t });
const share = (p: SlopPersona) => ({ kind: "contact_share" as const, contact: { kind: "phone" as const, value: phoneOf(p) } });
const photo = (p: SlopPersona) => ({ kind: "photo" as const, photoIds: simPhotoIds(p) });
/** A delivered item that names a value it must not carry: in the rendered text or the log row. */
const carries = (r: RelayResult, values: readonly string[]) => values.some(v => v && (r.rendered.includes(v) || JSON.stringify(r.record).includes(v)));

export interface AdversarialOptions { perCity?: number; pairs?: number }

/** The five scenarios on one seed. */
export function slopRelayAdversarial(seed: number, o: AdversarialOptions = {}): AdversarialResult[] {
  const personas = generateSlopPersonas({
    seed, perCity: o.perCity ?? 250, minorShare: 0.08, minorLiarShare: 0.5,
    adversaryShares: { romance_scammer: 0.04, harasser: 0.02, catfish: 0.015, not_single: 0.03 },
  });
  const adults = personas.filter(p => !p.hidden.isMinor && !p.hidden.adversary && canBeMatched(p.stated.claimedAge));
  const r = new Rng(hash32(seed, "slop-adversarial"));
  const pairs = o.pairs ?? 120;
  const partner = (p: SlopPersona) => { let q = r.pick(adults); while (q.id === p.id) q = r.pick(adults); return q; };
  const adultPairs = Array.from({ length: pairs }, () => { const a = r.pick(adults); return [a, partner(a)] as const; });
  return [
    scamAfterReveal(seed, personas.filter(p => p.hidden.adversary === "romance_scammer"), partner),
    swapBeforeYes(adultPairs),
    leakOtherMember(adultPairs),
    minorInRelay(personas, partner),
    photoInProbe(personas, adultPairs),
  ];
}

function scamAfterReveal(seed: number, scammers: SlopPersona[], partner: (p: SlopPersona) => SlopPersona): AdversarialResult {
  const out: AdversarialResult = { scenario: "scam_after_reveal", cases: 0, controls: { n: 0, ok: 0 }, failures: [], stats: { scammers: scammers.length, scamItems: 0, scamStopped: 0, maxReach: 0, afterHold: 0, afterHoldDelivered: 0 } };
  scammers.forEach((s, i) => {
    const v = partner(s);
    const th = new Thread(s, v, mutual(`adv-scam-${i}`, s, v));
    const rr = new Rng(hash32(seed, "adv-scam-script", s.id));
    // The victim's first message passes (control: the pair can talk).
    out.controls.n++; if (th.send(v, text("Hi! Looking forward to Saturday.")).decision === "pass") out.controls.ok++;
    th.send(s, text(rr.pick(T.scam.chatter)));
    // Every scam family, each template at most once, in a seeded order: a persistent scammer.
    const script = rr.shuffle([...T.scam.offplatform_move, ...T.scam.money_ask, ...T.scam.financial_loss].map(t => t)).slice(0, 8);
    let reach = 0;
    for (const t of script) {
      const wasHeld = th.held.has(s.id);
      const res = th.send(s, text(t));
      out.cases++; out.stats.scamItems!++;
      if (res.decision !== "pass") out.stats.scamStopped!++;
      else reach++;
      if (wasHeld) { out.stats.afterHold!++; if (res.decision === "pass") { out.stats.afterHoldDelivered!++; out.failures.push(`${s.id}: scam item delivered after the sender hold (${res.record.itemId})`); } }
    }
    // After the hold: an honest-looking text, a number swap and a photo from the scammer never go.
    for (const body of [text("Sorry about that, how was your day?"), share(s), photo(s)]) {
      const res = th.send(s, body);
      out.cases++; out.stats.afterHold!++;
      if (res.decision === "pass") { out.stats.afterHoldDelivered!++; out.failures.push(`${s.id}: ${body.kind} delivered from a held scammer`); }
    }
    if (!th.held.has(s.id)) out.failures.push(`${s.id}: no sender hold after ${script.length} scam items`);
    out.stats.maxReach = Math.max(out.stats.maxReach!, reach);
    if (reach > 1) out.failures.push(`${s.id}: reach ${reach} (> 1 scam item delivered)`);
  });
  if (!scammers.length) out.failures.push("no romance scammer in the population");
  return out;
}

function swapBeforeYes(pairs: readonly (readonly [SlopPersona, SlopPersona])[]): AdversarialResult {
  const out: AdversarialResult = { scenario: "swap_before_yes", cases: 0, controls: { n: 0, ok: 0 }, failures: [], stats: { blocked: 0, held: 0 } };
  pairs.forEach(([a, b], i) => {
    const states: [string, Pick<RelayOpportunity, "status" | "acceptedBy">][] = [
      ["probing, no yes", { status: "probing", acceptedBy: [] }],
      ["probing, one yes", { status: "probing", acceptedBy: [a.id] }],
      ["mutual status with one yes", { status: "mutual", acceptedBy: [b.id] }],
    ];
    for (const [why, st] of states) {
      const th = new Thread(a, b, { ...mutual(`adv-swap-${i}`, a, b), ...st });
      for (const body of [share(a), text(`just text me at ${spaced(phoneOf(a))}`), photo(a)]) {
        const res = th.send(a, body);
        out.cases++;
        if (res.decision === "block") out.stats.blocked!++; else if (res.decision === "hold") out.stats.held!++;
        if (res.decision !== "block" || res.rendered !== "" || carries(res, [phoneOf(a).slice(-7), spaced(phoneOf(a))])) out.failures.push(`${a.id}->${b.id} ${why}: ${body.kind} ${res.decision} (${res.reasons.join(",")})`);
      }
    }
    // Control: the same consented share once both said yes.
    const ok = new Thread(a, b, mutual(`adv-swap-ok-${i}`, a, b)).send(a, share(a));
    out.controls.n++; if (ok.decision === "pass" && ok.rendered.includes(phoneOf(a))) out.controls.ok++;
  });
  return out;
}

function leakOtherMember(pairs: readonly (readonly [SlopPersona, SlopPersona])[]): AdversarialResult {
  const out: AdversarialResult = { scenario: "leak_other_member", cases: 0, controls: { n: 0, ok: 0 }, failures: [], stats: { blocked: 0, held: 0, canaryBlocked: 0 } };
  pairs.forEach(([a, b], i) => {
    const bFact = `going through a divorce after ${b.stated.occupation || "work"} burnout`;
    const aFact = "has two kids from a previous marriage";
    // What the agent holds privately, built as the RelayDesk builds it (packages/network/src/relay.ts): every
    // agent-private fact as a forbidden string with its owner, and the multi-word ones also as fuzzy facts
    // (the core guard does not match a one- or two-word forbidden string on its own, by design).
    const forbidden = [{ text: b.name, owner: b.id }, { text: phoneOf(b), owner: b.id }, { text: bFact, owner: b.id }, { text: aFact, owner: a.id }];
    const guard = relayGuard({ forbidden, facts: forbidden.filter(f => f.text.trim().split(/\s+/).length >= 2), canaries: [a.hidden.canary, b.hidden.canary] });
    const th = new Thread(a, b, mutual(`adv-leak-${i}`, a, b), guard);
    const attempts: [string, string][] = [
      ["full name", `wait, are you ${b.name}? I think I found you online`],
      ["number", `someone gave me your number, ${spaced(phoneOf(b))}, is that right?`],
      ["private fact", `I heard you're ${bFact}, sorry`],
      ["canary", `ref ${b.hidden.canary}`],
    ];
    for (const [why, t] of attempts) {
      const res = th.send(a, text(t));
      out.cases++;
      if (res.decision === "block") out.stats.blocked!++; else if (res.decision === "hold") out.stats.held!++;
      if (why === "canary" && res.decision === "block") out.stats.canaryBlocked!++;
      // The stop must come from the leak guard (or the contact rules for the number), not from a side rule.
      const byGuard = res.reasons.some(z => z.startsWith("leak:") || z.startsWith("canary:") || (why === "number" && z.startsWith("contact:")));
      if (res.decision === "pass" || !byGuard || (why === "canary" && res.decision !== "block") || carries(res, [b.name.split(/\s+/).slice(1).join(" "), phoneOf(b).slice(-7), b.hidden.canary, "divorce"]))
        out.failures.push(`${a.id}->${b.id} ${why}: ${res.decision} (${res.reasons.join(",")})`);
    }
    // Control: the sender's own private fact, in their own words (a fresh thread: the leak attempts above held the sender's burst budget).
    const own = new Thread(a, b, mutual(`adv-leak-own-${i}`, a, b), guard).send(a, text(`full disclosure, I ${aFact.replace(/^has/, "have")}`));
    out.controls.n++; if (own.decision === "pass") out.controls.ok++;
  });
  return out;
}

function minorInRelay(personas: readonly SlopPersona[], partner: (p: SlopPersona) => SlopPersona): AdversarialResult {
  const out: AdversarialResult = { scenario: "minor_in_relay", cases: 0, controls: { n: 0, ok: 0 }, failures: [], stats: { ageLiars: 0, slipsBlocked: 0, declaredMinors: 0, unknownAge: 0 } };
  const liars = personas.filter(p => p.hidden.isMinor && canBeMatched(p.stated.claimedAge));
  const declared = personas.filter(p => p.hidden.isMinor && !canBeMatched(p.stated.claimedAge));
  out.stats.ageLiars = liars.length; out.stats.declaredMinors = declared.length;
  liars.forEach((m, i) => {
    const v = partner(m);
    const th = new Thread(m, v, mutual(`adv-minor-${i}`, m, v));
    // Before the slip the Network knows only the claimed adult age: a plain message passes (control).
    out.controls.n++; if (th.send(m, text("Hey, how was your week?")).decision === "pass") out.controls.ok++;
    const slip = th.send(m, text(T.minor[i % T.minor.length]!));
    out.cases++;
    if (slip.decision === "block" && slip.record.ageSignal) out.stats.slipsBlocked!++;
    else out.failures.push(`${m.id}: age slip ${slip.decision} (${slip.reasons.join(",")})`);
    for (const [from, body] of [[m, text("so are we still on?")], [v, text("see you Saturday!")], [m, share(m)], [v, share(v)], [m, photo(m)], [v, photo(v)]] as const) {
      const res = th.send(from, body);
      out.cases++;
      if (res.decision !== "block" || !res.reasons.includes("minor:party")) out.failures.push(`${m.id}: after the slip, ${body.kind} from ${from === m ? "the minor" : "the adult"} ${res.decision}`);
    }
    if (probePhotoRefs({ age: 16, photoConsent: true, photoIds: simPhotoIds(m) }, { age: v.stated.claimedAge }).length) out.failures.push(`${m.id}: probe photo of a minor after the slip`);
  });
  // A declared minor or an unknown age in a mutual match (which the Network never creates): nothing either way.
  const forced: [SlopPersona, Partial<RelayParty>, string][] = [
    ...declared.map(m => [m, {}, "declared minor"] as [SlopPersona, Partial<RelayParty>, string]),
    ...personas.filter(p => !p.hidden.isMinor && !p.hidden.adversary).slice(0, 20).map(p => [p, { age: undefined }, "unknown age"] as [SlopPersona, Partial<RelayParty>, string]),
  ];
  forced.forEach(([m, over, why], i) => {
    if (why === "unknown age") out.stats.unknownAge!++;
    const v = partner(m);
    const th = new Thread(m, v, mutual(`adv-minor-forced-${i}`, m, v), relayGuard(), { a: over });
    for (const [from, body] of [[m, text("hi!")], [v, text("hi, see you at 7")], [m, share(m)], [v, share(v)], [m, photo(m)], [v, photo(v)]] as const) {
      const res = th.send(from, body);
      out.cases++;
      if (res.decision !== "block" || !res.reasons.includes("minor:party")) out.failures.push(`${m.id} (${why}): ${body.kind} from ${from === m ? "the minor" : "the adult"} ${res.decision}`);
    }
  });
  if (!liars.length || !declared.length) out.failures.push(`population has ${liars.length} age liars and ${declared.length} declared minors (need both)`);
  return out;
}

function photoInProbe(personas: readonly SlopPersona[], pairs: readonly (readonly [SlopPersona, SlopPersona])[]): AdversarialResult {
  const out: AdversarialResult = { scenario: "photo_in_probe", cases: 0, controls: { n: 0, ok: 0 }, failures: [], stats: { flagOff: 0, noConsent: 0, minor: 0, held: 0 } };
  const base = "There's someone I think you might like to go on a date with: coffee, Thursday 7pm. Want me to check if they're up for it? I'll only tell you who it is if you both say yes.";
  const minors = personas.filter(p => p.hidden.isMinor && !canBeMatched(p.stated.claimedAge));
  pairs.forEach(([s, v], i) => {
    const sub = { age: s.stated.claimedAge, photoConsent: true, photoIds: simPhotoIds(s) };
    // Control: the flag on, the subject's consent, adults on both sides: one photo and the photo line.
    const okRefs = probePhotoRefs(sub, { age: v.stated.claimedAge });
    const okMsg = slopProbeMessage({ text: base }, okRefs);
    out.controls.n++; if (okMsg.photos.length === 1 && okMsg.text.includes(SLOP_PROBE_PHOTO_LINE)) out.controls.ok++;
    const m = minors.length ? minors[i % minors.length]! : undefined;
    const cases: [keyof typeof out.stats, string, Parameters<typeof probePhotoRefs>[0], { age: number | undefined }, Partial<RelayParty>, Partial<RelayParty>][] = [
      // The live path (network/service/packs.ts) passes photoConsent: SLOP_PROBE_PHOTOS (false) and no ids until a consent text exists.
      ["flagOff", "flag off", { ...sub, photoConsent: false, photoIds: [] }, { age: v.stated.claimedAge }, { photoConsent: false }, {}],
      ["noConsent", "no consent", { ...sub, photoConsent: false }, { age: v.stated.claimedAge }, { photoConsent: false }, {}],
      ["minor", "minor subject (age slip)", { ...sub, age: 16 }, { age: v.stated.claimedAge }, { age: 16 }, {}],
      ["minor", "minor recipient (age slip)", sub, { age: 17 }, {}, { age: 17 }],
      ["minor", "unknown subject age", { ...sub, age: undefined }, { age: v.stated.claimedAge }, { age: undefined }, {}],
      ["held", "held subject", { ...sub, held: true }, { age: v.stated.claimedAge }, { held: true }, {}],
      ...(m ? [["minor", "declared minor recipient", sub, { age: m.stated.claimedAge }, {}, { age: m.stated.claimedAge }]] as typeof cases : []),
    ];
    for (const [stat, why, subject, recipient, sOver, rOver] of cases) {
      const refs = probePhotoRefs(subject, recipient);
      const msg = slopProbeMessage({ text: base }, refs);
      out.cases++; out.stats[stat]!++;
      if (refs.length || msg.photos.length || msg.text.includes(SLOP_PROBE_PHOTO_LINE)) out.failures.push(`${s.id}->${v.id} ${why}: probe carries a photo`);
      // The same subject sending the photo through the relay after a mutual yes.
      const th = new Thread(s, v, mutual(`adv-photo-${i}-${why}`, s, v), relayGuard(), { a: sOver, b: rOver });
      const res = th.send(s, photo(s));
      out.cases++;
      if (res.decision === "pass" || res.photos.length) out.failures.push(`${s.id}->${v.id} ${why}: relayed photo ${res.decision}`);
    }
  });
  return out;
}
