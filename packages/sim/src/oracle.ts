// Ground-truth compatibility oracle (PRD 34.3 "Outcome model"). Given personas and a
// proposal, returns what would REALLY happen: would each participant accept, show up,
// and how much they'd enjoy it, computed from hidden traits plus seeded noise. The Network
// under test never sees this; metrics compare its proposals against it.
import { DAY, canBeMatched, type City, type MemberId, type OpportunityKind } from "@thenetwork/core";
import type { Category } from "@thenetwork/core";
import { Rng, clamp01, hash32 } from "@thenetwork/core";
import { Coins, signature } from "./coins.ts";
import { desireById } from "./taxonomy.ts";
import {
  desireLive, domainOfTag, ensurePersonaStrata, SPEND_TIERS, withLiveDesires,
  type Persona, type StrataSignals,
} from "./persona.ts";
import { inHourWindow, localParts } from "./time.ts";

export interface OracleProposal {
  id: string; kind: OpportunityKind; participants: MemberId[]; city: City;
  window?: { start: number; end: number }; category?: Category; objective?: string;
}

export type OracleFlag =
  | "minor_included" | "romance_mismatch" | "ex_partners" | "adversarial_participant"
  | "city_mismatch" | "boundary_conflict" | "unknown_member"
  | "status_mismatch" | "grift_risk" | "step_ahead_hit" | "mentorship_gap_fail"
  | "cross_class_guild" | "spend_mismatch" | "anxious_avoidant_trap" | "dunbar_saturated";

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
/**
 * Acceptance of a primed persona (see Oracle.evaluatePrimed). Mutable for sensitivity analysis
 * (packages/sim/experiments/primed-sweep.ts). `identity` is the accept rate of a probe-primed
 * persona once they learn who the others are. With `identityFit` set (opt-in, audit
 * matching-e2e-4), that rate is reached only when their perceived fit with the others is at least
 * `identityFit`; below it the rate falls off with the same sigmoid as an unprimed decision. Unset,
 * the identity stage is a flat `identity` whatever the fit (the model before 2026-10-08).
 */
export const PRIMED_MODEL: { met: number; partial: number; identity: number; identityFit?: number } = { met: 0.96, partial: 0.82, identity: 0.95 };
const GOOD_PAIR = 0.55, GOOD_GROUP_MEAN = 0.55, GOOD_GROUP_MIN = 0.4;

/** Opt-in oracle refinements (audit 2026-10-08). Off by default so existing runs and goldens are unchanged. */
export interface OracleOptions {
  /**
   * matching-e2e-8: a persona's accept/show draw is keyed by who is in it, the category and the
   * week, not by the proposal id, so asking the same people for the same thing again in the same
   * week gets the same answer (re-asking is not a fresh coin flip). The policy persona also
   * remembers a decline of the same people and category for DECLINE_MEMORY_DAYS (policy.ts).
   */
  stableDecisions?: boolean;
  /**
   * matching-e2e-9: show-up depends on logistics. Travel: nobody else lives or works in the
   * persona's area. Time: when the window is a specific time (6 hours or less), a slot in the
   * persona's sleep, a weekday busy block, or a weekday evening they are not free.
   */
  logistics?: boolean;
}

export class Oracle {
  private byId: Map<MemberId, Persona>;
  readonly coins = new Coins();
  constructor(personas: Persona[], private seed: number | string, private worldStart: number, readonly options: OracleOptions = {}) {
    for (const p of personas) ensurePersonaStrata(p, seed);
    this.byId = new Map(personas.map(p => [p.id, p]));
  }
  persona(id: MemberId) { return this.byId.get(id); }
  addPersona(p: Persona) { ensurePersonaStrata(p, this.seed); this.byId.set(p.id, p); }

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
  pairEnjoyment(
    a: Persona,
    b: Persona,
    category?: Category,
    ctx: { groupSize?: number; sharedGuild?: boolean; objective?: string } = {},
  ): { e: number; flags: OracleFlag[]; effGap?: number; complementA?: number; spendClash?: boolean } {
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
    if (!canBeMatched(A.trueAge) || !canBeMatched(B.trueAge) || A.scripted || B.scripted) {
      return { e, flags, effGap: 0, complementA, spendClash: false };
    }

    const SA = ensurePersonaStrata(a, this.seed);
    const SB = ensurePersonaStrata(b, this.seed);

    let stepAheadSweetSpot = false;
    const mentorCheck = evaluateMentorshipRungs(a, SA, b, SB, category, ctx.objective);
    if (mentorCheck === "hit_seeker") {
      stepAheadSweetSpot = true;
      e += 0.10;
      flags.push("step_ahead_hit");
    } else if (mentorCheck === "hit_mentor") {
      stepAheadSweetSpot = true;
      e += 0.08 * (0.4 + 0.6 * A.capacity);
      flags.push("step_ahead_hit");
    } else if (mentorCheck === "gap_too_wide_mentor") {
      e -= 0.24;
      flags.push("mentorship_gap_fail");
    } else if (mentorCheck === "gap_too_wide_seeker" || mentorCheck === "reverse_gap") {
      e -= 0.09;
      flags.push("mentorship_gap_fail");
    }

    const crossCapitalOk = isCrossCapitalEquilibrium(SA, SB);
    if (crossCapitalOk) e += 0.10;
    if (hasComplementaryCoCreation(SA, SB)) e += 0.08;

    const highTargetA = isHighStatusTarget(SA);
    const extractiveB = SB.extractionPropensity >= 0.45 || SB.discretionScore < 0.52;
    if (highTargetA && extractiveB) {
      e = Math.min(e, 0.08) - 0.25;
      flags.push("grift_risk");
    } else if (SA.extractionPropensity < 0.35 && SB.extractionPropensity >= 0.58) {
      e -= 0.22 * SB.extractionPropensity;
      if (isHighStatusTarget(SB)) flags.push("grift_risk");
    }

    const spendA = SPEND_TIERS.indexOf(SA.spendComfortTier);
    const spendB = SPEND_TIERS.indexOf(SB.spendComfortTier);
    const obj = (ctx.objective ?? "").toLowerCase();
    const highCostVenue = /\b(sailing|wine|tasting|steakhouse|yacht|fine dining|omakase|cocktails)\b/.test(obj)
      || (/\bdinner\b/.test(obj) && (spendB >= 3 || category === "professional"));
    const paidOuting = highCostVenue || /\b(dinner|drinks|bar|theater|concert|show)\b/.test(obj);
    const spendClash = !crossCapitalOk && (!rel || rel.type === "ex") && (
      (SA.spendComfortTier === "free" && (highCostVenue || (paidOuting && spendB >= 3))) ||
      (SA.spendComfortTier === "low" && highCostVenue && spendB >= 3)
    );
    if (spendClash) {
      e -= 0.18;
      flags.push("spend_mismatch");
    } else if (category !== "romance" && Math.abs(spendA - spendB) <= 1) {
      e += 0.02;
    }
    if (ctx.sharedGuild && !spendClash) {
      e += category === "romance" ? 0.05 : 0.06;
    }

    const tierA = verticalTier(SA, category);
    const tierB = verticalTier(SB, category);
    const rawGap = tierA - tierB;
    const gapScale = rel && rel.type !== "ex" ? 0
      : crossCapitalOk || stepAheadSweetSpot ? 0.15
      : ctx.sharedGuild && !spendClash ? 0.25
      : (category === "social" || category === "hobby") && !highTargetA ? 0.75
      : 1;
    const effGap = rawGap * gapScale;
    if (Math.abs(effGap) > (category === "romance" ? 0.30 : 0.36)) flags.push("status_mismatch");
    const cliffStart = category === "romance"
      ? (highTargetA ? 0.16 : 0.20)
      : category === "professional" || highTargetA ? 0.26 : 0.34;
    if (effGap > cliffStart) {
      e -= (category === "romance" ? 0.42 : 0.36) * (effGap - cliffStart);
    }

    if (category === "romance") {
      if ((SA.attachmentStyle === "anxious" && SB.attachmentStyle === "avoidant")
          || (SA.attachmentStyle === "avoidant" && SB.attachmentStyle === "anxious")) {
        e -= 0.16;
        flags.push("anxious_avoidant_trap");
      } else if (SA.attachmentStyle !== "secure" && SB.attachmentStyle !== "secure") {
        e -= 0.03;
      }
      e += SA.humorRegister.some(h => SB.humorRegister.includes(h)) ? 0.012 : -0.010;
      if (SA.activeTransitions.some(t => SB.activeTransitions.includes(t))) e += 0.02;
      if ((ctx.groupSize ?? 2) === 2) {
        const dGap = Math.abs(SA.depthPreference - SB.depthPreference);
        if (dGap > 0.55) e -= 0.035;
        else if (dGap <= 0.18) e += 0.008;
      }
    } else {
      if (SA.humorRegister.some(h => SB.humorRegister.includes(h))) e += 0.03;
      if (SA.activeTransitions.some(t => SB.activeTransitions.includes(t))) e += 0.04;
      if ((ctx.groupSize ?? 2) === 2 && Math.abs(SA.depthPreference - SB.depthPreference) > 0.68) e -= 0.04;
    }
    if (A.flakiness <= 0.08 && B.flakiness >= 0.28) e -= 0.06;

    return { e, flags, effGap, complementA, spendClash };
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
    return this.score(prop, ctx).verdict;
  }

  /** evaluate() plus each participant's perceived fit (what they can judge before meeting). */
  private score(prop: OracleProposal, ctx: { recentAsks?: Record<MemberId, number> }): { verdict: OracleVerdict; perceived: Record<MemberId, number> } {
    const ps = prop.participants.map(id => this.byId.get(id));
    const flags = new Set<OracleFlag>();
    if (ps.some(p => !p)) flags.add("unknown_member");
    const at = prop.window?.start ?? this.worldStart;
    // Intent liveness (persona.ts): judge on the wants each persona still holds at `at`. A lapsed
    // want never counts; a held want counts whether or not the Network's intent record is live.
    const people = ps.filter((p): p is Persona => !!p).map(p => withLiveDesires(p, at));
    // Presence changes at trip-day boundaries. The group must share the city at one instant.
    const presenceTimes = [at];
    if (people.some(p => p.hidden.trips.length > 0)) {
      const end = Math.min(prop.window?.end ?? at, at + 7 * DAY);
      const nextDay = this.worldStart + (Math.floor((at - this.worldStart) / DAY) + 1) * DAY;
      for (let t = nextDay; t < end; t += DAY) presenceTimes.push(t);
    }
    if (!presenceTimes.some(t => people.every(p => this.presentIn(p, prop.city, t)))) flags.add("city_mismatch");
    // Minors policy: checked over every participant, not only per pair, so a one-person
    // proposal (growth ask, relay) involving a minor is flagged too.
    if (people.some(p => p.hidden.trueAge < 18)) flags.add("minor_included");
    const category = this.categoryOf(prop);
    const groupSize = people.length;
    const allAdults = people.every(p => canBeMatched(p.hidden.trueAge)) && !people.some(p => p.hidden.scripted);
    const strataMap = new Map<MemberId, StrataSignals>(people.map(p => [p.id, ensurePersonaStrata(p, this.seed)]));
    const sharedGuild = allAdults && isSharedPurposeGuild(people, strataMap, category, prop.objective);

    const out: Record<MemberId, ParticipantOutcome> = {};
    const perceivedBy: Record<MemberId, number> = {};
    for (const a of people) {
      const SA = strataMap.get(a.id)!;
      const others = people.filter(o => o.id !== a.id);
      let e = 0, chemSum = 0, gapSum = 0, maxComp = 0, minPairSys = Infinity, anySpendClash = false, maxOtherExtract = 0;
      for (const b of others) {
        const SB = strataMap.get(b.id)!;
        const pe = this.pairEnjoyment(a, b, category, { groupSize, sharedGuild, objective: prop.objective });
        pe.flags.forEach(f => flags.add(f));
        // Pair noise is stable for the pair (true chemistry), not per proposal.
        const chem = new Rng(hash32(this.seed, "chem", ...[a.id, b.id].sort())).normal(0, PAIR_CHEMISTRY_SD);
        e += pe.e + chem; chemSum += chem;
        gapSum += pe.effGap ?? 0;
        maxComp = Math.max(maxComp, pe.complementA ?? 0);
        minPairSys = Math.min(minPairSys, pe.e);
        if (pe.spendClash) anySpendClash = true;
        maxOtherExtract = Math.max(maxOtherExtract, SB.extractionPropensity);
      }
      e = others.length ? e / others.length : 0;
      const chemMean = others.length ? chemSum / others.length : 0;
      const meanEffGap = others.length ? gapSum / others.length : 0;
      if (allAdults && groupSize >= 3 && others.length >= 2) {
        if (maxOtherExtract >= 0.62 && SA.extractionPropensity < 0.40) {
          e -= 0.22;
          if (people.some(x => isHighStatusTarget(strataMap.get(x.id)!))) flags.add("grift_risk");
        }
        if (minPairSys < 0.20) {
          e -= 0.28 * (0.20 - minPairSys);
        }
      }
      // Group-size fit: introverts dislike big groups; extroverts are fine either way.
      const sizeDiff = Math.max(0, groupSize - a.hidden.preferredGroupSize);
      e -= 0.06 * sizeDiff * (1 - a.hidden.socialEnergy);
      if (groupSize === 2 && a.hidden.boundaries.includes("prefers groups over one-on-one with strangers")
          && !a.relationships.some(r => others.some(o => o.id === r.to))) { e -= 0.15; flags.add("boundary_conflict"); }
      const present = presenceTimes.some(t => this.presentIn(a, prop.city, t));
      const enjoyment = clamp01(e);

      const r = new Rng(this.decisionKey("decide", prop, a.id, category, at));
      // People judge an invitation from what they can see (the systematic part + noise),
      // not from the chemistry they'll only discover by meeting.
      const perceived = perceivedBy[a.id] = enjoyment - chemMean + r.normal(0, 0.1);
      const fatigue = Math.pow(0.85, Math.max(0, (ctx.recentAsks?.[a.id] ?? 0) - 1));
      const sameArea = others.some(o => o.routine.homeArea === a.routine.homeArea) ? 1.05 : 1;
      const acceptCliff = category === "romance"
        ? (isHighStatusTarget(SA) ? 0.16 : 0.20)
        : category === "professional" || isHighStatusTarget(SA) ? 0.26 : 0.34;
      const statusAcceptMult = !allAdults ? 1
        : meanEffGap > acceptCliff
          ? (category === "romance"
              ? Math.exp(-2.8 * (meanEffGap - acceptCliff))
              : Math.exp(-3.2 * Math.pow(meanEffGap - acceptCliff, 2)))
          : category === "professional" && meanEffGap < -0.10 && meanEffGap >= -0.42 ? 1.10 : 1;
      const griftAcceptMult = allAdults && isHighStatusTarget(SA) && maxOtherExtract >= 0.50 ? 0.45 : 1;
      const spendAcceptMult = allAdults && anySpendClash ? 0.72 : 1;
      const dunbarSaturated = allAdults && !SA.dunbarOpenSlots.sympathy15 && !SA.dunbarOpenSlots.affinity50
        && (category === "social" || !category) && maxComp < 0.55;
      if (dunbarSaturated) flags.add("dunbar_saturated");
      const dunbarAcceptMult = dunbarSaturated ? 0.75 : 1;

      let acceptProb = sigmoid((perceived - 0.5) * 7) * (0.3 + 0.7 * a.hidden.capacity) * fatigue * sameArea
        * statusAcceptMult * griftAcceptMult * spendAcceptMult * dunbarAcceptMult;
      if (!present) acceptProb *= 0.15;
      if (a.hidden.adversarial && ["spammer", "scammer", "harasser"].includes(a.hidden.adversarial)) acceptProb = 0.95;
      if (allAdults && category !== "romance" && (SA.adversarySubkind === "grifter_pitcher" || SA.adversarySubkind === "clout_chaser")) {
        acceptProb = others.some(o => isHighStatusTarget(strataMap.get(o.id)!)) ? Math.max(acceptProb, 0.90) : acceptProb * 0.85;
      }
      acceptProb = clamp01(acceptProb);
      const wouldAccept = r.next() < acceptProb;
      const logistics = this.options.logistics ? this.logistics(a, others, prop) : 1;
      const showProb = clamp01((1 - a.hidden.flakiness * (groupSize > 2 ? 1.3 : 1)) * (present ? 1 : 0.1) * logistics);
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
    if (sharedGuild && people.length >= 3) {
      const econs = people.map(p => strataMap.get(p.id)!.economicCapital);
      if (Math.max(...econs) - Math.min(...econs) >= 0.35 && !flags.has("spend_mismatch")) flags.add("cross_class_guild");
    }
    return { verdict: { proposalId: prop.id, participants: out, compatible, unsafe, quality: round3(quality), minEnjoyment: round3(minEnjoyment), flags: [...flags] }, perceived: perceivedBy };
  }

  private decisionKey(kind: string, prop: OracleProposal, who: MemberId, category: Category | undefined, at: number): number {
    const week = Math.floor((at - this.worldStart) / (7 * DAY));
    const meaning = `${kind}|${signature(prop.participants)}|${category ?? "-"}|w${week}|${who}`;
    return hash32(this.seed, this.options.stableDecisions ? meaning : this.coins.key(meaning, prop.id));
  }

  /** Show-up multiplier from travel and the meeting time (OracleOptions.logistics). */
  private logistics(a: Persona, others: Persona[], prop: OracleProposal): number {
    const near = others.some(o => [o.routine.homeArea, o.routine.workArea].some(x => x === a.routine.homeArea || x === a.routine.workArea));
    let f = near ? 1 : a.archetype === "busy_parent" ? 0.85 : 0.93;
    const w = prop.window;
    if (w && w.end - w.start <= 6 * 60 * 60 * 1000) {
      const lp = localParts(w.start, prop.city);
      const weekday = lp.weekday >= 1 && lp.weekday <= 5;
      if (!inHourWindow(lp.hour, [a.routine.wake, a.routine.sleep])) f *= 0.3;
      else if (weekday && a.routine.busyBlocks.some(b => lp.hour >= b[0] && lp.hour < b[1])) f *= 0.6;
      else if (weekday && lp.hour >= 17 && !a.routine.freeEvenings.includes(lp.weekday)) f *= 0.75;
    }
    return f;
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
    const week = Math.floor((q.at - this.worldStart) / (7 * DAY));
    const coin = this.coins.key(`probe|${personaId}|${q.category}|${q.kind ?? "-"}|w${week}`, `${q.key}|${personaId}`);
    const yes = new Rng(hash32(this.seed, coin)).next() < yesProb;
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
        else if (def.pool && b.hidden.desires.some(o => (at === undefined || desireLive(o, at)) && desireById.get(o.id)?.pool === def.pool)) s = 0.85;
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
   * the probe; only identity is new, so accept with PRIMED_MODEL.identity (with
   * PRIMED_MODEL.identityFit set, scaled down when these people seem a poor fit). Ask-primed: their time and
   * appetite are settled, so their decision rests on whether these people deliver what they wanted.
   * MODELING ASSUMPTIONS (docs/network.md, PRIMED_MODEL): ask-primed members accept with
   * PRIMED_MODEL.met when the others meet one of their wants in the category (desireMet >= 0.8),
   * PRIMED_MODEL.partial for a partial fit (>= 0.45), otherwise the unprimed perceived-fit sigmoid.
   * Exes and absence still sink it. Enjoyment and show-up are unchanged (chemistry stays honest).
   */
  evaluatePrimed(prop: OracleProposal, primed: MemberId[] | Record<MemberId, "ask" | "probe">, ctx: { recentAsks?: Record<MemberId, number> } = {}): OracleVerdict {
    const { verdict: v, perceived } = this.score(prop, ctx);
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
      else if (basis[a.id] === "probe") {
        const fit = (x: number) => sigmoid((x - 0.5) * 7), bar = PRIMED_MODEL.identityFit;
        pr = PRIMED_MODEL.identity * (bar === undefined ? 1 : Math.min(1, fit(perceived[a.id] ?? 0) / fit(bar)));
      }
      else if (met >= 0.8) pr = PRIMED_MODEL.met;
      else if (met >= 0.45) pr = PRIMED_MODEL.partial;
      else pr = sigmoid((out.enjoyment - 0.5) * 7) * 0.9;
      if (v.flags.includes("city_mismatch") && !this.presentIn(a, prop.city, prop.window?.start ?? this.worldStart)) pr *= 0.15;
      const r = new Rng(this.decisionKey("primed", prop, a.id, category, prop.window?.start ?? this.worldStart));
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
    const cities = new Map(ps.map(p => [p.id, new Set(
      [p.homeCity, p.secondaryCity, ...p.hidden.trips.map(tr => tr.city)]
        .filter((city): city is City => city !== undefined && this.presentIn(p, city, at)),
    )]));
    const res: { a: MemberId; b: MemberId; quality: number }[] = [];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i]!, b = ps[j]!;
      if (a.relationships.some(r => r.to === b.id)) continue; // already know each other
      const sharedCity = [...cities.get(a.id)!].find(city => cities.get(b.id)!.has(city));
      if (!sharedCity) continue;
      const v = this.evaluate({ id: `latent:${a.id}:${b.id}`, kind: "intro", participants: [a.id, b.id], city: sharedCity, window: { start: at, end: at } });
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

function verticalTier(s: StrataSignals, category?: Category): number {
  if (category === "romance") {
    const att01 = clamp01(0.5 + (s.trueAttractiveness?.overall ?? 0) * 0.22);
    return 0.45 * att01 + 0.20 * s.culturalEmbodied + 0.15 * s.economicCapital + 0.12 * s.symbolicPublicity + 0.08 * s.socialCapital;
  }
  if (category === "professional") {
    return 0.35 * s.peerPrestige + 0.30 * s.economicCapital + 0.20 * s.socialCapital + 0.15 * s.culturalInstitutional;
  }
  return s.compositeTier;
}

function isHighStatusTarget(s: StrataSignals): boolean {
  return s.symbolicPublicity >= 0.68 || s.economicCapital >= 0.85
    || s.stratumArchetype === "uhnw_mogul" || s.stratumArchetype === "famous_creator";
}

function isCrossCapitalEquilibrium(sa: StrataSignals, sb: StrataSignals): boolean {
  if (sa.extractionPropensity > 0.25 || sb.extractionPropensity > 0.25) return false;
  if (sa.discretionScore < 0.70 || sb.discretionScore < 0.70) return false;
  return (sa.economicCapital >= 0.78 && (sb.peerPrestige >= 0.74 || sb.culturalEmbodied >= 0.80))
    || (sb.economicCapital >= 0.78 && (sa.peerPrestige >= 0.74 || sa.culturalEmbodied >= 0.80));
}

function hasComplementaryCoCreation(sa: StrataSignals, sb: StrataSignals): boolean {
  for (const ga of sa.exchangeGoals) {
    if (ga.connectionType !== "creative_cocreation") continue;
    for (const gb of sb.exchangeGoals) {
      if (gb.connectionType === "creative_cocreation" && gb.domain === ga.domain && ga.complementaryRoles.includes(gb.role)) return true;
    }
  }
  return false;
}

type MentorshipOutcome = "none" | "hit_seeker" | "hit_mentor" | "gap_too_wide_seeker" | "gap_too_wide_mentor" | "reverse_gap";

function evaluateMentorshipRungs(
  a: Persona,
  sa: StrataSignals,
  b: Persona,
  sb: StrataSignals,
  category?: Category,
  objective?: string,
): MentorshipOutcome {
  const mentorDesireIds = new Set(["ai_mentor", "pitch_feedback", "learn_sailing"]);
  const objMentorship = /\b(mentor|advice|feedback|learn to sail)\b/i.test(objective ?? "");
  const checkOneWay = (seeker: Persona, ss: StrataSignals, mentor: Persona, sm: StrataSignals): { delta: number } | undefined => {
    const d = seeker.hidden.desires.find(x => mentorDesireIds.has(x.id));
    const goal = ss.exchangeGoals.find(g => g.connectionType === "step_ahead_mentorship" && g.direction === "seeks");
    if (!d && !goal) return undefined;
    if (category && category !== "professional" && category !== "growth" && category !== "help" && !objMentorship) return undefined;
    const dom = d ? domainOfTag(d.id) : goal!.domain;
    const mRung = sm.domainRungs[dom] ?? (mentor.hidden.skills.some(sk => domainOfTag(sk) === dom) ? 6.0 : undefined);
    if (mRung === undefined) return undefined;
    const sRung = ss.domainRungs[dom] ?? 2.5;
    return { delta: mRung - sRung };
  };
  const aSeeks = checkOneWay(a, sa, b, sb);
  if (aSeeks) {
    if (aSeeks.delta >= 1.0 && aSeeks.delta <= 2.8) return "hit_seeker";
    if (aSeeks.delta >= 4.8) return "gap_too_wide_seeker";
    if (aSeeks.delta <= 0 && objMentorship) return "reverse_gap";
  }
  const bSeeks = checkOneWay(b, sb, a, sa);
  if (bSeeks) {
    if (bSeeks.delta >= 1.0 && bSeeks.delta <= 2.8) return "hit_mentor";
    if (bSeeks.delta >= 4.8) return "gap_too_wide_mentor";
  }
  return "none";
}

const GUILD_TAGS = new Set([
  "climbing", "running", "hiking", "cycling", "tennis", "pickleball", "basketball",
  "ceramics", "painting", "photography", "writing", "rock_music", "jazz", "board_games",
  "chess", "volunteering", "urbanism", "gardening", "yoga", "cooking",
]);

function isSharedPurposeGuild(
  people: Persona[],
  strataMap: Map<MemberId, StrataSignals>,
  category?: Category,
  objective?: string,
): boolean {
  if (people.length < 3 || people.length > 6) return false;
  if (category === "romance" || category === "professional") return false;
  if (people.some(p => !canBeMatched(p.hidden.trueAge) || (strataMap.get(p.id)?.extractionPropensity ?? 0) >= 0.55)) return false;
  const need = Math.ceil(people.length * 0.6);
  const tagCounts = new Map<string, number>();
  for (const p of people) {
    for (const t of p.hidden.interests) if (GUILD_TAGS.has(t)) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  if ([...tagCounts.values()].some(c => c >= need)) return true;
  const o = (objective ?? "").toLowerCase();
  return [...GUILD_TAGS].some(t => o.includes(t.replace(/_/g, " ")));
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const round3 = (x: number) => Math.round(x * 1000) / 1000;
