// The slop.date harness: weekly rounds over a population. Each week the matcher reads ONLY the
// snapshot (plus its typed reader, visible.ts) and returns date proposals; the harness runs the
// probe-first flow with the booked-plan reveal (docs/design/2026-10-07-experience-design.md 1.8;
// docs/results/2026-10-07-attention-budget.md iteration 4, design (c) pre-commit):
//   1. probe the first member (the one with the live want) with 2-3 time options;
//   2. on a yes, probe the partner with the slots the first member picked;
//   3. on both yeses, the reveal IS the booked plan ("You're both in: meet Sam, Thu 7pm. Reply if
//      you can't make it."); silence = in, a back-out cancels;
//   4. the agent planned the date (activity, time, area): both show or not; the oracle scores it;
//   5. feedback, a possible second date, safety reports.
// Caps: each member gets at most `capPerWeek` initial invites a week (first probe or partner probe;
// decision 3) and at most one booked date a week. Proposals past a cap are dropped and counted.
import { DAY, HOUR, canBeMatched, type MemberId } from "@thenetwork/core";
import type { InteractionRecord } from "@thenetwork/engine/src/types.ts";
import { Rng, hash32 } from "@thenetwork/sim/src/rng.ts";
import { SlopBehavior, type HarmEvent } from "./behavior.ts";
import type { SlopCity } from "./geo.ts";
import { SlopOracle, type DateOutcome } from "./oracle.ts";
import { SLOTS, SLOT_DAY, generateSlopPersonas, type DateActivity, type SlopGenOptions, type SlopPersona } from "./persona.ts";
import { SLOP_WORLD_START, buildSlopSnapshot, type SlopNetworkState, type SlopSnapshot } from "./snapshot.ts";
import { visibleProfiles, type VisibleProfile } from "./visible.ts";

/** One date proposal from a matcher. `options`: slot indices into SLOTS (2-3). */
export interface SlopProposal {
  first: MemberId; partner: MemberId; city: SlopCity; activity: DateActivity; options: number[];
  /** The one shareable fact in the probe (an interest tag of the other person), if any. */
  sharedFact?: string;
}
export interface MatcherContext {
  week: number; snapshot: SlopSnapshot; profiles: Map<MemberId, VisibleProfile>;
  /** Seeded per run and week. */
  rng: Rng; capPerWeek: number;
}
export interface SlopMatcher { name: string; propose(ctx: MatcherContext): SlopProposal[] }

/** Harness-side record of one proposal and everything that happened to it (includes hidden truth). */
export interface FlowRecord {
  key: string; week: number; first: MemberId; partner: MemberId; city: SlopCity; activity: DateActivity; options: number[];
  stage: "dropped_policy" | "dropped_first_cap" | "first_silent" | "first_no" | "dropped_partner_cap" | "partner_silent" | "partner_no"
    | "backout" | "no_show" | "date";
  firstYes?: boolean; partnerYes?: boolean; mutualYes: boolean;
  /** The reveal happened (names exchanged): the members are in contact. */
  revealed: boolean; slot?: number; seatsNotFree?: number;
  filterViolation: boolean; outcome?: DateOutcome; good?: boolean; secondDate?: boolean;
  harms: HarmEvent[];
  /** Policy: a member with a claimed age under 18 was in the proposal (must never happen). */
  declaredMinor: boolean;
  day?: number;
}

export interface SlopRunOptions extends Omit<SlopGenOptions, "seed"> {
  seed: number;
  weeks?: number;
  capPerWeek?: number;
  /** A matcher, or a factory that gets the world (oracle baselines need hidden truth). */
  matcher: SlopMatcher | ((w: SlopWorld) => SlopMatcher);
  personas?: SlopPersona[];
}

export interface SlopWorld {
  seed: number; weeks: number; personas: SlopPersona[]; oracle: SlopOracle; behavior: SlopBehavior;
  state: SlopNetworkState;
}

export interface SlopRunResult { world: SlopWorld; flows: FlowRecord[]; matcher: string }

const SLOT_HOUR: Record<string, number> = { day: 14, eve: 19 };
export const slotTime = (week: number, slot: number) =>
  SLOP_WORLD_START + (week * 7 + SLOT_DAY[SLOTS[slot]!]) * DAY + SLOT_HOUR[SLOTS[slot]!.endsWith("day") ? "day" : "eve"]! * HOUR;

export function createSlopWorld(o: Omit<SlopRunOptions, "matcher">): SlopWorld {
  const weeks = o.weeks ?? 4;
  const personas = o.personas ?? generateSlopPersonas({ ...o, seed: o.seed, weeks });
  const oracle = new SlopOracle(personas, o.seed);
  return {
    seed: o.seed, weeks, personas, oracle, behavior: new SlopBehavior(oracle, o.seed),
    state: { now: SLOP_WORLD_START, week: 0, interactions: [], feedback: [], safetyHolds: [], inboundAsks: [], edges: [], paused: new Set() },
  };
}

export function runSlopWorld(o: SlopRunOptions): SlopRunResult {
  const world = createSlopWorld(o);
  const matcher = typeof o.matcher === "function" ? o.matcher(world) : o.matcher;
  const cap = o.capPerWeek ?? 2;
  const { oracle, behavior, state } = world;
  const flows: FlowRecord[] = [];
  const likedWeek = new Map<MemberId, number>();
  for (let week = 0; week < world.weeks; week++) {
    state.week = week;
    state.now = SLOP_WORLD_START + week * 7 * DAY;
    const askedNow = new Set<MemberId>();
    for (const p of world.personas) {
      if (!canBeMatched(p.stated.claimedAge) || state.paused.has(p.id)) continue;
      if (behavior.asksThisWeek(p.id, week)) { askedNow.add(p.id); state.inboundAsks.push({ memberId: p.id, at: state.now + 9 * HOUR }); }
    }
    state.now += 12 * HOUR; // the matcher runs Monday noon UTC, after the morning asks
    const snapshot = buildSlopSnapshot(world.personas, state);
    const profiles = visibleProfiles(snapshot);
    const proposals = matcher.propose({ week, snapshot, profiles, rng: new Rng(hash32(o.seed, "matcher", week)), capPerWeek: cap });
    const invites = new Map<MemberId, number>(), booked = new Set<MemberId>();
    const inc = (id: MemberId) => invites.set(id, (invites.get(id) ?? 0) + 1);
    proposals.forEach((pr, i) => {
      const key = `w${week}:${i}:${pr.first}:${pr.partner}`;
      const a = oracle.byId.get(pr.first), b = oracle.byId.get(pr.partner);
      const f: FlowRecord = { key, week, first: pr.first, partner: pr.partner, city: pr.city, activity: pr.activity, options: [...pr.options],
        stage: "dropped_policy", mutualYes: false, revealed: false, filterViolation: false, harms: [], declaredMinor: false };
      flows.push(f);
      if (!a || !b || a.id === b.id) return;
      f.filterViolation = !oracle.statedMutual(a, b, week);
      if (!canBeMatched(a.stated.claimedAge) || !canBeMatched(b.stated.claimedAge)) { f.declaredMinor = true; return; }
      if (state.paused.has(a.id) || state.paused.has(b.id)) return;
      const interaction: InteractionRecord = { id: key, kind: "intro", category: "romance", participants: [a.id, b.id], at: state.now, outcome: "pending" };
      const done = (outcome: InteractionRecord["outcome"], extra: Partial<InteractionRecord> = {}) => state.interactions.push({ ...interaction, outcome, ...extra });
      const ctx = (id: MemberId) => ({
        week, city: pr.city, activity: pr.activity, asked: askedNow.has(id),
        recentLikedDate: likedWeek.has(id) && week - likedWeek.get(id)! <= 2,
        probesThisWeek: invites.get(id) ?? 0,
        sharedFactMatch: !!pr.sharedFact && oracle.p(id).hidden.interests.includes(pr.sharedFact),
      });
      // 1. first probe
      if ((invites.get(a.id) ?? 0) >= cap || booked.has(a.id)) { f.stage = "dropped_first_cap"; return; }
      const c1 = ctx(a.id); inc(a.id);
      const ans1 = behavior.answerProbe(a.id, key, c1, pr.options);
      f.firstYes = ans1.yes;
      if (!ans1.replied) { f.stage = "first_silent"; done("expired", { noResponse: [a.id] }); return; }
      if (!ans1.yes) { f.stage = "first_no"; done("declined", { declinedBy: [a.id] }); return; }
      // 2. partner probe, offered the first member's picks (or the original options)
      if ((invites.get(b.id) ?? 0) >= cap || booked.has(b.id)) { f.stage = "dropped_partner_cap"; done("expired", { acceptedBy: [a.id] }); return; }
      const opts2 = ans1.picks.length ? ans1.picks : pr.options;
      const c2 = ctx(b.id); inc(b.id);
      const ans2 = behavior.answerProbe(b.id, key, c2, opts2);
      f.partnerYes = ans2.yes;
      if (!ans2.replied) { f.stage = "partner_silent"; done("expired", { acceptedBy: [a.id], noResponse: [b.id] }); return; }
      if (!ans2.yes) { f.stage = "partner_no"; done("declined", { acceptedBy: [a.id], declinedBy: [b.id] }); return; }
      f.mutualYes = true;
      // 3. reveal = booked plan, at a slot both picked, else the agent's best guess (first option offered)
      const both = ans1.picks.filter(s => ans2.picks.includes(s));
      const slot = both[0] ?? opts2[0]!;
      f.slot = slot; f.revealed = true; f.day = week * 7 + SLOT_DAY[SLOTS[slot]!];
      f.harms.push(...behavior.harms(a.id, b.id, key, "reveal"));
      const outA = behavior.backsOut(a.id, b.id, key, oracle.statedAccepts(a, b, week));
      const outB = behavior.backsOut(b.id, a.id, key, oracle.statedAccepts(b, a, week));
      if (outA || outB) { f.stage = "backout"; done("cancelled", { acceptedBy: [a.id, b.id], declinedBy: [...(outA ? [a.id] : []), ...(outB ? [b.id] : [])] }); applyHarms(world, f.harms); return; }
      booked.add(a.id); booked.add(b.id);
      // 4. the date
      const freeA = !!a.hidden.adversary || oracle.free(a.id, week, slot), freeB = !!b.hidden.adversary || oracle.free(b.id, week, slot);
      f.seatsNotFree = (freeA ? 0 : 1) + (freeB ? 0 : 1);
      const showA = behavior.attends(a.id, key, freeA), showB = behavior.attends(b.id, key, freeB);
      const at = slotTime(week, slot);
      if (!showA || !showB) {
        f.stage = "no_show"; done("no_show", { acceptedBy: [a.id, b.id], at }); applyHarms(world, f.harms); return;
      }
      f.stage = "date";
      const o2 = oracle.dateOutcome(a.id, b.id, pr.activity);
      f.outcome = o2; f.good = o2.good;
      f.harms.push(...behavior.harms(a.id, b.id, key, "date"));
      done("completed", { acceptedBy: [a.id, b.id], at });
      state.edges.push({ from: a.id, to: b.id, type: "met", strength: 1, explicit: true, createdAt: at });
      for (const [id, other, side] of [[a.id, b.id, "a"], [b.id, a.id, "b"]] as const) {
        const fb = behavior.feedback(id, key, o2, side);
        if (fb.replied) state.feedback.push({ id: `fb:${key}:${id}`, from: id, about: other, opportunityId: key, at: at + 20 * HOUR, sentiment: fb.sentiment, wouldMeetAgain: fb.wouldMeetAgain });
        if ((side === "a" ? o2.wantsSecondA : o2.wantsSecondB)) likedWeek.set(id, week);
      }
      f.secondDate = behavior.secondDate(key, o2);
      if (f.secondDate) for (const id of [a.id, b.id]) if (behavior.pausesAfterSecond(id, key)) state.paused.add(id);
      applyHarms(world, f.harms);
    });
  }
  return { world, flows, matcher: matcher.name };
}

/** Reported harms: the offender goes on a safety hold, the victim blocks them (both visible). */
function applyHarms(w: SlopWorld, harms: HarmEvent[]) {
  for (const h of harms) {
    if (!h.reported) continue;
    // A reported minor contact ("they seemed underage") holds the minor, not the reporter.
    const held = h.kind === "minor_contact" ? h.victim : h.offender;
    if (!w.state.safetyHolds.some(x => x.memberId === held)) w.state.safetyHolds.push({ memberId: held, from: w.state.now, reason: `reported: ${h.kind}` });
    if (h.kind !== "minor_contact") w.state.edges.push({ from: h.victim, to: h.offender, type: "blocked", strength: 1, explicit: true, createdAt: w.state.now });
  }
}
