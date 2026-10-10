// Self-contained NC simulation (design 2.8, PRD 39.2.7). HARNESS ONLY.
//
// It synthesizes the event stream the Network would emit (joins, vouches, intros, crews, help,
// needs, abuse) for a mixed population, feeds it to the real CapitalLedger, runs detection every
// day with a simulated reviewer, and applies the derived levers (effort, vouch capacity, reach).
// Persona truth (type, invitee quality, which events are staged) is read only here, to score.
//
// Modelling assumptions (documented in docs/results/2026-10-08-network-capital.md):
//  A1 Effort improves outcomes modestly: P(good outcome) = q x (1 + effortGain x (effortIndex - 1))
//     for every match made for the member (the seeker of an intro, the asker of a help request).
//     effortGain 0.4 -> the capped top tier (index 1.10) gives +4% relative.
//  A2 Life-driven flakiness (illness, caregiving) is mostly cancellation before the cutoff plus an
//     occasional no-show; it is independent of how much the member wants to take part.
//  A3 Adversaries also behave like regular members; their gaming is on top.
//  A5 Honest friends (capital-11): some regulars have one close friend they meet about weekly
//     through plans they start themselves, verified only by each other. They are honest and must
//     rarely be flagged.
//  A4 The reviewer confirms a flag that contains a true adversary with p 0.9 after a 2-day delay,
//     wrongly confirms an all-honest flag with p 0.02, and never re-reviews the same set within 14 days.
//     The product's review confirms the whole flagged set (capital-12), so by default the simulated
//     reviewer does too: an honest member inside a flag with an adversary is clawed back with them.
//     `reviewer: "per_member"` is the old oracle reviewer that confirmed only the true adversaries.
import { CapitalLedger } from "../src/ledger.ts";
import { detectGaming } from "../src/detect.ts";
import { effortOverlay, organizingReach, vouchCapacity, balanceOf } from "../src/levers.ts";
import type { CapitalConfigInput } from "../src/config.ts";
import type { CapitalEvent, CapitalEventInput as NoId } from "../src/types.ts";

import { DAY, HOUR } from "../../core/src/clock.ts";
export { DAY, HOUR };
export const T0 = Date.UTC(2026, 9, 5, 0);

/**
 * Common random numbers: every decision draws from a hash of (seed, purpose, day, members), not a
 * shared stream. Arms that differ only in a lever then see the same coin flips for the same
 * decisions, so paired comparisons stay paired even when a lever changes who joins. For that to
 * hold, ids that feed a key are derived from (member, day), never from a running counter, and a
 * member is drawn from a population with `member`/`weighted` (rendezvous hashing), not by index:
 * with a counter or an index, one extra invite re-rolled every later draw in that seed.
 */
export class Keyed {
  constructor(private seed: number) {}
  u(...parts: (string | number)[]): number {
    let h = (0x811c9dc5 ^ Math.imul(this.seed, 0x9e3779b1)) >>> 0;
    const str = parts.join("|");
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    let t = (h + 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  chance(p: number, ...parts: (string | number)[]) { return this.u(...parts) < p; }
  int(n: number, ...parts: (string | number)[]) { return Math.floor(this.u(...parts) * n); }
  pick<T>(xs: readonly T[], ...parts: (string | number)[]): T { return xs[this.int(xs.length, ...parts)]!; }
  /**
   * Pick a member by rendezvous hashing: the one with the smallest key for (parts, id). Unlike `pick`,
   * whose index shifts for everyone when the list grows by one, adding or removing a member changes
   * the result only when that member wins. This is what keeps arms paired when a lever changes who joins.
   */
  member<T extends { id: string }>(xs: readonly T[], ...parts: (string | number)[]): T {
    let best = xs[0]!, bu = Infinity;
    for (const x of xs) { const u = this.u(...parts, x.id); if (u < bu) { bu = u; best = x; } }
    return best;
  }
  /** Weighted `member` (exponential race): P(x) is proportional to w(x), stable under membership changes. */
  weighted<T extends { id: string }>(xs: readonly T[], w: (x: T) => number, ...parts: (string | number)[]): T {
    let best = xs[0]!, bk = Infinity;
    for (const x of xs) { const wx = w(x); if (wx <= 0) continue; const k = -Math.log(1 - this.u(...parts, x.id)) / wx; if (k < bk) { bk = k; best = x; } }
    return best;
  }
}

export type PType =
  | "regular" | "good_voucher" | "mediocre_voucher" | "bad_voucher" | "flaky_legit" | "helper" | "organizer"
  | "quiet" | "low_activity" | "minor"
  | "invitee_good" | "invitee_mediocre" | "invitee_bad"
  | "adv_vouch_ring" | "adv_staged" | "adv_help_farm" | "sybil";
export const ADVERSARY: readonly PType[] = ["adv_vouch_ring", "adv_staged", "adv_help_farm"];

interface Persona {
  id: string; type: PType; age: number; joinDay: number; state: "open" | "normal" | "quiet" | "receiving" | "paused";
  accept: number; cancel: number; noShow: number; ghost: number; helpRate: number; vouchPerMonth: number; inviteeQuality: number;
  activity: number; active: boolean; activateDay?: number; removed: boolean; group?: number; steward?: boolean;
  invitedBy?: string; vouchTimes: number[]; gamingStopped: boolean;
  /** Honest close friend (A5). */
  friend?: string;
}

export interface SimOptions {
  seed: number; days?: number; members?: number;
  cfg?: CapitalConfigInput;
  /** Levers on/off (off = everyone at the floor / fixed capacity). */
  effortLever?: boolean; vouchLever?: boolean; reachLever?: boolean;
  effortGain?: number;
  /** Organizing reach above the base goes to members with the least recent participation (default true). */
  reachExtraToLowExposure?: boolean;
  detection?: boolean;
  /** How the simulated reviewer decides a flag (A4). Default "whole_set", as in the product. */
  reviewer?: "whole_set" | "per_member";
  /** Pairs of honest regulars who meet weekly through plans they start themselves (A5). Default 8. */
  honestFriendPairs?: number;
}

export interface SimResult {
  seed: number; personas: Persona[]; ledger: CapitalLedger;
  /** Truth value events per member (day). */
  values: Map<string, number[]>;
  /** Truth: days on which the member took part: said yes to a plan, intro or crew, organized a session, asked for or gave help. */
  participation: Map<string, number[]>;
  gamingEvents: Set<string>;
  firstGaming: Map<string, number>; detectedAt: Map<string, number>;
  falseConfirmed: string[]; flagsRaised: number; honestFlagged: Set<string>;
  /** Honest friends (A5) who were ever in a flag. */
  friendsFlagged: Set<string>; friends: string[];
  invites: { voucher: string; invitee: string; day: number; quality: "good" | "mediocre" | "bad"; joined: boolean }[];
  safetyFlagDay: Map<string, number>;
  days: number;
}

const BASE_Q = 0.5, CREW_Q = 0.45, HELP_USEFUL = 0.75;
const LABELS = ["climbing night", "run club session", "board game night", "volunteer outing", "sketching meetup"];
const BUDGET: Record<Persona["state"], number> = { open: 4, normal: 2, quiet: 0.25, receiving: 1, paused: 0 };

export function simulate(o: SimOptions): SimResult {
  const days = o.days ?? 90, N = o.members ?? 240;
  const effortLever = o.effortLever ?? true, vouchLever = o.vouchLever ?? true, reachLever = o.reachLever ?? true;
  const effortGain = o.effortGain ?? 0.4, reachExtraToLowExposure = o.reachExtraToLowExposure ?? true, detection = o.detection ?? true;
  const K = new Keyed(o.seed);
  const L = new CapitalLedger(o.cfg ?? {});
  const P = new Map<string, Persona>();
  const values = new Map<string, number[]>();
  const participation = new Map<string, number[]>();
  const took = (m: string, day: number) => { if (!participation.has(m)) participation.set(m, []); participation.get(m)!.push(day); };
  const gamingEvents = new Set<string>();
  const firstGaming = new Map<string, number>(), detectedAt = new Map<string, number>();
  const falseConfirmed: string[] = [];
  const honestFlagged = new Set<string>(), friendsFlagged = new Set<string>();
  const invites: SimResult["invites"] = [];
  const safetyFlagDay = new Map<string, number>();
  let flagsRaised = 0;
  let seq = 0;
  const queue: CapitalEvent[] = [];
  const emit = (e: NoId, gaming?: string[]): string => {
    const id = `x${++seq}`;
    queue.push({ id, ...e } as CapitalEvent);
    if (gaming) { gamingEvents.add(id); for (const g of gaming) if (!firstGaming.has(g)) firstGaming.set(g, e.t); }
    return id;
  };
  const addValue = (m: string, day: number) => { if (!values.has(m)) values.set(m, []); values.get(m)!.push(day); };

  const mk = (id: string, type: PType, joinDay: number, extra: Partial<Persona> = {}): Persona => {
    const base: Persona = {
      id, type, age: 30, joinDay, state: "normal", accept: 0.5, cancel: 0.05, noShow: 0.02, ghost: 0.02, helpRate: 0.3,
      vouchPerMonth: 0.15, inviteeQuality: 0.6, activity: 1, active: true, removed: false, vouchTimes: [], gamingStopped: false,
    };
    const t: Partial<Persona> =
      type === "good_voucher" ? { vouchPerMonth: 1, inviteeQuality: 0.85 }
      : type === "mediocre_voucher" ? { vouchPerMonth: 1, inviteeQuality: 0.5 }
      : type === "bad_voucher" ? { vouchPerMonth: 2.5, inviteeQuality: 0.15 }
      : type === "flaky_legit" ? { cancel: 0.3, noShow: 0.06, ghost: 0.01 }
      : type === "helper" ? { helpRate: 2 }
      : type === "organizer" ? { helpRate: 0.5 }
      : type === "quiet" ? { state: K.pick(["quiet", "receiving", "paused"] as const, "state", id), accept: 0.4 }
      : type === "low_activity" || type === "invitee_mediocre" ? { accept: 0.2, activity: 0.5, helpRate: 0.1, vouchPerMonth: 0.1 }
      : type === "minor" ? { age: 15, vouchPerMonth: 0, helpRate: 0 }
      : type === "invitee_bad" ? { accept: 0.3, noShow: 0.1, ghost: 0.1, helpRate: 0, vouchPerMonth: 0.5, inviteeQuality: 0.2 }
      : type === "sybil" ? { accept: 0, activity: 0, helpRate: 0, vouchPerMonth: 0 }
      : type === "adv_vouch_ring" ? { vouchPerMonth: 3 }
      : {};
    const p = { ...base, ...t, ...extra };
    P.set(id, p);
    return p;
  };

  // ---- population
  const mix: [PType, number][] = [
    ["regular", 0.36], ["good_voucher", 0.07], ["mediocre_voucher", 0.07], ["bad_voucher", 0.05], ["flaky_legit", 0.1],
    ["helper", 0.08], ["organizer", 0.04], ["quiet", 0.08], ["low_activity", 0.08],
  ];
  let k = 0;
  for (const [type, share] of mix) for (let i = 0; i < Math.round(share * N); i++) mk(`m${k++}`, type, 0);
  for (let i = 0; i < 4; i++) P.get(`m${i}`)!.steward = true;
  const regulars = [...P.values()].filter(p => p.type === "regular");
  const friendPairs: [Persona, Persona][] = [];
  for (let i = 0; i < (o.honestFriendPairs ?? 8) && 2 * i + 1 < regulars.length; i++) {
    const [a, b] = [regulars[regulars.length - 1 - 2 * i]!, regulars[regulars.length - 2 - 2 * i]!];
    a.friend = b.id; b.friend = a.id;
    friendPairs.push([a, b]);
  }
  for (let i = 0; i < 12; i++) mk(`minor${i}`, "minor", K.int(30, "minorjoin", i));
  // adversaries: 2 vouch rings x 3, 3 staged pairs, 2 help-farm trios (18 = 7% of adults)
  for (let g = 0; g < 2; g++) for (let i = 0; i < 3; i++) mk(`ring${g}_${i}`, "adv_vouch_ring", 0, { group: g });
  for (let g = 0; g < 3; g++) for (let i = 0; i < 2; i++) mk(`staged${g}_${i}`, "adv_staged", 0, { group: g });
  for (let g = 0; g < 2; g++) for (let i = 0; i < 3; i++) mk(`farm${g}_${i}`, "adv_help_farm", 0, { group: g });
  const groupOf = (type: PType, g: number) => [...P.values()].filter(p => p.type === type && p.group === g);

  for (const p of P.values()) emit({ type: "member_joined", t: T0 + p.joinDay * DAY, member: p.id, age: p.age });
  // Initial members are activated on day 0-2.
  for (const p of P.values()) emit({ type: "member_activated", t: T0 + (p.joinDay + 1) * DAY, member: p.id });

  const tierCache = new Map<string, number>();
  const effortIdx = (m: string) => (effortLever ? tierCache.get(m) ?? 1 : 1);
  const boost = (m: string) => 1 + effortGain * (effortIdx(m) - 1);
  const adultActive = (day: number) => [...P.values()].filter(p => p.age >= 18 && p.active && !p.removed && p.joinDay <= day && p.type !== "sybil" && p.state !== "paused");

  let planSeq = 0;
  /** A plan with the given participants. `served` = whose effort tier shapes the match. */
  const runPlan = (pk: string, day: number, parts: string[], served: string, kind: "intro" | "crew", origin: "engine" | "member" | "organizer", q: number, label?: string, organizer?: string) => {
    const planId = `p${++planSeq}`;
    const tAcc = T0 + day * DAY + 9 * HOUR;
    const startsAt = T0 + (day + 2) * DAY + 18 * HOUR;
    const attended: string[] = [];
    for (const m of parts) {
      const p = P.get(m)!;
      emit({ type: "plan_accepted", t: tAcc, member: m, planId, kind, startsAt });
      took(m, day);
      const r = K.u(pk, m, "fate");
      if (r < p.cancel) emit({ type: "plan_cancelled", t: startsAt - 24 * HOUR, member: m, planId });
      else if (r < p.cancel + p.ghost) emit({ type: "plan_ghosted", t: startsAt + 2 * HOUR, member: m, planId });
      else {
        emit({ type: "plan_confirmed", t: startsAt - 12 * HOUR, member: m, planId });
        if (r < p.cancel + p.ghost + p.noShow) emit({ type: "plan_no_show", t: startsAt + 2 * HOUR, member: m, planId });
        else attended.push(m);
      }
    }
    const everyone = organizer ? [organizer, ...attended] : attended;
    for (const m of attended) {
      const others = everyone.filter(x => x !== m);
      emit({ type: "plan_attended", t: startsAt + 3 * HOUR, member: m, planId, counterparts: others,
        verifiedBy: kind === "crew" ? ["checkin"] : others.length ? ["counterpart"] : ["checkin"], origin, publicVenue: true });
      if (K.chance(0.6, pk, m, "fb")) emit({ type: "feedback_given", t: startsAt + 20 * HOUR, member: m, planId });
    }
    // outcomes (truth): good only if someone else came
    for (const m of parts) {
      const u = K.u(pk, m, "out");
      if (attended.includes(m) && everyone.length >= 2 && u < Math.min(0.95, q * boost(served))) {
        addValue(m, day + 2);
        // The other attendees' own check-ins confirm the meeting (crews are checked in at the venue).
        const others = everyone.filter(x => x !== m);
        emit({ type: "value_received", t: startsAt + 21 * HOUR, member: m, with: others, confirmedBy: others, verifiedBy: kind === "crew" ? ["checkin"] : ["counterpart"] });
      }
    }
    if (organizer) {
      took(organizer, day);
      emit({ type: "organized", t: startsAt + 4 * HOUR, organizer, planId, publicVenue: true, recurring: true, attendees: attended, label: label ?? "crew" });
      const u = K.u(pk, organizer, "out");
      if (attended.length >= 2 && u < q * boost(organizer)) addValue(organizer, day + 2);
    }
  };

  const reviewQ: { day: number; members: string[] }[] = [];
  const reviewed = new Map<string, number>();

  for (let day = 0; day < days; day++) {
    const t9 = T0 + day * DAY + 9 * HOUR;
    // refresh effort tiers from the ledger (yesterday's balance)
    for (const p of P.values()) tierCache.set(p.id, effortOverlay(L.internalEntries(p.id), T0 + day * DAY, L.cfg).effortIndex);
    const pool = adultActive(day);
    const matchable = pool.filter(p => p.state !== "quiet" || K.chance(0.2, "qm", day, p.id));

    // --- engine intros
    for (const p of pool) {
      const rate = BUDGET[p.state] / 7 / 2 * p.activity;
      if (!K.chance(rate, "intro", day, p.id)) continue;
      const c = K.member(matchable, "cp", day, p.id);
      if (c.id === p.id) continue;
      const aYes = K.chance(p.accept, "acc", day, p.id, c.id), bYes = K.chance(c.accept, "acc", day, c.id, p.id);
      if (!aYes) emit({ type: "declined", t: t9, member: p.id });
      if (!bYes) emit({ type: "declined", t: t9, member: c.id });
      if (aYes && bYes) runPlan(`i:${day}:${p.id}:${c.id}`, day, [p.id, c.id], p.id, "intro", "engine", BASE_Q);
    }

    // --- help asks
    const helpers = pool.filter(p => p.helpRate > 0);
    for (const p of pool) {
      if (!K.chance(p.state === "receiving" ? 0.08 : 0.025, "ask", day, p.id)) continue;
      emit({ type: "help_asked", t: t9, member: p.id });
      took(p.id, day);
      const h = K.weighted(helpers, x => x.helpRate, "helper", day, p.id);
      if (h.id === p.id || !K.chance(0.7, "helps", day, p.id)) continue;
      const helpId = `h${seq}`;
      emit({ type: "help_given", t: t9 + 2 * HOUR, helper: h.id, recipient: p.id, helpId });
      took(h.id, day);
      const u = K.u("useful", day, p.id);
      const useful = u < Math.min(0.95, HELP_USEFUL * boost(p.id));
      if (useful) { addValue(p.id, day); emit({ type: "value_received", t: t9 + 5 * HOUR, member: p.id, with: [h.id], confirmedBy: [h.id] }); }
      if (K.chance(0.85, "hconf", day, p.id)) emit({ type: "help_confirmed", t: t9 + 6 * HOUR, helpId, recipient: p.id, useful });
    }

    // --- needs list (weekly)
    if (day % 7 === 3) for (let i = 0; i < 4; i++) {
      const cands = pool.filter(p => p.helpRate >= 0.3);
      if (!cands.length || !K.chance(0.6, "need", day, i)) continue;
      emit({ type: "need_answered", t: t9 + 8 * HOUR, member: K.member(cands, "needby", day, i).id, needId: `n${day}_${i}`, confirmedBy: "staff" });
    }

    // --- stewards (weekly review work)
    if (day % 7 === 5) for (const p of pool) if (p.steward) emit({ type: "review_completed", t: t9 + 9 * HOUR, member: p.id, items: 3 });

    // --- organizers: weekly crew at a public venue
    for (const p of pool) {
      if (p.type !== "organizer" || (day + Number(p.id.slice(1))) % 7 !== 0) continue;
      const base = L.cfg.levers.reach.base;
      const reach = reachLever ? organizingReach(L.internalEntries(p.id), T0 + day * DAY, L.cfg).max : base;
      const invited = new Set<string>();
      // The lever reserves every slot above the base for low exposure (OrganizingReach.reservedForLowExposure).
      const firstSlots = reachExtraToLowExposure ? Math.min(reach, base) : reach;
      for (let i = 0; i < firstSlots * 2 && invited.size < firstSlots; i++) { const c = K.member(matchable, "crewinv", day, p.id, i); if (c.id !== p.id) invited.add(c.id); }
      if (reachExtraToLowExposure && reach > invited.size) {
        // Extra reach earned through NC goes to members with the least recent participation (exposure floor).
        const recent = (m: string) => (participation.get(m) ?? []).filter(d => day - d < 14).length;
        const cands = [...new Set(Array.from({ length: (reach - invited.size) * 4 }, (_, i) => K.member(matchable, "crewx", day, p.id, i)))]
          .filter(c => c.id !== p.id && !invited.has(c.id)).sort((a, b) => recent(a.id) - recent(b.id) || (a.id < b.id ? -1 : 1));
        for (const c of cands) { if (invited.size >= reach) break; invited.add(c.id); }
      }
      const yes = [...invited].filter(m => { const ok = K.chance(P.get(m)!.accept * 0.8, "crewacc", day, p.id, m); if (!ok) emit({ type: "declined", t: t9, member: m }); return ok; });
      runPlan(`c:${day}:${p.id}`, day, yes, p.id, "crew", "organizer", CREW_Q, LABELS[Number(p.id.slice(1)) % LABELS.length], p.id);
    }

    // --- vouching (honest and bad vouchers; ring vouching is below)
    for (const p of pool) {
      if (p.type === "adv_vouch_ring" || p.type === "minor" || p.vouchPerMonth <= 0) continue;
      if (!K.chance(p.vouchPerMonth / 30, "vouch", day, p.id)) continue;
      const recent = p.vouchTimes.filter(d => day - d < 30).length;
      const cap = vouchLever ? vouchCapacity(L.internalEntries(p.id), T0 + day * DAY, L.cfg) : 3;
      if (recent >= cap) continue;
      p.vouchTimes.push(day);
      const r = K.u("vq", day, p.id);
      const quality = r < p.inviteeQuality ? "good" : r < p.inviteeQuality + (1 - p.inviteeQuality) / 2 ? "mediocre" : "bad";
      const joined = K.chance(0.75, "vjoin", day, p.id);
      const invId = `inv_${p.id}_${day}`;
      invites.push({ voucher: p.id, invitee: invId, day, quality, joined });
      if (!joined || day + 2 >= days) continue;
      const ip = mk(invId, quality === "good" ? "invitee_good" : quality === "mediocre" ? "invitee_mediocre" : "invitee_bad", day + 2, { invitedBy: p.id, active: false });
      emit({ type: "member_joined", t: T0 + (day + 2) * DAY, member: ip.id, age: 30, vouchedBy: p.id });
      const actP = quality === "good" ? 0.85 : quality === "mediocre" ? 0.55 : 0.7;
      if (K.chance(actP, "act", ip.id)) { ip.activateDay = day + 3 + K.int(5, "actday", ip.id); }
      if (quality === "bad" && K.chance(0.6, "flag", ip.id)) {
        const fd = day + 5 + K.int(50, "flagday", ip.id);
        safetyFlagDay.set(ip.id, fd);
        if (K.chance(0.55, "rm", ip.id)) (ip as Persona & { removeDay?: number }).removeDay = fd + 3 + K.int(7, "rmday", ip.id);
      }
    }
    for (const p of P.values()) {
      if (p.activateDay === day) { p.active = true; emit({ type: "member_activated", t: T0 + day * DAY + 8 * HOUR, member: p.id }); }
      if (safetyFlagDay.get(p.id) === day) emit({ type: "safety_flag", t: T0 + day * DAY + 10 * HOUR, member: p.id, serious: true });
      if ((p as Persona & { removeDay?: number }).removeDay === day && !p.removed) {
        p.removed = true;
        emit({ type: "abuse_confirmed", t: T0 + day * DAY + 11 * HOUR, member: p.id, kind: "harassment" });
        emit({ type: "member_removed", t: T0 + day * DAY + 11 * HOUR, member: p.id, reason: "serious_abuse" });
      }
    }

    // --- honest friends (A5): about weekly, a plan one of them starts, verified by each other
    friendPairs.forEach(([a, b], i) => {
      if ((day + i) % 7 !== 0 || !K.chance(0.8, "friends", day, a.id)) return;
      const planId = `f${day}_${i}`, st = T0 + day * DAY + 19 * HOUR;
      for (const [x, y] of [[a, b], [b, a]] as const) {
        emit({ type: "plan_accepted", t: t9, member: x.id, planId, kind: "plan", startsAt: st });
        took(x.id, day);
        emit({ type: "plan_confirmed", t: t9 + HOUR, member: x.id, planId });
        emit({ type: "plan_attended", t: st + 2 * HOUR, member: x.id, planId, counterparts: [y.id], verifiedBy: ["counterpart"], origin: "member", publicVenue: true });
        if (K.chance(0.6, "ffb", planId, x.id)) emit({ type: "feedback_given", t: st + 3 * HOUR, member: x.id, planId });
        if (K.chance(BASE_Q, "fval", planId, x.id)) {
          addValue(x.id, day);
          emit({ type: "value_received", t: st + 3 * HOUR, member: x.id, with: [y.id], confirmedBy: [y.id], verifiedBy: ["counterpart"] });
        }
      }
    });

    // --- adversaries (on top of their honest behaviour above)
    for (let g = 0; g < 2; g++) {
      const ring = groupOf("adv_vouch_ring", g).filter(p => !p.gamingStopped);
      for (const p of ring) {
        // sybil vouching
        if (K.chance(p.vouchPerMonth / 30, "rvouch", day, p.id)) {
          const recent = p.vouchTimes.filter(d => day - d < 30).length;
          const cap = vouchLever ? vouchCapacity(L.internalEntries(p.id), T0 + day * DAY, L.cfg) : 3;
          if (recent < cap && day + 6 < days) {
            p.vouchTimes.push(day);
            const sid = `syb_${p.id}_${day}`;
            mk(sid, "sybil", day + 1, { invitedBy: p.id, group: g });
            invites.push({ voucher: p.id, invitee: sid, day, quality: "bad", joined: true });
            emit({ type: "member_joined", t: T0 + (day + 1) * DAY, member: sid, age: 30, vouchedBy: p.id }, [p.id]);
            emit({ type: "member_activated", t: T0 + (day + 2) * DAY, member: sid }, [p.id]);
            // Half the sybils only say they got value (the agent's tip, no provider): the invitee's
            // own say-so (capital-1). The other half get staged "value": a member-started meetup
            // with another ring member, mutually confirmed.
            const other = ring.find(x => x.id !== p.id);
            if (K.chance(0.5, "selfval", sid)) emit({ type: "value_received", t: T0 + (day + 4) * DAY, member: sid, with: [] }, [p.id]);
            else if (other) {
              const planId = `sp${++planSeq}`, st = T0 + (day + 4) * DAY;
              for (const [a, b] of [[sid, other.id], [other.id, sid]] as const) {
                emit({ type: "plan_accepted", t: T0 + (day + 3) * DAY, member: a, planId, kind: "intro", startsAt: st }, [p.id]);
                emit({ type: "plan_confirmed", t: st - 12 * HOUR, member: a, planId }, [p.id]);
                emit({ type: "plan_attended", t: st + HOUR, member: a, planId, counterparts: [b], verifiedBy: ["counterpart"], origin: "member", publicVenue: true }, [other.id]);
              }
              emit({ type: "value_received", t: st + 2 * HOUR, member: sid, with: [other.id], confirmedBy: [other.id] }, [p.id]);
            }
          }
        }
        // reciprocal help inside the ring, ~2 per week each
        if (K.chance(2 / 7, "rhelp", day, p.id)) {
          const others = ring.filter(x => x.id !== p.id);
          const r = others.length ? K.pick(others, "rhto", day, p.id) : undefined;
          if (r) {
            const helpId = `rh${seq}`;
            emit({ type: "help_given", t: t9 + 12 * HOUR, helper: p.id, recipient: r.id, helpId }, [p.id]);
            emit({ type: "help_confirmed", t: t9 + 13 * HOUR, helpId, recipient: r.id, useful: true }, [p.id]);
          }
        }
      }
    }
    for (let g = 0; g < 3; g++) {
      const pair = groupOf("adv_staged", g).filter(p => !p.gamingStopped);
      if (pair.length < 2 || day % 3 !== g % 3) continue;
      const planId = `st${++planSeq}`, st = T0 + day * DAY + 19 * HOUR;
      for (const [a, b] of [[pair[0]!, pair[1]!], [pair[1]!, pair[0]!]]) {
        emit({ type: "plan_accepted", t: t9, member: a.id, planId, kind: "intro", startsAt: st }, [a.id]);
        emit({ type: "plan_confirmed", t: t9 + HOUR, member: a.id, planId }, [a.id]);
        emit({ type: "plan_attended", t: st + HOUR, member: a.id, planId, counterparts: [b.id], verifiedBy: ["counterpart"], origin: "member", publicVenue: true }, [a.id]);
        emit({ type: "feedback_given", t: st + 2 * HOUR, member: a.id, planId }, [a.id]);
      }
    }
    for (let g = 0; g < 2; g++) {
      const trio = groupOf("adv_help_farm", g).filter(p => !p.gamingStopped);
      for (const p of trio) {
        if (!K.chance(0.5, "farm", day, p.id)) continue;
        const others = trio.filter(x => x.id !== p.id);
        if (!others.length) continue;
        const r = K.pick(others, "farmto", day, p.id);
        const helpId = `fh${seq}`;
        emit({ type: "help_given", t: t9 + 14 * HOUR, helper: p.id, recipient: r.id, helpId }, [p.id]);
        emit({ type: "help_confirmed", t: t9 + 15 * HOUR, helpId, recipient: r.id, useful: true }, [p.id]);
      }
    }

    // --- flush today's events into the ledger in time order
    const dayEnd = T0 + (day + 1) * DAY;
    const due = queue.filter(e => e.t < dayEnd).sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.t < dayEnd) queue.splice(i, 1);
    for (const e of due) L.record(e);

    // --- detection + simulated reviewer (A4)
    if (detection) {
      for (const f of detectGaming(L.all(), dayEnd - 1, L.cfg)) {
        const key = f.members.join(",");
        if ((reviewed.get(key) ?? -Infinity) > day - 14) continue;
        reviewed.set(key, day);
        flagsRaised++;
        reviewQ.push({ day: day + 2, members: f.members });
        for (const m of f.members) if (!isBad(P.get(m)!.type)) { honestFlagged.add(m); if (P.get(m)!.friend) friendsFlagged.add(m); }
      }
      for (const r of reviewQ.filter(r => r.day === day)) {
        const bad = r.members.filter(m => isBad(P.get(m)!.type));
        let confirm: string[] = [];
        if (bad.length) { if (K.chance(0.9, "rev", day, r.members.join(","))) confirm = o.reviewer === "per_member" ? bad : r.members; }
        else if (K.chance(0.02, "rev", day, r.members.join(","))) confirm = r.members;
        falseConfirmed.push(...confirm.filter(m => !isBad(P.get(m)!.type)));
        if (!confirm.length) continue;
        L.record({ id: `fraud${++seq}`, t: dayEnd - 1, type: "fraud_confirmed", members: confirm });
        for (const m of confirm) {
          const p = P.get(m)!;
          if (!detectedAt.has(m)) detectedAt.set(m, dayEnd - 1);
          p.gamingStopped = true; // suspended from the gamed surface after confirmation
        }
      }
    }
  }
  return { seed: o.seed, personas: [...P.values()], ledger: L, values, participation, gamingEvents, firstGaming, detectedAt, falseConfirmed, flagsRaised, honestFlagged, friendsFlagged, friends: friendPairs.flat().map(p => p.id), invites, safetyFlagDay, days };
}

export const isBad = (t: PType) => (ADVERSARY as readonly string[]).includes(t) || t === "sybil";

/** Per-member V14 rate over days [from, to]: share of days with a value event in the previous 14 days. */
export function v14Rate(values: number[] | undefined, from: number, to: number): number {
  let hit = 0, n = 0;
  for (let t = from; t <= to; t++) { n++; if ((values ?? []).some(d => d <= t && d > t - 14)) hit++; }
  return n ? hit / n : 0;
}

export { balanceOf };
