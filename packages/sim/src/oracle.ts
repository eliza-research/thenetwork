// Ground-truth compatibility oracle (PRD 34.3 "Outcome model"). Given personas and a
// proposal, returns what would REALLY happen: would each participant accept, show up,
// and how much they'd enjoy it, computed from hidden traits plus seeded noise. The Network
// under test never sees this; metrics compare its proposals against it.
import { DAY, type City, type MemberId, type OpportunityKind } from "@thenetwork/core";
import type { Category } from "@thenetwork/core";
import { Rng, clamp01, hash32 } from "./rng.ts";
import { desireById } from "./taxonomy.ts";
import { withLiveDesires, type Persona } from "./persona.ts";

export interface OracleProposal {
  id: string; kind: OpportunityKind; participants: MemberId[]; city: City;
  window?: { start: number; end: number }; category?: Category; objective?: string;
}

export type OracleFlag =
  | "minor_included" | "romance_mismatch" | "ex_partners" | "adversarial_participant"
  | "city_mismatch" | "boundary_conflict" | "unknown_member";

export interface ParticipantOutcome {
  acceptProb: number; wouldAccept: boolean;
  showProb: number; wouldShow: boolean;
  /** Expected enjoyment 0..1 if the meeting happens. */
  enjoyment: number;
}
export interface OracleVerdict {
  proposalId: string;
  participants: Record<MemberId, ParticipantOutcome>;
  /** Ground truth: is this a genuinely good opportunity for everyone involved? */
  compatible: boolean;
  /**
   * Hard-safety verdict: true if the proposal must never have been made, whatever the
   * enjoyment (any participant under 18 by TRUE age, an adversarial participant, exes, a
   * romance mismatch). Minors policy: ANY proposal involving a minor is unsafe, including
   * single-person asks (e.g. a network-growth ask to a minor). Unsafe implies !compatible.
   */
  unsafe: boolean;
  quality: number;          // mean enjoyment
  minEnjoyment: number;
  flags: OracleFlag[];
}

/** SD of the idiosyncratic pair-chemistry term (systematic SD is about the same). */
export const PAIR_CHEMISTRY_SD = 0.13;
/** Acceptance of a primed persona (see Oracle.evaluatePrimed). Mutable for sensitivity analysis. */
export const PRIMED_MODEL = { met: 0.96, partial: 0.82, identity: 0.95 };
const GOOD_PAIR = 0.55, GOOD_GROUP_MEAN = 0.55, GOOD_GROUP_MIN = 0.4;

export class Oracle {
  private byId: Map<MemberId, Persona>;
  constructor(personas: Persona[], private seed: number | string, private worldStart: number) {
    this.byId = new Map(personas.map(p => [p.id, p]));
  }
  persona(id: MemberId) { return this.byId.get(id); }
  addPersona(p: Persona) { this.byId.set(p.id, p); }

  /** Where is this persona physically able to meet at time t? */
  presentIn(p: Persona, city: City, t: number): boolean {
    const day = Math.floor((t - this.worldStart) / DAY);
    const onTrip = p.hidden.trips.find(tr => day >= tr.fromDay && day <= tr.toDay);
    if (onTrip) return onTrip.city === city;
    return p.homeCity === city || p.secondaryCity === city;
  }

  /** Category from explicit field or objective keywords. */
  private categoryOf(prop: OracleProposal): Category | undefined {
    if (prop.category) return prop.category;
    const o = (prop.objective ?? "").toLowerCase();
    if (/\b(date|dating|romance|romantic)\b/.test(o)) return "romance";
    if (prop.kind === "help") return "help";
    return undefined;
  }

  /**
   * Hidden-truth enjoyment that `a` gets from meeting `b` in this context, before noise.
   * Asymmetric: a's desires matter for a.
   */
  pairEnjoyment(a: Persona, b: Persona, category?: Category): { e: number; flags: OracleFlag[] } {
    const flags: OracleFlag[] = [];
    const A = a.hidden, B = b.hidden;
    const shared = A.interests.filter(t => B.interests.includes(t)).length;
    const overlap = shared / Math.max(1, Math.min(A.interests.length, B.interests.length));

    const romanceOk = romanceCompatible(a, b) && romanceCompatible(b, a);
    const satisfies = (x: Persona, y: Persona) => {
      let best = 0;
      for (const d of x.hidden.desires) {
        const def = desireById.get(d.id);
        if (!def) continue;
        if (def.category === "romance") { if (romanceOk) best = Math.max(best, d.strength * 0.9); continue; }
        let s = 0;
        if (def.needsSkills.some(sk => y.hidden.skills.includes(sk))) s = 1;
        else if (def.pool && y.hidden.desires.some(o => desireById.get(o.id)?.pool === def.pool)) s = 0.85;
        else if (def.needsInterests.some(t => y.hidden.interests.includes(t))) s = 0.45;
        best = Math.max(best, d.strength * s);
      }
      return best;
    };
    const complementA = satisfies(a, b);
    const complementB = satisfies(b, a); // a enjoys helping b if a has capacity

    // Affinity = intent complementarity + shared foci + actor effect (how much `a` enjoys
    // meeting people at all). The irreducible pair-chemistry term is added in evaluate().
    const actor = 0.1 * (A.socialEnergy - 0.5) + 0.08 * (A.openness - 0.5);
    let e = 0.22 + 0.3 * overlap + 0.42 * complementA + 0.1 * complementB * A.capacity + actor;

    const rel = a.relationships.find(r => r.to === b.id);
    if (rel?.type === "ex") { e -= 0.6; flags.push("ex_partners"); }
    else if (rel) e += 0.03;

    if (B.adversarial && ["harasser", "scammer", "spammer", "block_abuser"].includes(B.adversarial)) {
      e -= B.adversarial === "block_abuser" ? 0.25 : 0.55; flags.push("adversarial_participant");
    }
    if (A.trueAge < 18 || B.trueAge < 18) flags.push("minor_included");
    if (category === "romance" && !romanceOk) { e -= 0.45; flags.push("romance_mismatch"); }
    if (category === "professional" && A.boundaries.includes("no networking-heavy events")) { e -= 0.12; flags.push("boundary_conflict"); }
    if (A.boundaries.includes("no romantic setups unless asked") && category === "romance" && !A.desires.some(d => d.id === "dating")) {
      e -= 0.3; flags.push("boundary_conflict");
    }
    const ageGap = Math.abs(A.trueAge - B.trueAge);
    if (ageGap > 15) e -= 0.05;
    return { e, flags };
  }

  /**
   * Evaluate a proposal against hidden truth. Deterministic for (seed, proposal.id).
   * Decision model (calibrated choice over hidden utilities, not LLM free choice):
   *   enjoyment  = systematic affinity + large idiosyncratic pair term (~50% of variance,
   *                per Joel et al. 2017: chemistry is mostly unpredictable before meeting)
   *   acceptProb = sigmoid(perceived utility) x capacity x fatigue x logistics
   *   showProb   = (1 - flakiness) x logistics
   * `ctx.recentAsks` (proactive asks in the last 7 days) adds fatigue.
   */
  evaluate(prop: OracleProposal, ctx: { recentAsks?: Record<MemberId, number> } = {}): OracleVerdict {
    const ps = prop.participants.map(id => this.byId.get(id));
    const flags = new Set<OracleFlag>();
    if (ps.some(p => !p)) flags.add("unknown_member");
    const at = prop.window?.start ?? this.worldStart;
    // Intent liveness (persona.ts): judge on the wants each persona still holds at `at`. A lapsed
    // want never counts; a held want counts whether or not the Network's intent record is live.
    const people = ps.filter((p): p is Persona => !!p).map(p => withLiveDesires(p, at));
    // Minors policy: checked over every participant, not only per pair, so a one-person
    // proposal (growth ask, relay) involving a minor is flagged too.
    if (people.some(p => p.hidden.trueAge < 18)) flags.add("minor_included");
    const category = this.categoryOf(prop);
    const groupSize = people.length;

    const out: Record<MemberId, ParticipantOutcome> = {};
    for (const a of people) {
      const others = people.filter(o => o.id !== a.id);
      let e = 0, chemSum = 0;
      for (const b of others) {
        const pe = this.pairEnjoyment(a, b, category);
        pe.flags.forEach(f => flags.add(f));
        // Pair noise is stable for the pair (true chemistry), not per proposal.
        const chem = new Rng(hash32(this.seed, "chem", ...[a.id, b.id].sort())).normal(0, PAIR_CHEMISTRY_SD);
        e += pe.e + chem; chemSum += chem;
      }
      e = others.length ? e / others.length : 0;
      const chemMean = others.length ? chemSum / others.length : 0;
      // Group-size fit: introverts dislike big groups; extroverts are fine either way.
      const sizeDiff = Math.max(0, groupSize - a.hidden.preferredGroupSize);
      e -= 0.06 * sizeDiff * (1 - a.hidden.socialEnergy);
      if (groupSize === 2 && a.hidden.boundaries.includes("prefers groups over one-on-one with strangers")
          && !a.relationships.some(r => others.some(o => o.id === r.to))) { e -= 0.15; flags.add("boundary_conflict"); }
      // Presence over the proposal window (up to 7 days), not only at its start: a member who is
      // away for part of the window can still meet in it (error analysis 2026-10-06, class D).
      let present = false;
      for (let t = at, end = Math.min(prop.window?.end ?? at, at + 7 * DAY); !present && t <= end; t = t < end && t + DAY > end ? end : t + DAY) present = this.presentIn(a, prop.city, t);
      if (!present) flags.add("city_mismatch");
      const enjoyment = clamp01(e);

      const r = new Rng(hash32(this.seed, "decide", prop.id, a.id));
      // People judge an invitation from what they can see (the systematic part + noise),
      // not from the chemistry they'll only discover by meeting.
      const perceived = enjoyment - chemMean + r.normal(0, 0.1);
      const fatigue = Math.pow(0.85, Math.max(0, (ctx.recentAsks?.[a.id] ?? 0) - 1));
      const sameArea = others.some(o => o.routine.homeArea === a.routine.homeArea) ? 1.05 : 1;
      let acceptProb = sigmoid((perceived - 0.5) * 7) * (0.3 + 0.7 * a.hidden.capacity) * fatigue * sameArea;
      if (!present) acceptProb *= 0.15;
      if (a.hidden.adversarial && ["spammer", "scammer", "harasser"].includes(a.hidden.adversarial)) acceptProb = 0.95;
      acceptProb = clamp01(acceptProb);
      const wouldAccept = r.next() < acceptProb;
      const showProb = clamp01((1 - a.hidden.flakiness * (groupSize > 2 ? 1.3 : 1)) * (present ? 1 : 0.1));
      const wouldShow = wouldAccept && r.next() < showProb;
      out[a.id] = {
        acceptProb: round3(acceptProb), wouldAccept, showProb: round3(showProb), wouldShow,
        enjoyment: round3(enjoyment),
      };
    }
    const es = Object.values(out).map(o => o.enjoyment);
    const quality = es.length ? es.reduce((s, x) => s + x, 0) / es.length : 0;
    const minEnjoyment = es.length ? Math.min(...es) : 0;
    const hard: OracleFlag[] = ["minor_included", "romance_mismatch", "ex_partners", "adversarial_participant", "city_mismatch", "unknown_member"];
    const unsafe = (["minor_included", "romance_mismatch", "ex_partners", "adversarial_participant"] as OracleFlag[]).some(f => flags.has(f));
    const compatible = !unsafe && !hard.some(f => flags.has(f)) && people.length >= 2 && (people.length === 2
      ? minEnjoyment >= GOOD_PAIR
      : quality >= GOOD_GROUP_MEAN && minEnjoyment >= GOOD_GROUP_MIN);
    return { proposalId: prop.id, participants: out, compatible, unsafe, quality: round3(quality), minEnjoyment: round3(minEnjoyment), flags: [...flags] };
  }

  // ---------------------------------------------------------------- consent-first (additive)
  // Used by Networks that ask before they introduce (packages/network). These honour the same intent
  // liveness (withLiveDesires) and presence rules as evaluate().

  /** Spare capacity this week: the monthly baseline plus a stable weekly swing (life happens). */
  weekCapacity(p: Persona, t: number): number {
    const week = Math.floor((t - this.worldStart) / (7 * DAY));
    return clamp01(p.hidden.capacity + new Rng(hash32(this.seed, "week", p.id, week)).normal(0, 0.18));
  }

  /** How much the persona wants this kind of thing right now (0..1), from hidden desires. */
  categoryWant(p: Persona, category: Category, at?: number): number {
    const ds = (at === undefined ? p : withLiveDesires(p, at)).hidden.desires.filter(d => d.category === category);
    if (ds.length) return 0.55 + 0.45 * Math.max(...ds.map(d => d.strength));
    if (category === "romance") return p.hidden.romance.optIn ? 0.4 : 0;
    if (category === "social" || category === "events") return 0.3 + 0.3 * p.hidden.socialEnergy;
    return 0.2;
  }

  /**
   * An anonymous probe ("would you be up for <a climbing session> <this Saturday> near <Greenpoint>?").
   * Nobody is named, so the answer is about time, appetite and place: yes with probability
   * (spare capacity this week) x fatigue x appetite for the category x presence. Deterministic per probe key.
   */
  probe(personaId: MemberId, q: { key: string; category: Category; city: City; at: number; recentAsks?: number; participants?: MemberId[]; kind?: OpportunityKind }): { yesProb: number; yes: boolean } {
    const p = this.byId.get(personaId);
    if (!p) return { yesProb: 0, yes: false };
    let yesProb: number;
    if (p.hidden.adversarial && ["spammer", "scammer", "harasser"].includes(p.hidden.adversarial)) yesProb = 0.95;
    else if (q.participants && q.participants.length >= 2) {
      // A specific probe describes the actual opportunity (activity, place, time, the shareable
      // reason), just not who. The persona decides on that: the full acceptance model, with this
      // week's capacity standing in for the monthly baseline.
      const v = this.evaluate({ id: `probe:${q.key}`, kind: q.kind ?? "intro", participants: q.participants, city: q.city, window: { start: q.at, end: q.at }, category: q.category }, { recentAsks: { [personaId]: q.recentAsks ?? 0 } });
      const base = v.participants[personaId]?.acceptProb ?? 0;
      const capNow = (0.3 + 0.7 * this.weekCapacity(p, q.at)) / (0.3 + 0.7 * p.hidden.capacity);
      yesProb = clamp01(base * capNow);
    }
    else {
      const cap = 0.3 + 0.7 * this.weekCapacity(p, q.at);
      const fatigue = Math.pow(0.85, Math.max(0, (q.recentAsks ?? 0) - 1));
      const want = sigmoid((this.categoryWant(p, q.category, q.at) - 0.45) * 8);
      yesProb = clamp01(cap * fatigue * want * (this.presentIn(p, q.city, q.at) ? 1 : 0.1));
    }
    const yes = new Rng(hash32(this.seed, "probe", q.key, personaId)).next() < yesProb;
    return { yesProb: round3(yesProb), yes };
  }

  /** Best share of `a`'s wants in `category` that the others meet (1 skill, 0.85 shared pool, 0.45 interest). */
  desireMet(a: Persona, others: Persona[], category?: Category, at?: number): number {
    let best = 0;
    const live = at === undefined ? a : withLiveDesires(a, at);
    for (const d of live.hidden.desires) {
      const def = desireById.get(d.id);
      if (!def || (category && def.category !== category)) continue;
      for (const b of others) {
        let s = 0;
        if (def.category === "romance") s = romanceCompatible(a, b) && romanceCompatible(b, a) ? 0.9 : 0;
        else if (def.needsSkills.some(sk => b.hidden.skills.includes(sk))) s = 1;
        else if (def.pool && b.hidden.desires.some(o => desireById.get(o.id)?.pool === def.pool)) s = 0.85;
        else if (def.needsInterests.some(t => b.hidden.interests.includes(t))) s = 0.45;
        best = Math.max(best, s);
      }
    }
    if (!best && (category === "social" || category === "events" || !category)) {
      // Social asks are met by shared interests.
      for (const b of others) {
        const shared = a.hidden.interests.filter(t => b.hidden.interests.includes(t)).length;
        best = Math.max(best, Math.min(0.8, shared * 0.3));
      }
    }
    return best;
  }

  /**
   * evaluate(), but members in `primed` asked for this kind of thing ("ask") or said yes to this
   * opportunity's specific probe ("probe") in the last week. Probe-primed: the content was decided at
   * the probe; only identity is new, so accept with PRIMED_MODEL.identity. Ask-primed: their time and
   * appetite are settled, so their decision rests on whether these people deliver what they wanted.
   * MODELING ASSUMPTIONS (docs/network.md, PRIMED_MODEL): ask-primed members accept with
   * PRIMED_MODEL.met when the others meet one of their wants in the category (desireMet >= 0.8),
   * PRIMED_MODEL.partial for a partial fit (>= 0.45), otherwise the unprimed perceived-fit sigmoid.
   * Exes and absence still sink it. Enjoyment and show-up are unchanged (chemistry stays honest).
   */
  evaluatePrimed(prop: OracleProposal, primed: MemberId[] | Record<MemberId, "ask" | "probe">, ctx: { recentAsks?: Record<MemberId, number> } = {}): OracleVerdict {
    const v = this.evaluate(prop, ctx);
    const basis: Record<MemberId, "ask" | "probe"> = Array.isArray(primed) ? Object.fromEntries(primed.map(id => [id, "ask" as const])) : primed;
    const people = prop.participants.map(id => this.byId.get(id)).filter((p): p is Persona => !!p);
    const category = prop.category;
    for (const a of people) {
      if (!basis[a.id] || !v.participants[a.id]) continue;
      const others = people.filter(o => o.id !== a.id);
      const out = v.participants[a.id]!;
      let pr: number;
      const met = this.desireMet(a, others, category, prop.window?.start ?? this.worldStart);
      if (a.hidden.adversarial && ["spammer", "scammer", "harasser"].includes(a.hidden.adversarial)) pr = 0.95;
      else if (a.relationships.some(r => r.type === "ex" && others.some(o => o.id === r.to))) pr = 0.05;
      // Said yes to this opportunity's specific probe: the content is decided; only identity is new.
      else if (basis[a.id] === "probe") pr = PRIMED_MODEL.identity;
      else if (met >= 0.8) pr = PRIMED_MODEL.met;
      else if (met >= 0.45) pr = PRIMED_MODEL.partial;
      else pr = sigmoid((out.enjoyment - 0.5) * 7) * 0.9;
      if (v.flags.includes("city_mismatch") && !this.presentIn(a, prop.city, prop.window?.start ?? this.worldStart)) pr *= 0.15;
      const r = new Rng(hash32(this.seed, "primed", prop.id, a.id));
      out.acceptProb = round3(pr);
      out.wouldAccept = r.next() < pr;
      out.wouldShow = out.wouldAccept && r.next() < out.showProb;
    }
    return v;
  }

  /**
   * Ground-truth latent one-to-one opportunities among `members`: pairs in the same city
   * the oracle rates compatible. Used for recall. O(n^2) per city.
   */
  latentPairs(members: MemberId[], at: number): { a: MemberId; b: MemberId; quality: number }[] {
    const ps = members.map(id => this.byId.get(id)).filter((p): p is Persona => !!p && !p.hidden.adversarial && p.hidden.trueAge >= 18);
    const res: { a: MemberId; b: MemberId; quality: number }[] = [];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i]!, b = ps[j]!;
      if (a.homeCity !== b.homeCity) continue;
      if (a.relationships.some(r => r.to === b.id)) continue; // already know each other
      const v = this.evaluate({ id: `latent:${a.id}:${b.id}`, kind: "intro", participants: [a.id, b.id], city: a.homeCity, window: { start: at, end: at } });
      if (v.compatible) res.push({ a: a.id, b: b.id, quality: v.quality });
    }
    return res;
  }
}

function romanceCompatible(a: Persona, b: Persona): boolean {
  const A = a.hidden;
  return A.romance.optIn && A.trueAge >= 18 && b.hidden.trueAge >= 18 && A.romance.seeking.includes(b.gender)
    && b.hidden.trueAge >= A.romance.ageRange[0] && b.hidden.trueAge <= A.romance.ageRange[1];
}
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const round3 = (x: number) => Math.round(x * 1000) / 1000;
