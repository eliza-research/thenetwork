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
//     effortGain 0.4 -> the capped top tier (index 1.25) gives +10% relative.
//  A2 Life-driven flakiness (illness, caregiving) is mostly cancellation before the cutoff plus an
//     occasional no-show; it is independent of how much the member wants to take part.
//  A3 Adversaries also behave like regular members; their gaming is on top.
//  A4 The reviewer confirms a flag that contains a true adversary with p 0.9 after a 2-day delay,
//     wrongly confirms an all-honest flag with p 0.02, and never re-reviews the same set within 14 days.
import { CapitalLedger } from "../src/ledger.ts";
import { detectGaming } from "../src/detect.ts";
import { effortOverlay, organizingReach, vouchCapacity, balanceOf } from "../src/levers.ts";
import type { CapitalConfigInput } from "../src/config.ts";
import type { CapitalEvent, CapitalEventInput as NoId } from "../src/types.ts";

export const DAY = 86_400_000, HOUR = 3_600_000;
export const T0 = Date.UTC(2026, 9, 5, 0);

export class Rng {
  private a: number;
  constructor(seed: number) { this.a = (seed >>> 0) || 0x9e3779b9; }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  chance(p: number) { return this.next() < p; }
  int(n: number) { return Math.floor(this.next() * n); }
  pick<T>(xs: readonly T[]): T { return xs[this.int(xs.length)]!; }
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
}

export interface SimOptions {
  seed: number; days?: number; members?: number;
  cfg?: CapitalConfigInput;
  /** Levers on/off (off = everyone at the floor / fixed capacity). */
  effortLever?: boolean; vouchLever?: boolean; reachLever?: boolean;
  effortGain?: number;
  detection?: boolean;
}

export interface SimResult {
  seed: number; personas: Persona[]; ledger: CapitalLedger;
  /** Truth value events per member (day). */
  values: Map<string, number[]>;
  gamingEvents: Set<string>;
  firstGaming: Map<string, number>; detectedAt: Map<string, number>;
  falseConfirmed: string[]; flagsRaised: number; honestFlagged: Set<string>;
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
  const effortGain = o.effortGain ?? 0.4, detection = o.detection ?? true;
  const rng = new Rng(o.seed * 7919 + 13);
  const out = new Rng(o.seed * 104729 + 7); // outcome draws: one draw per outcome in every arm, so arms stay aligned
  const L = new CapitalLedger(o.cfg ?? {});
  const P = new Map<string, Persona>();
  const values = new Map<string, number[]>();
  const gamingEvents = new Set<string>();
  const firstGaming = new Map<string, number>(), detectedAt = new Map<string, number>();
  const falseConfirmed: string[] = [];
  const honestFlagged = new Set<string>();
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
      : type === "quiet" ? { state: rng.pick(["quiet", "receiving", "paused"] as const), accept: 0.4 }
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
  for (let i = 0; i < 12; i++) mk(`minor${i}`, "minor", rng.int(30));
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
  const runPlan = (day: number, parts: string[], served: string, kind: "intro" | "crew", origin: "engine" | "member" | "organizer", q: number, label?: string, organizer?: string) => {
    const planId = `p${++planSeq}`;
    const tAcc = T0 + day * DAY + 9 * HOUR;
    const startsAt = T0 + (day + 2) * DAY + 18 * HOUR;
    const attended: string[] = [];
    for (const m of parts) {
      const p = P.get(m)!;
      emit({ type: "plan_accepted", t: tAcc, member: m, planId, kind, startsAt });
      const r = rng.next();
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
      if (rng.chance(0.6)) emit({ type: "feedback_given", t: startsAt + 20 * HOUR, member: m, planId });
    }
    // outcomes (truth): good only if someone else came
    for (const m of parts) {
      const u = out.next();
      if (attended.includes(m) && everyone.length >= 2 && u < Math.min(0.95, q * boost(served))) {
        addValue(m, day + 2);
        emit({ type: "value_received", t: startsAt + 21 * HOUR, member: m, with: everyone.filter(x => x !== m) });
      }
    }
    if (organizer) {
      emit({ type: "organized", t: startsAt + 4 * HOUR, organizer, planId, publicVenue: true, recurring: true, attendees: attended, label: label ?? "crew" });
      const u = out.next();
      if (attended.length >= 2 && u < q * boost(organizer)) addValue(organizer, day + 2);
    }
  };

  const reviewQ: { day: number; members: string[] }[] = [];
  const reviewed = new Map<string, number>();
  const nextInviteN = { n: 0 };

  for (let day = 0; day < days; day++) {
    const t9 = T0 + day * DAY + 9 * HOUR;
    // refresh effort tiers from the ledger (yesterday's balance)
    for (const p of P.values()) tierCache.set(p.id, effortOverlay(L.internalEntries(p.id), T0 + day * DAY, L.cfg).effortIndex);
    const pool = adultActive(day);
    const matchable = pool.filter(p => p.state !== "quiet" || rng.chance(0.2));

    // --- engine intros
    for (const p of pool) {
      const rate = BUDGET[p.state] / 7 / 2 * p.activity;
      if (!rng.chance(rate)) continue;
      const c = rng.pick(matchable);
      if (c.id === p.id) continue;
      const aYes = rng.chance(p.accept), bYes = rng.chance(c.accept);
      if (!aYes) emit({ type: "declined", t: t9, member: p.id });
      if (!bYes) emit({ type: "declined", t: t9, member: c.id });
      if (aYes && bYes) runPlan(day, [p.id, c.id], p.id, "intro", "engine", BASE_Q);
    }

    // --- help asks
    const helpers = pool.filter(p => p.helpRate > 0);
    const helpW = helpers.reduce((s, p) => s + p.helpRate, 0);
    for (const p of pool) {
      if (!rng.chance(p.state === "receiving" ? 0.08 : 0.025)) continue;
      emit({ type: "help_asked", t: t9, member: p.id });
      let r = rng.next() * helpW, h = helpers[0]!;
      for (const x of helpers) { r -= x.helpRate; if (r <= 0) { h = x; break; } }
      if (h.id === p.id || !rng.chance(0.7)) continue;
      const helpId = `h${seq}`;
      emit({ type: "help_given", t: t9 + 2 * HOUR, helper: h.id, recipient: p.id, helpId });
      const u = out.next();
      const useful = u < Math.min(0.95, HELP_USEFUL * boost(p.id));
      if (useful) { addValue(p.id, day); emit({ type: "value_received", t: t9 + 5 * HOUR, member: p.id, with: [h.id] }); }
      if (rng.chance(0.85)) emit({ type: "help_confirmed", t: t9 + 6 * HOUR, helpId, recipient: p.id, useful });
    }

    // --- needs list (weekly)
    if (day % 7 === 3) for (let i = 0; i < 4; i++) {
      const cands = pool.filter(p => p.helpRate >= 0.3);
      if (!cands.length || !rng.chance(0.6)) continue;
      emit({ type: "need_answered", t: t9 + 8 * HOUR, member: rng.pick(cands).id, needId: `n${day}_${i}`, confirmedBy: "staff" });
    }

    // --- stewards (weekly review work)
    if (day % 7 === 5) for (const p of pool) if (p.steward) emit({ type: "review_completed", t: t9 + 9 * HOUR, member: p.id, items: 3 });

    // --- organizers: weekly crew at a public venue
    for (const p of pool) {
      if (p.type !== "organizer" || (day + Number(p.id.slice(1))) % 7 !== 0) continue;
      const reach = reachLever ? organizingReach(L.internalEntries(p.id), T0 + day * DAY, L.cfg) : 8;
      const invited = new Set<string>();
      for (let i = 0; i < reach * 2 && invited.size < reach; i++) { const c = rng.pick(matchable); if (c.id !== p.id) invited.add(c.id); }
      const yes = [...invited].filter(m => { const ok = rng.chance(P.get(m)!.accept * 0.8); if (!ok) emit({ type: "declined", t: t9, member: m }); return ok; });
      runPlan(day, yes, p.id, "crew", "organizer", CREW_Q, LABELS[Number(p.id.slice(1)) % LABELS.length], p.id);
    }

    // --- vouching (honest and bad vouchers; ring vouching is below)
    for (const p of pool) {
      if (p.type === "adv_vouch_ring" || p.type === "minor" || p.vouchPerMonth <= 0) continue;
      if (!rng.chance(p.vouchPerMonth / 30)) continue;
      const recent = p.vouchTimes.filter(d => day - d < 30).length;
      const cap = vouchLever ? vouchCapacity(L.internalEntries(p.id), T0 + day * DAY, L.cfg) : 3;
      if (recent >= cap) continue;
      p.vouchTimes.push(day);
      const r = rng.next();
      const quality = r < p.inviteeQuality ? "good" : r < p.inviteeQuality + (1 - p.inviteeQuality) / 2 ? "mediocre" : "bad";
      const joined = rng.chance(0.75);
      const invId = `inv${nextInviteN.n++}`;
      invites.push({ voucher: p.id, invitee: invId, day, quality, joined });
      if (!joined || day + 2 >= days) continue;
      const ip = mk(invId, quality === "good" ? "invitee_good" : quality === "mediocre" ? "invitee_mediocre" : "invitee_bad", day + 2, { invitedBy: p.id, active: false });
      emit({ type: "member_joined", t: T0 + (day + 2) * DAY, member: ip.id, age: 30, vouchedBy: p.id });
      const actP = quality === "good" ? 0.85 : quality === "mediocre" ? 0.55 : 0.7;
      if (rng.chance(actP)) { ip.activateDay = day + 3 + rng.int(5); }
      if (quality === "bad" && rng.chance(0.6)) {
        const fd = day + 5 + rng.int(50);
        safetyFlagDay.set(ip.id, fd);
        if (rng.chance(0.55)) (ip as Persona & { removeDay?: number }).removeDay = fd + 3 + rng.int(7);
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

    // --- adversaries (on top of their honest behaviour above)
    for (let g = 0; g < 2; g++) {
      const ring = groupOf("adv_vouch_ring", g).filter(p => !p.gamingStopped);
      for (const p of ring) {
        // sybil vouching
        if (rng.chance(p.vouchPerMonth / 30)) {
          const recent = p.vouchTimes.filter(d => day - d < 30).length;
          const cap = vouchLever ? vouchCapacity(L.internalEntries(p.id), T0 + day * DAY, L.cfg) : 3;
          if (recent < cap && day + 6 < days) {
            p.vouchTimes.push(day);
            const sid = `syb${nextInviteN.n++}`;
            mk(sid, "sybil", day + 1, { invitedBy: p.id, group: g });
            invites.push({ voucher: p.id, invitee: sid, day, quality: "bad", joined: true });
            emit({ type: "member_joined", t: T0 + (day + 1) * DAY, member: sid, age: 30, vouchedBy: p.id }, [p.id]);
            emit({ type: "member_activated", t: T0 + (day + 2) * DAY, member: sid }, [p.id]);
            // staged "value": a member-started meetup with another ring member, mutually confirmed
            const other = ring.find(x => x.id !== p.id);
            if (other) {
              const planId = `sp${++planSeq}`, st = T0 + (day + 4) * DAY;
              for (const [a, b] of [[sid, other.id], [other.id, sid]] as const) {
                emit({ type: "plan_accepted", t: T0 + (day + 3) * DAY, member: a, planId, kind: "intro", startsAt: st }, [p.id]);
                emit({ type: "plan_confirmed", t: st - 12 * HOUR, member: a, planId }, [p.id]);
                emit({ type: "plan_attended", t: st + HOUR, member: a, planId, counterparts: [b], verifiedBy: ["counterpart"], origin: "member", publicVenue: true }, [other.id]);
              }
              emit({ type: "value_received", t: st + 2 * HOUR, member: sid, with: [other.id] }, [p.id]);
            }
          }
        }
        // reciprocal help inside the ring, ~2 per week each
        if (rng.chance(2 / 7)) {
          const others = ring.filter(x => x.id !== p.id);
          const r = others.length ? rng.pick(others) : undefined;
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
        if (!rng.chance(0.5)) continue;
        const others = trio.filter(x => x.id !== p.id);
        if (!others.length) continue;
        const r = rng.pick(others);
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
        for (const m of f.members) if (!isBad(P.get(m)!.type)) honestFlagged.add(m);
      }
      for (const r of reviewQ.filter(r => r.day === day)) {
        const bad = r.members.filter(m => isBad(P.get(m)!.type));
        let confirm: string[] = [];
        if (bad.length) { if (rng.chance(0.9)) confirm = bad; }
        else if (rng.chance(0.02)) { confirm = r.members; falseConfirmed.push(...r.members); }
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
  return { seed: o.seed, personas: [...P.values()], ledger: L, values, gamingEvents, firstGaming, detectedAt, falseConfirmed, flagsRaised, honestFlagged, invites, safetyFlagDay, days };
}

export const isBad = (t: PType) => (ADVERSARY as readonly string[]).includes(t) || t === "sybil";

/** Per-member V14 rate over days [from, to]: share of days with a value event in the previous 14 days. */
export function v14Rate(values: number[] | undefined, from: number, to: number): number {
  let hit = 0, n = 0;
  for (let t = from; t <= to; t++) { n++; if ((values ?? []).some(d => d <= t && d > t - 14)) hit++; }
  return n ? hit / n : 0;
}

export { balanceOf };
