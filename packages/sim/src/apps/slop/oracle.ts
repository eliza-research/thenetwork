// slop.date ground-truth oracle (pure, offline, deterministic in its seed). Reads hidden truth. The
// matcher under test never sees it; the harness and the metrics compare the matcher against it.
//
// Model (docs/results/2026-10-08-slop-world.md, "Oracle"):
//   perceived latent  L(a->b) = c0 + warmth_a + wD * D_b + wT * taste_a . traits_b + ageFit_a(b) - wS * D_a
//                     (actor effect, partner effect = desirability hierarchy, revealed "type", selectivity)
//   after meeting     L'(a->b) = L(a->b) + chem(a,b) + side noise; chem is SYMMETRIC per pair, seeded,
//                     and unknowable before the date (Joel, Eastwick & Finkel 2017)
//   enjoyment         e_a = sigmoid(L'(a->b)) x compat_a(b) x activityFit_a
//   date quality      sqrt(e_a x e_b)  (attraction both ways x compatibility x chemistry)
//   good date         min(e_a, e_b) >= GOOD;  second date: both e >= WANT_SECOND, then logistics
// Soft labels pGood / pSecond: Monte Carlo over the chemistry draw, as judge v2's pGood
// (packages/evals/src/recDataset.ts). Everything else in the label is deterministic.
import { canBeMatched, type MemberId } from "@thenetwork/core";
import { Rng, hash32, clamp01 } from "@thenetwork/core";
import { zipMiles, zipInfo, type SlopCity } from "./geo.ts";
import { SLOTS, citiesInWeek, violates, zipIn, type DateActivity, type SlopPersona } from "./persona.ts";
import { bodyTerm, type BodyTypeModel } from "./bodyType.ts";

export const ORACLE_PARAMS = {
  c0: -1.25, wDesire: 0.9, wTaste: 1.8, wSelect: 0.4, ageOutPerYear: 0.3,
  /** SD of the symmetric pair chemistry (logit scale) and of each side's own noise on the night. */
  chemSd: 0.9, sideSd: 0.35,
  /** Meeting in person after both said yes lifts the latent (profile-view likes are rarer than enjoyed dates). */
  dateLift: 1.6,
  goodDate: 0.4, wantSecond: 0.5, secondLogistics: 0.85,
  dealbreaker: 0.2, goalClash: 0.6, goalUnsure: 0.85,
  /** P(back out after the reveal) = backout x (1 - att)^2 (seeing who it is; desirability matters here). */
  backout: 0.12,
  /** Attendance at a time the member is not actually free (picked "yes, not those times"). */
  notFreeShow: 0.3,
  /** Probe answer model. */
  receptivityAfterLikedDate: 0.6, fatigue: 0.8, activityMiss: 0.75, askPrimed: 1.35, sharedFactLift: 1.1, notPresent: 0.05,
};

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const pairKey = (a: MemberId, b: MemberId) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export type HarmKind = "offplatform_move" | "money_ask" | "financial_loss" | "catfish_reveal" | "harassment" | "deception" | "minor_contact";
export interface HarmRisk { kind: HarmKind; victim: MemberId; offender: MemberId; prob: number; when: "reveal" | "date" }

export interface ProbeContext {
  week: number; city: SlopCity; activity: DateActivity;
  /** The member asked the agent for a date in the last 7 days ("ask priming"). */
  asked?: boolean;
  /** The member had a date they liked in the last 2 weeks (receptivity; Rios, Saban & Zheng). */
  recentLikedDate?: boolean;
  /** Probes already received this week before this one. */
  probesThisWeek?: number;
  /** The probe's one shareable fact matches an interest of this member. */
  sharedFactMatch?: boolean;
  /**
   * Sensitivity arm (PRD open question "photos in probes?"): the probe shows the other person's
   * photo, so the answer depends on a noisy view of this member's attraction to them.
   */
  photo?: { of: MemberId; noiseSd: number };
}

export interface DateOutcome { ea: number; eb: number; quality: number; good: boolean; wantsSecondA: boolean; wantsSecondB: boolean; bothWantSecond: boolean }

export class SlopOracle {
  readonly byId: Map<MemberId, SlopPersona>;
  /** Iteration 4: body-type preferences in attraction (bodyType.ts); absent = not modelled. */
  constructor(personas: readonly SlopPersona[], readonly seed: number | string, readonly bodyTypes?: BodyTypeModel) {
    this.byId = new Map(personas.map(p => [p.id, p]));
  }
  p(id: MemberId): SlopPersona {
    const x = this.byId.get(id);
    if (!x) throw new Error(`unknown persona ${id}`);
    return x;
  }

  // ------------------------------------------------------------------ filters (stated, both ways)
  /**
   * Both people's STATED preferences include each other (gender, age range, location scope), both
   * are matchable by stated age (policy), and they can share a city. This is the filter every
   * matcher must respect (consent). Hidden truth is not used, so a lying minor passes it.
   */
  statedMutual(a: SlopPersona, b: SlopPersona, week?: number): boolean {
    if (a.id === b.id) return false;
    const A = a.stated, B = b.stated;
    if (!canBeMatched(A.claimedAge) || !canBeMatched(B.claimedAge)) return false;
    if (!A.seeks.includes(B.matchGender) || !B.seeks.includes(A.matchGender)) return false;
    if (B.claimedAge < A.ageRange[0] || B.claimedAge > A.ageRange[1] || A.claimedAge < B.ageRange[0] || A.claimedAge > B.ageRange[1]) return false;
    return sharedCities(a, b, week).length > 0;
  }
  /** One side: b is inside a's stated filters (gender, age range, a city both date in within a's distance). */
  statedAccepts(a: SlopPersona, b: SlopPersona, week?: number): boolean {
    const A = a.stated, B = b.stated;
    if (!canBeMatched(A.claimedAge) || !canBeMatched(B.claimedAge)) return false;
    if (!A.seeks.includes(B.matchGender) || B.claimedAge < A.ageRange[0] || B.claimedAge > A.ageRange[1]) return false;
    return sharedCities(a, b, week, "a").length > 0;
  }
  /** statedMutual and safe by hidden truth (true adults, no adversary): the oracle-optimal pool. */
  trueEligible(a: SlopPersona, b: SlopPersona, week?: number): boolean {
    return this.statedMutual(a, b, week) && isSafe(a) && isSafe(b);
  }

  // ------------------------------------------------------------------ attraction and compatibility
  /** Perceived (pre-meeting) attraction latent of a toward b, logit scale. */
  latent(a: SlopPersona, b: SlopPersona): number {
    const P = ORACLE_PARAMS, A = a.hidden, B = b.hidden;
    let taste = 0;
    for (let i = 0; i < A.taste.length; i++) taste += A.taste[i]! * B.traits[i]!;
    const age = b.stated.claimedAge; // what a believes; a lying minor looks their claimed age
    const out = age < A.ageRange[0] ? A.ageRange[0] - age : age > A.ageRange[1] ? age - A.ageRange[1] : 0;
    const genderOk = A.seeks.includes(B.matchGender) ? 0 : -4;
    const body = this.bodyTypes ? bodyTerm(a.id, b.id, this.bodyTypes) : 0;
    return P.c0 + A.warmth + P.wDesire * B.desirability + P.wTaste * taste - P.ageOutPerYear * out - P.wSelect * A.desirability + genderOk + body;
  }
  /** P(a likes b's profile) before meeting. */
  attraction(a: SlopPersona, b: SlopPersona): number { return sigmoid(this.latent(a, b)); }

  /** a's compatibility with b (values, goals, dealbreakers, shared interests), 0..1. */
  compat(a: SlopPersona, b: SlopPersona): number {
    const P = ORACLE_PARAMS, A = a.hidden, B = b.hidden;
    let c = 1;
    for (const d of A.dealbreakers) if (violates(d, B.values)) c *= P.dealbreaker;
    if ((A.goal === "casual" && B.goal === "long_term") || (A.goal === "long_term" && B.goal === "casual")) c *= P.goalClash;
    else if (A.goal !== B.goal) c *= P.goalUnsure;
    const va = A.values, vb = B.values;
    if ((va.smoking === "never" && vb.smoking === "regular")) c *= 0.8;
    if ((va.drinking === "never" && vb.drinking === "regular")) c *= 0.85;
    if (Math.abs(va.religionImportance - vb.religionImportance) >= 2) c *= 0.85;
    if ((va.politics === "left" && vb.politics === "right") || (va.politics === "right" && vb.politics === "left")) c *= 0.75;
    if (A.goal === "long_term" && ((va.wantsKids === "yes" && vb.wantsKids === "no") || (va.wantsKids === "no" && vb.wantsKids === "yes"))) c *= 0.7;
    const shared = A.interests.filter(t => B.interests.includes(t)).length;
    c *= shared >= 2 ? 1 : shared === 1 ? 0.95 : 0.88;
    return c;
  }

  /** Realized symmetric pair chemistry for this world (logit scale). chemistry(a,b) === chemistry(b,a). */
  chemistry(a: MemberId, b: MemberId): number {
    return new Rng(hash32(this.seed, "chem", pairKey(a, b))).normal(0, ORACLE_PARAMS.chemSd);
  }

  /**
   * Outcome of a date between a and b. `draw` selects the chemistry: undefined = this world's
   * realized chemistry; a number k = the k-th Monte Carlo draw (soft labels).
   */
  dateOutcome(aId: MemberId, bId: MemberId, activity?: DateActivity, draw?: number): DateOutcome {
    const P = ORACLE_PARAMS, a = this.p(aId), b = this.p(bId);
    const key = pairKey(aId, bId);
    const r = draw === undefined ? new Rng(hash32(this.seed, "night", key)) : new Rng(hash32(this.seed, "mc", draw, key));
    const chem = draw === undefined ? this.chemistry(aId, bId) : r.normal(0, P.chemSd);
    const fit = (x: SlopPersona) => (activity && !x.hidden.activities.includes(activity) ? 0.92 : 1);
    // Sides drawn in id order so the outcome does not depend on argument order.
    const [n1, n2] = [r.normal(0, P.sideSd), r.normal(0, P.sideSd)];
    const na = aId < bId ? n1 : n2, nb = aId < bId ? n2 : n1;
    let ea = sigmoid(this.latent(a, b) + P.dateLift + chem + na) * this.compat(a, b) * fit(a);
    let eb = sigmoid(this.latent(b, a) + P.dateLift + chem + nb) * this.compat(b, a) * fit(b);
    // Adversaries ruin the date for the other person (harm is counted separately).
    if (b.hidden.adversary === "catfish" || b.hidden.adversary === "harasser" || b.hidden.adversary === "romance_scammer") ea *= 0.2;
    if (a.hidden.adversary === "catfish" || a.hidden.adversary === "harasser" || a.hidden.adversary === "romance_scammer") eb *= 0.2;
    ea = clamp01(ea); eb = clamp01(eb);
    const wa = ea >= P.wantSecond, wb = eb >= P.wantSecond;
    return { ea, eb, quality: Math.sqrt(ea * eb), good: Math.min(ea, eb) >= P.goodDate, wantsSecondA: wa, wantsSecondB: wb, bothWantSecond: wa && wb };
  }

  /** Soft labels over the chemistry draw (K Monte Carlo draws): P(good date), P(second date | date). */
  softLabel(a: MemberId, b: MemberId, activity?: DateActivity, draws = 64): { pGood: number; pSecond: number; meanQuality: number } {
    if (!isSafe(this.p(a)) || !isSafe(this.p(b))) return { pGood: 0, pSecond: 0, meanQuality: 0 };
    let g = 0, s = 0, q = 0;
    for (let k = 0; k < draws; k++) {
      const o = this.dateOutcome(a, b, activity, k);
      if (o.good) g++;
      if (o.bothWantSecond) s++;
      q += o.quality;
    }
    return { pGood: g / draws, pSecond: (s / draws) * ORACLE_PARAMS.secondLogistics, meanQuality: q / draws };
  }

  // ------------------------------------------------------------------ probe-first funnel
  /** Is the persona in `city` during `week` (hidden schedule)? */
  presentIn(p: SlopPersona, city: SlopCity, week: number): boolean { return citiesInWeek(p, week).includes(city); }

  /** Weekly appetite: baseline plus a stable weekly swing. */
  weekAppetite(p: SlopPersona, week: number): number {
    return clamp01(p.hidden.appetite + new Rng(hash32(this.seed, "appetite", p.id, week)).normal(0, 0.15));
  }

  /**
   * P(yes) to an anonymous date probe ("someone you might like to go on a date with, drinks near
   * the Mission, Thu 7pm or Sat 2pm?"). Nobody is named, so it is about appetite, timing,
   * receptivity, the activity and place, not the other person (their desirability shows at the reveal).
   */
  probeYesProb(id: MemberId, c: ProbeContext): number {
    const P = ORACLE_PARAMS, p = this.p(id), H = p.hidden;
    if (H.adversary === "romance_scammer") return 0.95;
    if (H.adversary === "harasser" || H.adversary === "catfish") return 0.88;
    let y = this.weekAppetite(p, c.week);
    if (c.recentLikedDate) y *= P.receptivityAfterLikedDate;
    y *= Math.pow(P.fatigue, Math.max(0, c.probesThisWeek ?? 0));
    if (!H.activities.includes(c.activity)) y *= P.activityMiss;
    if (c.sharedFactMatch) y *= P.sharedFactLift;
    // Adults only: a photo is never shown to or of anyone under 18 (claimed age).
    if (c.photo && canBeMatched(p.stated.claimedAge) && canBeMatched(this.p(c.photo.of).stated.claimedAge)) y *= this.photoFactor(id, c.photo.of, c.photo.noiseSd);
    if (c.asked) y = Math.min(0.95, y * P.askPrimed);
    if (!this.presentIn(p, c.city, c.week)) y *= P.notPresent;
    return clamp01(y);
  }

  /**
   * Photo in the probe: the member's first impression of b = their attraction latent plus a noise
   * term fixed per (member, other) pair (SD `noiseSd`). The yes multiplier 0.25 + 2.5 x sigmoid(...)
   * averages about 1 over the population, so photos re-sort yeses toward attraction without changing
   * the overall yes rate much.
   */
  photoFactor(a: MemberId, b: MemberId, noiseSd: number): number {
    const eps = new Rng(hash32(this.seed, "photo", a, b)).normal(0, noiseSd);
    return 0.25 + 2.5 * sigmoid(this.latent(this.p(a), this.p(b)) + eps);
  }

  /** Is the persona truly free in slot `s` of `week` (hidden availability, seeded per week)? */
  free(id: MemberId, week: number, slot: number): boolean {
    const p = this.p(id), av = p.hidden.availability;
    const r = new Rng(hash32(this.seed, "avail", id, week, slot));
    if (r.next() < av.shock) return false;
    return r.next() < av.slotFree[slot]!;
  }
  freeSlots(id: MemberId, week: number, options: readonly number[]): number[] { return options.filter(s => this.free(id, week, s)); }

  /** P(a backs out after the booked-plan reveal shows who b is). */
  backoutProb(a: SlopPersona, b: SlopPersona): number {
    if (a.hidden.adversary) return 0.02;
    return ORACLE_PARAMS.backout * (1 - this.attraction(a, b)) ** 2;
  }
  /** P(shows up) to a booked date; `free` = truly free at that time. */
  showProb(p: SlopPersona, free: boolean): number {
    return (1 - p.hidden.flakiness) * (free ? 1 : ORACLE_PARAMS.notFreeShow);
  }

  /**
   * P(the first date happens) for a probe-first booked-plan flow: both answer and say yes, a
   * common free slot among `options` (else the agent books its best guess), neither backs out
   * at the reveal, both show. Probes in the same week as context `c`.
   */
  pDateHappens(aId: MemberId, bId: MemberId, c: ProbeContext, options: readonly number[], cb: ProbeContext = c): number {
    const a = this.p(aId), b = this.p(bId);
    const ya = a.hidden.replyProb * this.probeYesProb(aId, c), yb = b.hidden.replyProb * this.probeYesProb(bId, cb);
    const both = options.filter(s => this.free(aId, c.week, s) && this.free(bId, c.week, s));
    const showA = this.showProb(a, both.length > 0), showB = this.showProb(b, both.length > 0);
    return ya * yb * (1 - this.backoutProb(a, b)) * (1 - this.backoutProb(b, a)) * showA * showB;
  }

  /** P(mutual yes on the probe) for the pair in this context. */
  pMutualProbe(aId: MemberId, bId: MemberId, c: ProbeContext): number {
    return this.p(aId).hidden.replyProb * this.probeYesProb(aId, c) * this.p(bId).hidden.replyProb * this.probeYesProb(bId, c);
  }

  // ------------------------------------------------------------------ safety
  /** Harm risks if a and b are revealed to each other (and if the date happens). */
  harms(aId: MemberId, bId: MemberId): HarmRisk[] {
    const out: HarmRisk[] = [];
    const one = (off: SlopPersona, vic: SlopPersona) => {
      switch (off.hidden.adversary) {
        case "romance_scammer":
          out.push({ kind: "offplatform_move", victim: vic.id, offender: off.id, prob: 0.9, when: "reveal" });
          out.push({ kind: "money_ask", victim: vic.id, offender: off.id, prob: 0.6, when: "reveal" });
          out.push({ kind: "financial_loss", victim: vic.id, offender: off.id, prob: 0.12, when: "reveal" });
          break;
        case "harasser": out.push({ kind: "harassment", victim: vic.id, offender: off.id, prob: 0.5, when: "reveal" }); break;
        case "catfish": out.push({ kind: "catfish_reveal", victim: vic.id, offender: off.id, prob: 0.9, when: "date" }); break;
        case "not_single": out.push({ kind: "deception", victim: vic.id, offender: off.id, prob: 0.3, when: "date" }); break;
      }
      if (off.hidden.isMinor) out.push({ kind: "minor_contact", victim: off.id, offender: vic.id, prob: 1, when: "reveal" });
    };
    const a = this.p(aId), b = this.p(bId);
    one(a, b); one(b, a);
    return out;
  }
}

/** True adult and not an adversary (hidden truth). */
export const isSafe = (p: SlopPersona) => !p.hidden.isMinor && !p.hidden.adversary;

/**
 * Cities where a and b could meet, by their STATED scopes and stated distances: a city both date
 * in (home, a multi-city scope, or a trip they told the agent about in `week`), with each other's
 * location in that city inside both radius limits.
 */
export function sharedCities(a: SlopPersona, b: SlopPersona, week?: number, side: "both" | "a" = "both"): SlopCity[] {
  const cityOf = (p: SlopPersona) => zipInfo.get(p.stated.homeZip)?.city ?? p.hidden.homeCity;
  const datesIn = (p: SlopPersona): SlopCity[] => {
    if (p.stated.scope.mode === "multi_city") return p.stated.scope.cities;
    const trips = week === undefined ? [] : p.hidden.presence.filter(x => x.city !== cityOf(p) && x.weeks.includes(week)).map(x => x.city);
    return [cityOf(p), ...trips];
  };
  const out: SlopCity[] = [];
  for (const c of datesIn(a)) {
    if (!datesIn(b).includes(c)) continue;
    const za = zipIn(a, c), zb = zipIn(b, c), d = zipMiles(za, zb);
    const lim = (p: SlopPersona) => (p.stated.scope.mode === "radius" ? p.stated.scope.miles : p.stated.maxMiles);
    if (d <= lim(a) && (side === "a" || d <= lim(b))) out.push(c);
  }
  return out;
}

export const SLOT_COUNT = SLOTS.length;
