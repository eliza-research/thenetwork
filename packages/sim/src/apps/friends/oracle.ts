// The friends.help oracle (pure and offline; the matcher never imports it). Every draw is keyed by
// h01(seed, ...), so outcomes are a function of (personas, seed, what was proposed).
//
//   P(yes to a probe)  this week's appetite x activity like x travel (vs tolerance) x group size
//                      comfort x window priming (a check-in that covers an option) x fatigue; a repeat
//                      or crew invite after a good time is more attractive; a yes picks the offered
//                      options the member is TRULY free for (hidden weekly availability).
//   P(attend | yes)    (1 - flakiness) x (free ? 1 : 0.3) x a long-trip penalty; bots never attend.
//   Enjoyment e_i      sigmoid(c0 + wA (like - 0.5) + mean_j [chem_ij + sim_ij + 0.4 likability_j]
//                      + warmth_i + balance(G) + wF bond_i - travel cost - size discomfort + noise),
//                      chem_ij ~ N(0, chemSd) symmetric and unknowable; bond_i = mean over the others
//                      of min(1, hours together / 10) with people i already enjoyed (repetition).
//                      Least misery: a meetup is "good" when min e_i >= 0.45 over real attendees.
//   See again (i->j)   sigmoid(kE (e_i - 0.55) + kC chem_ij + 1.5 sim_ij + 0.5 likability_j + 0.8 bond_ij); private.
//   Hours together     duration x (1 if <= 4 came, else 3 / (n - 1)) per pair, + 0.75 h lingering when both
//                      enjoyed it; plus hangouts the members arrange themselves (hidden): a pair with a
//                      mutual "see again" meets on its own with p = selfRate x min(1, meetups/2) x
//                      proximity x appetite (Adams: proximity and repeated unplanned interaction).
//   Friendship         pair hours cross Hall's thresholds: 50 casual friend, 90 friend, 200 close (Hall 2018).
//   Harms              romance seeker: unwanted advance on one attendee; MLM: sales pitch to everyone;
//                      harasser: one attendee harassed; bot: a fake account in the group thread; a lying
//                      minor in contact with adults. Victims report with p by kind -> hold + block.
import type { MemberId } from "@thenetwork/core";
import { activityById } from "@thenetwork/engine/src/packs/network/activities.ts";
import { hood, transitMinutes } from "@thenetwork/engine/src/packs/friends/index.ts";
import { h01, hoodOf, type AdversaryKind, type FriendsPersona } from "./persona.ts";

export const ORACLE_PARAMS = {
  c0: 0.35, wA: 2.0, chemSd: 0.55, sideSd: 0.35, wBal: 1.0, wF: 0.9, wTravel: 1.0,
  good: 0.45, positive: 0.6, kE: 6, kC: 1.4, seeAgainBias: -0.6,
  selfRate: 0.22, selfHours: 2.5, lingerHours: 0.75,
  /** Hall (2018): casual friend, friend, close friend. */
  hall: { casual: 50, friend: 90, close: 200 },
  backout: 0.04, travelNoise: 0.15,
};
export type OracleParams = typeof ORACLE_PARAMS;

export type HarmKind = "romantic_advance" | "sales_pitch" | "harassment" | "bot_contact" | "minor_contact";
export interface HarmEvent { kind: HarmKind; offender: MemberId; victim: MemberId; reported: boolean }
export const REPORT_P: Record<HarmKind, number> = { romantic_advance: 0.5, sales_pitch: 0.35, harassment: 0.7, bot_contact: 0.25, minor_contact: 0.2 };

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface ProbeCtx {
  week: number; activity: string; venueHood: string; size: number; options: number[];
  /** Repeat / crew invite: the member's mean enjoyment with these people before (undefined = new people). */
  prevEnjoy?: number;
  crew?: boolean;
  /** Invites this member already answered this week (fatigue). */
  fatigue: number;
  /** Check-in answer this week covers one of the options. */
  primed: boolean;
}
export interface MeetupOutcome {
  enjoy: Record<MemberId, number>;
  seeAgain: Record<MemberId, MemberId[]>;
  positive: MemberId[];
  good: boolean; harms: HarmEvent[];
}

export class FriendsOracle {
  readonly byId: Map<MemberId, FriendsPersona>;
  constructor(readonly personas: readonly FriendsPersona[], readonly seed: number, readonly P: OracleParams = ORACLE_PARAMS) {
    this.byId = new Map(personas.map(p => [p.id, p]));
  }
  p(id: MemberId): FriendsPersona { return this.byId.get(id)!; }
  u(...k: (string | number)[]): number { return h01(this.seed, ...k); }
  n(...k: (string | number)[]): number {
    const a = Math.max(this.u("n1", ...k), 1e-12), b = this.u("n2", ...k);
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  }

  /** Hidden weekly availability: usually-free slots are busy with p = shock. */
  free(id: MemberId, week: number, slot: number): boolean {
    const h = this.p(id).hidden;
    return this.u("free", id, week, slot) < h.slotFree[slot]! && this.u("shock", id, week, slot) >= h.shock;
  }
  /** Appetite this week (weekly swing SD 0.15). */
  appetite(id: MemberId, week: number): number {
    const h = this.p(id).hidden;
    return clamp01(h.appetite + 0.15 * this.n("app", id, week) + 0.15 * h.loneliness);
  }
  /** Pair chemistry: symmetric, unknowable before meeting. */
  chem(a: MemberId, b: MemberId): number { const [x, y] = a < b ? [a, b] : [b, a]; return this.P.chemSd * this.n("chem", x, y); }
  /** Similarity: shared loves, life stage, age closeness. */
  sim(a: MemberId, b: MemberId): number {
    const A = this.p(a).hidden, B = this.p(b).hidden;
    const shared = A.loves.filter(x => B.loves.includes(x)).length;
    return 0.12 * Math.min(2, shared) + (A.lifeStage === B.lifeStage ? 0.1 : 0) - 0.012 * Math.min(25, Math.abs(A.trueAge - B.trueAge));
  }
  /** True door-to-door minutes from a member's home to a neighborhood (the estimate x a fixed per-route error). */
  travel(id: MemberId, hoodId: string): number {
    const h = this.p(id).hidden.home;
    const est = transitMinutes(hoodOf(h), hood(hoodId) ?? hoodOf(h));
    const [x, y] = h < hoodId ? [h, hoodId] : [hoodId, h];
    return est * Math.exp(this.P.travelNoise * this.n("route", x, y));
  }

  /** The member answers a probe: did they reply, say yes, and which offered options are they truly free for. */
  answer(id: MemberId, key: string, c: ProbeCtx): { replied: boolean; yes: boolean; picks: number[] } {
    const per = this.p(id), h = per.hidden;
    if (this.u("reply", id, key) >= h.replyProb) return { replied: false, yes: false, picks: [] };
    const picks = c.options.filter(s => h.adversary === "bot" || this.free(id, c.week, s));
    let p: number;
    if (h.adversary && h.adversary !== "age_liar") p = { romance_seeker: 0.85, mlm: 0.9, bot: 0.7, harasser: 0.75 }[h.adversary];
    else {
      const like = h.likes[c.activity] ?? 0.3;
      const t = this.travel(id, c.venueHood);
      const travelF = t <= h.tolerance ? 1 - 0.1 * (t / h.tolerance) : 0.9 * Math.exp(-(t - h.tolerance) / 10);
      let size = 1;
      if (h.groupPref === "one_to_one" && c.size >= 4) size = 0.6;
      if (h.groupPref === "group" && c.size <= 2) size = 0.7;
      const base = c.prevEnjoy !== undefined ? Math.max(like, 0.35 + 0.7 * c.prevEnjoy) * (c.prevEnjoy >= this.P.positive ? 1.2 : 0.8) : 0.5 + 0.5 * like;
      p = (0.5 + 0.5 * this.appetite(id, c.week)) * base * travelF * size * Math.pow(0.8, c.fatigue) * (c.primed ? 1.3 : 1) * (c.crew ? 1.1 : 1);
    }
    const yes = this.u("yes", id, key) < Math.min(0.95, p) && picks.length > 0;
    return { replied: true, yes, picks: yes ? picks : [] };
  }

  /** P(shows up) for a booked seat. */
  attendP(id: MemberId, week: number, slot: number, venueHood: string): number {
    const h = this.p(id).hidden;
    if (h.adversary === "bot") return 0;
    const free = this.free(id, week, slot) || !!h.adversary;
    const t = this.travel(id, venueHood);
    return (1 - h.flakiness) * (free ? 1 : 0.3) * (t > h.tolerance * 1.3 ? 0.7 : 1);
  }
  attends(id: MemberId, key: string, week: number, slot: number, venueHood: string): boolean {
    return this.u("attend", id, key) < this.attendP(id, week, slot, venueHood);
  }
  /** Backs out at the reveal (names now known): base rate, more if someone there they did not want to see again. */
  backsOut(id: MemberId, key: string, disliked: boolean): boolean {
    return this.u("backout", id, key) < this.P.backout + (disliked ? 0.3 : 0);
  }

  /**
   * Enjoyment of each real attendee; see-again answers; harms by adversaries present. `bond(i, j)`:
   * hours i and j spent together before at meetups both enjoyed (the harness keeps it).
   */
  meetup(key: string, attendees: MemberId[], activity: string, venueHood: string, bond: (a: MemberId, b: MemberId) => number): MeetupOutcome {
    const P = this.P;
    const ids = [...attendees].sort();
    const n = ids.length;
    const act = activityById.get(activity);
    const energies = ids.map(id => this.p(id).hidden.energy);
    const mE = energies.reduce((s, x) => s + x, 0) / Math.max(1, n);
    const sd = Math.sqrt(energies.reduce((s, x) => s + (x - mE) ** 2, 0) / Math.max(1, n));
    // A balanced table (Timeleft's "social energy" mix): some spread, not all quiet, not all loud.
    const balance = n >= 3 ? P.wBal * (0.25 * Math.min(1, sd / 0.22) - 0.6 * Math.max(0, Math.abs(mE - 0.55) - 0.15)) : 0;
    const enjoy: Record<MemberId, number> = {};
    const harms: HarmEvent[] = [];
    const advs = ids.filter(id => this.p(id).hidden.adversary);
    const real = ids.filter(id => !this.p(id).hidden.adversary && !this.p(id).hidden.isMinor);
    const hit = new Map<MemberId, number>();
    for (const a of advs) {
      const kind = this.p(a).hidden.adversary as AdversaryKind;
      const victims = real.length ? real : ids.filter(x => x !== a && !this.p(x).hidden.adversary);
      if (!victims.length) continue;
      const pickV = victims[Math.floor(this.u("victim", key, a) * victims.length)]!;
      const rep = (k: HarmEvent["kind"], v: MemberId) => harms.push({ kind: k, offender: a, victim: v, reported: this.u("report", key, a, v, k) < REPORT_P[k] });
      if (kind === "romance_seeker") { rep("romantic_advance", pickV); hit.set(pickV, (hit.get(pickV) ?? 1) * 0.5); }
      else if (kind === "harasser") { rep("harassment", pickV); hit.set(pickV, (hit.get(pickV) ?? 1) * 0.3); }
      else if (kind === "mlm") for (const v of victims) { rep("sales_pitch", v); hit.set(v, (hit.get(v) ?? 1) * 0.8); }
      else if (kind === "age_liar") for (const v of victims) rep("minor_contact", v);
    }
    for (const i of ids) {
      const h = this.p(i).hidden;
      const others = ids.filter(j => j !== i);
      let pair = 0, b = 0;
      for (const j of others) { pair += this.chem(i, j) + this.sim(i, j) + 0.4 * this.p(j).hidden.likability; b += Math.min(1, bond(i, j) / 10); }
      pair /= Math.max(1, others.length); b /= Math.max(1, others.length);
      const t = this.travel(i, venueHood);
      const travel = P.wTravel * (h.travelCost * (t / 30) + Math.max(0, t - h.tolerance) / h.tolerance);
      let size = 0;
      if (h.groupPref === "one_to_one" && n > 3) size += 0.3 * (1 - h.energy);
      if (h.groupPref === "group" && n === 2) size += 0.2;
      size += 0.06 * Math.max(0, n - 4) * (1 - h.energy);
      const L = P.c0 + P.wA * ((h.likes[activity] ?? 0.3) - 0.5) + pair + h.warmth + balance + P.wF * b - travel - size + P.sideSd * this.n("side", key, i)
        + (act && act.durationMin >= 180 && h.energy < 0.3 ? -0.1 : 0);
      enjoy[i] = sig(L) * (hit.get(i) ?? 1);
    }
    const seeAgain: Record<MemberId, MemberId[]> = {};
    for (const i of ids) {
      seeAgain[i] = [];
      for (const j of ids) {
        if (i === j) continue;
        const adv = this.p(j).hidden.adversary ? -2.5 : 0;
        const x = P.kE * (enjoy[i]! - 0.55) + P.kC * this.chem(i, j) + 1.5 * this.sim(i, j) + 0.5 * this.p(j).hidden.likability + 0.8 * Math.min(1, bond(i, j) / 10) + P.seeAgainBias + adv;
        if (this.u("see", key, i, j) < sig(x)) seeAgain[i]!.push(j);
      }
    }
    const realE = real.map(id => enjoy[id]!);
    const good = realE.length >= 2 && Math.min(...realE) >= P.good;
    return { enjoy, seeAgain, positive: ids.filter(id => enjoy[id]! >= P.positive), good, harms };
  }

  /** Hours a pair shares at one meetup of `n` attendees with activity duration `durMin`. */
  pairHours(durMin: number, n: number, ea: number, eb: number): number {
    return (durMin / 60) * (n <= 4 ? 1 : 3 / (n - 1)) + (ea >= 0.65 && eb >= 0.65 ? this.P.lingerHours : 0);
  }

  /** A pair who both want to see each other again meets on its own this week (hidden). */
  selfHangout(a: MemberId, b: MemberId, week: number, meetups: number): boolean {
    const A = this.p(a).hidden, B = this.p(b).hidden;
    if (A.adversary || B.adversary || A.isMinor || B.isMinor) return false;
    const t = transitMinutes(hoodOf(A.home), hoodOf(B.home));
    const prox = Math.exp(-Math.max(0, t - 15) / 20);
    const p = this.P.selfRate * Math.min(1, meetups / 2) * prox * Math.sqrt(this.appetite(a, week) * this.appetite(b, week));
    return this.u("self", a < b ? a : b, a < b ? b : a, week) < p;
  }

  /** Opts in to a crew offered after a meetup (enjoyment there drives it). */
  crewOptIn(id: MemberId, key: string, enjoyed: number): boolean {
    const h = this.p(id).hidden;
    if (h.adversary === "bot") return false;
    const p = h.replyProb * (enjoyed >= this.P.positive ? 0.85 : 0.35);
    return this.u("crew", id, key) < p;
  }
}
