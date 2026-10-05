// Ground-truth compatibility oracle (PRD 34.3 "Outcome model"). Given personas and a
// proposal, returns what would REALLY happen: would each participant accept, show up,
// and how much they'd enjoy it, computed from hidden traits plus seeded noise. The Network
// under test never sees this; metrics compare its proposals against it.
import { DAY, type City, type MemberId, type OpportunityKind } from "@thenetwork/core";
import type { Category } from "@thenetwork/core";
import { Rng, clamp01, hash32 } from "./rng.ts";
import { desireById } from "./taxonomy.ts";
import type { Persona } from "./persona.ts";

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
  quality: number;          // mean enjoyment
  minEnjoyment: number;
  flags: OracleFlag[];
}

/** SD of the idiosyncratic pair-chemistry term (systematic SD is about the same). */
export const PAIR_CHEMISTRY_SD = 0.13;
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
    const people = ps.filter((p): p is Persona => !!p);
    const category = this.categoryOf(prop);
    const groupSize = people.length;
    const at = prop.window?.start ?? this.worldStart;

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
      const present = this.presentIn(a, prop.city, at);
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
    const compatible = !hard.some(f => flags.has(f)) && people.length >= 2 && (people.length === 2
      ? minEnjoyment >= GOOD_PAIR
      : quality >= GOOD_GROUP_MEAN && minEnjoyment >= GOOD_GROUP_MIN);
    return { proposalId: prop.id, participants: out, compatible, quality: round3(quality), minEnjoyment: round3(minEnjoyment), flags: [...flags] };
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
