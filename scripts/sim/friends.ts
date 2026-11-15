// The friends block: friends.help in the NYC friends world (400 personas with 13-17 year olds, age
// liars, adversaries and canaries; weekly plans, partner intros and crews), the official launch gates
// (adopted 2026-10-08, all blocking) against random-within-area and the oracle on the same seeds, the
// tracked metrics (printed, non-blocking), the harness caps, and the conformance rules for friendsPack.
// PINNED (CI): seeds 5-8, 8 weeks, 400 personas (docs/results/2026-10-08-friends-pack.md, held-out).
// --quick: seed 5, 4 weeks, 200 personas; only the safety gates block.
import { canBeMatched, DAY, HOUR, localParts, type Facet, type MemberId } from "../../packages/core/src/index.ts";
import * as A from "../../packages/engine/src/attention.ts";
import { resolveConfig } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { runEngine } from "../../packages/engine/src/engine.ts";
import { candidateReason, memberReason } from "../../packages/engine/src/filters.ts";
import { DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, FRIENDS_SLOTS, ROMANCE_FRAMING, friendsInfo, friendsPack, planFriendsWeek } from "../../packages/engine/src/packs/friends/index.ts";
import { buildPlanProbe, planItem, planToProposal, type Crew, type PlanEvidence, type PlanOutcomeRecord } from "../../packages/engine/src/plans.ts";
import type { Candidate, EngineInput } from "../../packages/engine/src/types.ts";
import { World } from "../../packages/engine/src/world.ts";
import { BASELINES } from "../../packages/sim/src/apps/friends/baselines.ts";
import { officialGates, trackedMetrics } from "../../packages/sim/src/apps/friends/gates.ts";
import { friendsMetrics, type FriendsMetrics } from "../../packages/sim/src/apps/friends/metrics.ts";
import { engineInputOf, evidenceOf, friendsPackMatcher, planToProposal as toFriendsProposal } from "../../packages/sim/src/apps/friends/packMatcher.ts";
import { buildFriendsSnapshot, NYC_TZ, slotTime, type FriendsSnapshot } from "../../packages/sim/src/apps/friends/snapshot.ts";
import { SLOTS } from "../../packages/sim/src/apps/friends/persona.ts";
import { Mini, START } from "../../packages/network/test/mini.ts";
import { runFriendsWorld, VENUES } from "../../packages/sim/src/apps/friends/world.ts";
import { conformance } from "./conformance.ts";
import { Block, digest, expect } from "./gate.ts";

export const FRIENDS_PINNED = { seeds: [5, 6, 7, 8], weeks: 8, n: 400 };
const SAFETY = new Set(["minors", "known_adversary"]);

/** A friends world after `weeks` weeks of friendsPack meetups: the snapshot the engine would read next. */
const cache = new Map<number, FriendsSnapshot>();
function friendsSnapshotAfter(seed: number, weeks = 3, n = 160): FriendsSnapshot {
  if (!cache.has(seed)) {
    const r = runFriendsWorld({ seed: 100 + seed, n, weeks, matcher: friendsPackMatcher() });
    const st = r.world.state;
    st.week = weeks; st.now += 7 * 86400000;
    cache.set(seed, buildFriendsSnapshot(r.world.personas, st));
  }
  return cache.get(seed)!;
}
const friendsWorld = (seed: number): EngineInput => engineInputOf(friendsSnapshotAfter(seed));

export async function friendsScheduleGates(b: Block): Promise<void> {
  await b.run("friends repeat plans keep the local weekday and time across DST, with the minimum lead", () => {
    const s = friendsSnapshotAfter(1);
    const past = s.outcomes.find(o => o.positive.length >= 2)!;
    expect(past).toBeTruthy();
    // Replay a positive meetup from the seeded world at the clock changes, plus an ordinary week.
    // Inspect the real planner's timestamps before the harness rounds them to weekly slot indices.
    const cases = [
      ["2026-10-18T23:30:00Z", "2026-10-19T13:00:00Z", "2026-10-25T23:30:00Z"],
      ["2026-10-25T23:30:00Z", "2026-10-26T13:00:00Z", "2026-11-02T00:30:00Z"],
      ["2027-03-08T00:30:00Z", "2027-03-08T14:00:00Z", "2027-03-14T23:30:00Z"],
      ["2026-10-25T23:30:00Z", "2026-10-31T18:00:00Z", "2026-11-02T00:30:00Z"],
    ];
    const actual: string[][] = [];
    for (const [at, planningAt] of cases) {
      const now = Date.parse(planningAt!);
      const w = new World({ ...engineInputOf(s), now }, resolveConfig({ seed: 1 }), localEmbed, friendsPack);
      const outcome = { ...past, at: Date.parse(at!), positive: past.positive.slice(0, 2), attended: past.positive.slice(0, 2) };
      const wk = planFriendsWeek(w, { now, tz: NYC_TZ, evidence: new Map(), venues: VENUES.map(v => ({ ...v, hours: { weekday: [0, 24], weekend: [0, 24] } })), crews: [], outcomes: [outcome], offered: [] },
        { ...DEFAULT_FRIENDS_POLICY, crews: false, timeOptions: false }, FRIENDS_PLANS);
      actual.push(wk.repeats.map(plan => new Date(plan.window.start).toISOString()));
      for (const plan of wk.repeats) {
        expect(plan.invited).toEqual([...outcome.positive].sort());
        expect(plan.window.start).toBeGreaterThanOrEqual(now + FRIENDS_PLANS.minLeadHours * HOUR);
      }
    }
    expect(actual).toEqual(cases.map(([, , expected]) => [new Date(expected!).toISOString()]));
    for (const start of actual.flat()) expect(localParts(Date.parse(start), NYC_TZ)).toMatchObject({ weekday: 6, hour: 19, minute: 30 });
  });

  await b.run("planner: unavailable venues do not consume tables or hide viable dinner plans", () => {
    // Generate history with the unchanged random baseline, so both planner versions read the same snapshot.
    const r = runFriendsWorld({ seed: 101, n: 160, weeks: 3, matcher: BASELINES.random });
    r.world.state.week = 3; r.world.state.now += 7 * 86400000;
    const s = buildFriendsSnapshot(r.world.personas, r.world.state);
    const w = new World(engineInputOf(s), resolveConfig({ seed: 1 }), localEmbed, friendsPack);
    const counts = [];
    for (const mode of ["none", "dinner", "all"] as const) {
      const venues = mode === "none" ? [] : mode === "dinner" ? VENUES.filter(v => v.activities.includes("restaurant_dinner")) : VENUES;
      const week = planFriendsWeek(w, { now: s.now, tz: NYC_TZ, evidence: evidenceOf(w, s), venues, crews: [], outcomes: [], offered: [] },
        { ...DEFAULT_FRIENDS_POLICY, crews: false, repeat: false, partnerIntros: 0 }, FRIENDS_PLANS);
      const proposals = week.plans.map(p => toFriendsProposal(p)).filter(p => p !== null);
      counts.push({ mode, unplaced: week.plans.filter(p => !p.venueId).length });
      if (mode === "none") expect(proposals.length).toBe(0);
      else {
        expect(proposals.length).toBeGreaterThan(mode === "dinner" ? 7 : 0);
        for (const p of proposals) expect(venues.some(v => v.id === p.venueId && v.activities.includes(p.activity))).toBe(true);
      }
    }
    expect(counts).toEqual(["none", "dinner", "all"].map(mode => ({ mode, unplaced: 0 })));
  });

  await b.run("plans: every offered time fits the selected venue's opening hours", () => {
    const recurring: { seed: number; closed: number; valid: number; retained: number; sources: string[] }[] = [];
    for (const seed of [101, 102, 103]) {
      const r = runFriendsWorld({ seed, n: 160, weeks: 3, matcher: BASELINES.random });
      r.world.state.week = 3; r.world.state.now += 7 * DAY;
      const s = buildFriendsSnapshot(r.world.personas, r.world.state);
      const w = new World(engineInputOf(s), resolveConfig({ seed }), localEmbed, friendsPack);
      // A venue can serve evenings on weekdays and only mornings on weekends.
      const venues = VENUES.map(v => ({ ...v, hours: { weekday: [18, 23] as [number, number], weekend: [9, 12] as [number, number] } }));
      const wk = planFriendsWeek(w, { now: s.now, tz: NYC_TZ, evidence: evidenceOf(w, s), venues, crews: [], outcomes: [], offered: [] },
        { ...DEFAULT_FRIENDS_POLICY, crews: false, repeat: false, tableOptions: 3 }, FRIENDS_PLANS);
      const placed = wk.plans.filter(p => p.venueId);
      expect(placed.length).toBeGreaterThan(0);
      expect(placed.some(p => p.options.length > 1)).toBe(true);
      // These generated members attended a group and share climbing. Their stated windows
      // include a closed Saturday evening between an open Tuesday evening and Sunday morning.
      const pair = seed === 101 ? ["f0057", "f0159"] : seed === 102 ? ["f0060", "f0102"] : undefined;
      if (pair) {
        const windows = (["tue_eve", "sat_eve", "sun_am"] as const).map(name => {
          const start = slotTime(s.week, SLOTS.indexOf(name));
          return { start, end: start + 3 * HOUR };
        });
        const evidence = new Map<MemberId, PlanEvidence>(pair.map(id => [id, {
          memberId: id, tz: NYC_TZ, quietHours: [22, 8], stated: { windows, at: s.now, until: s.now + 7 * DAY },
        }]));
        const input = { now: s.now, tz: NYC_TZ, evidence, venues, crews: [], outcomes: [], offered: [] };
        const policy = { ...DEFAULT_FRIENDS_POLICY, crews: false, repeat: false, universal: false, universalFirst: false, singleSlot: false, loosePass: false };
        const partners = planFriendsWeek(w, input, policy, FRIENDS_PLANS).partners;
        expect(partners.length).toBe(1);
        const open = planFriendsWeek(w, { ...input, venues: venues.map(v => ({ ...v, hours: { ...v.hours, weekend: [9, 23] as [number, number] } })) }, policy, FRIENDS_PLANS).partners;
        expect(open.length).toBe(1);
        expect(open[0]!.options.length).toBe(3);
        expect(partners[0]!.window.start).toBe(open[0]!.window.start);
        expect(JSON.stringify(partners[0]!.invited)).toBe(JSON.stringify(open[0]!.invited));
        placed.push(...partners);
      }
      for (const p of placed) {
        const v = venues.find(v => v.id === p.venueId)!;
        expect(p.options.some(o => o.start === p.window.start && o.end === p.window.end)).toBe(true);
        for (const option of p.options) {
          const lp = localParts(option.start, NYC_TZ);
          const [open, close] = [0, 6].includes((lp.weekday + 1) % 7) ? v.hours.weekend : v.hours.weekday;
          const start = lp.hour + lp.minute / 60;
          expect(start).toBeGreaterThanOrEqual(open);
          expect(start + (option.end - option.start) / HOUR).toBeLessThanOrEqual(close);
        }
      }
      // Replay real crew and repeat history after venues shorten their hours. Morning plans
      // remain possible; an old successful meetup does not prove the venue is still open.
      const history = runFriendsWorld({ seed, n: 160, weeks: 3, matcher: friendsPackMatcher() });
      history.world.state.week = 3; history.world.state.now += 7 * DAY;
      const snapshot = buildFriendsSnapshot(history.world.personas, history.world.state);
      const world = new World(engineInputOf(snapshot), resolveConfig({ seed }), localEmbed, friendsPack);
      const recurringAt = (hours: [number, number]) => {
        const next = planFriendsWeek(world, { now: snapshot.now, tz: NYC_TZ, evidence: new Map(),
          venues: VENUES.map(v => ({ ...v, hours: { weekday: hours, weekend: hours } })),
          crews: snapshot.crews, outcomes: snapshot.outcomes, offered: snapshot.offered },
        { ...DEFAULT_FRIENDS_POLICY, timeOptions: false }, FRIENDS_PLANS);
        return [...next.sessions, ...next.offers.map(x => x.first), ...next.repeats];
      };
      const open = recurringAt([0, 24]), morning = recurringAt([9, 12]);
      const fitsMorning = (p: (typeof open)[number]) => {
        const lp = localParts(p.window.start, NYC_TZ), hour = lp.hour + lp.minute / 60;
        return hour >= 9 && hour + (p.window.end - p.window.start) / HOUR <= 12;
      };
      const valid = open.filter(fitsMorning);
      expect(valid.length).toBeGreaterThan(0);
      expect(open.some(p => !fitsMorning(p))).toBe(true);
      const retained = valid.filter(p => morning.some(q => q.id === p.id && Bun.deepEquals(q.invited, p.invited)));
      recurring.push({ seed, closed: morning.filter(p => !fitsMorning(p)).length, valid: valid.length,
        retained: retained.length, sources: [...new Set(open.map(p => p.source))].sort() });
    }
    expect([...new Set(recurring.flatMap(r => r.sources))].sort()).toEqual(["crew_offer", "crew_session", "repeat"]);
    for (const r of recurring) { expect(r.closed).toBe(0); expect(r.retained).toBe(r.valid); }
  });

  await b.run("availability: future weekly slots do not change current plans; active slots still take effect", () => {
    const failures: number[] = [];
    for (const seed of [101]) {
      const r = runFriendsWorld({ seed, n: 160, weeks: 3, matcher: BASELINES.random });
      r.world.state.week = 3; r.world.state.now += 7 * DAY;
      const s = buildFriendsSnapshot(r.world.personas, r.world.state);
      const extra: Facet[] = s.members.filter(m => canBeMatched(m.age)).map(m => ({
        id: `future-free-${m.id}`, memberId: m.id, kind: "availability_pattern", value: "Additional weekly availability",
        tags: FRIENDS_SLOTS.map(slot => `friends:free:${slot}`), scope: "agent_private", provenance: "said", confidence: 1,
        source: "chat", confirmedByMember: true, validFrom: s.now + 30 * DAY,
      }));
      const plan = (added: Facet[]) => {
        const snap = { ...s, facets: [...s.facets, ...added] };
        const w = new World(engineInputOf(snap), resolveConfig({ seed }), localEmbed, friendsPack);
        return planFriendsWeek(w, { now: s.now, tz: NYC_TZ, evidence: evidenceOf(w, snap), venues: VENUES,
          crews: s.crews.filter(c => !c.handedOff), outcomes: s.outcomes, offered: s.offered }, DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS);
      };
      const base = plan([]), future = plan(extra);
      const active = plan(extra.map(f => ({ ...f, validFrom: s.now })));
      const expired = plan(extra.map(f => ({ ...f, validFrom: s.now - 30 * DAY, validTo: s.now - 1 })));
      expect(base.plans.length).toBeGreaterThan(0);
      expect(Bun.deepEquals(expired, base)).toBe(true);
      // Positive control: the very same availability matters at its inclusive start boundary.
      expect(Bun.deepEquals(active, base)).toBe(false);
      const sameFuturePlans = Bun.deepEquals(future, base);
      if (!sameFuturePlans) failures.push(seed);
    }
    expect(failures).toEqual([]);
  });

  await b.run("crew hosts: sessions and offers assign hosting only to retained invitees", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const venue = VENUES.find(v => v.activities.includes("restaurant_dinner") && v.hours.weekday[1] >= 21)!;
    const rows: { seed: number; source: string; change: string; turn: number; host?: string; expectedHost: string; invited: string[]; correct: boolean }[] = [];
    for (const seed of [7]) for (const source of ["session", "offer"]) for (const turn of source === "session" ? [0, 1, 2] : [0]) {
      for (const change of ["control", "paused", "travel", "all_hosts_paused", "all_hosts_travel"]) {
        const mini = new Mini(ids.map((id, i) => ({ id, name: ["Ana Diaz", "Ben Ito", "Cara Li", "Dan Wu", "Eva Park", "Finn Ray"][i]!, age: 30, area: venue.area, interests: ["cooking"], skills: i < 3 ? ["hosting"] : [] })));
        for (const id of ids) mini.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
        const excluded = change === "control" ? [] : change.startsWith("all_hosts") ? ["a", "b", "c"] : ["a"];
        for (const id of excluded) {
          if (change.endsWith("paused")) mini.members.find(m => m.id === id)!.state = "paused";
          else mini.facets.push({ id: `${id}:travel`, memberId: id, kind: "preference", value: "Travel at most one minute", tags: ["friends:max_travel:1"], scope: "agent_private", provenance: "said", confidence: 1 });
        }
        const w = new World(JSON.parse(JSON.stringify(mini.ctx().snapshot())), resolveConfig({ seed }), localEmbed, friendsPack);
        const crew: Crew = { id: "crew_host_regression", activityId: "restaurant_dinner", city: "nyc", venueId: venue.id, members: ids, cadenceDays: 7, hostRotation: ["a", "b", "c"], sessions: Array.from({ length: turn }, (_, i) => `earlier-${i}`), handedOff: false, slot: { start: Date.UTC(2026, 9, 2, 23) } };
        const outcome: PlanOutcomeRecord = { planId: "earlier", activityId: crew.activityId, city: "nyc", venueId: venue.id, at: crew.slot.start, attended: ids, positive: ids, recurringWant: [] };
        const savedCrew = JSON.stringify(crew);
        const week = planFriendsWeek(w, { now: START, tz: NYC_TZ, evidence: new Map(ids.map(id => [id, { memberId: id, tz: NYC_TZ }])), venues: VENUES, crews: source === "session" ? [crew] : [], outcomes: source === "offer" ? [outcome] : [], offered: [] },
          { ...DEFAULT_FRIENDS_POLICY, repeat: false, tables: false, singleSlot: false, partnerFallback: false, partnerIntros: 0, universal: false, loosePass: false }, FRIENDS_PLANS);
        expect(JSON.stringify(crew)).toBe(savedCrew);
        const plans = source === "session" ? week.sessions : week.offers.map(x => x.first);
        expect(plans.length).toBe(1);
        // Plans cross the persisted/queued JSON boundary before role and effort accounting.
        const plan = JSON.parse(JSON.stringify(plans[0]!)) as typeof plans[number];
        const expectedHost = change.startsWith("all_hosts") ? ["d", "e", "f"][turn]! : change === "control" ? ["a", "b", "c"][turn]! : ["b", "b", "c"][turn]!;
        const expectedInvited = ids.filter(id => !excluded.includes(id));
        const proposal = planToProposal(plan);
        const items = plan.invited.map(id => planItem(plan, id, { now: START }));
        expect(items.every(item => item.reviewState === "pending")).toBe(true);
        const hosts = Object.entries(proposal.roles).filter(([, role]) => role === "host").map(([id]) => id);
        const contributions = items.filter(item => item.effort === "contribute").map(item => item.memberId);
        const correct = plan.hostId === expectedHost && Bun.deepEquals(plan.invited, expectedInvited)
          && Bun.deepEquals(hosts, [expectedHost]) && Bun.deepEquals(contributions, [expectedHost]);
        rows.push({ seed, source, change, turn, host: plan.hostId, expectedHost, invited: plan.invited, correct });
      }
    }
    expect(rows.filter(r => r.correct).length).toBe(rows.length);
  });

  await b.run("availability: crew offers use the statement time, not the member's join date", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const venue = VENUES.find(v => v.activities.includes("restaurant_dinner") && v.hours.weekday[1] >= 21)!;
    const rows: { seed: number; kind: string; tuesdayOffered: boolean; correct: boolean }[] = [];
    for (const seed of [7]) for (const kind of ["recent_observed", "recent_valid", "old_observed", "legacy", "recent_member_old_fact", "mixed"]) {
      const mini = new Mini(ids.map((id, i) => ({ id, name: ["Ana Diaz", "Ben Ito", "Cara Li", "Dan Wu", "Eva Park", "Finn Ray"][i]!, age: 30, area: venue.area, interests: ["cooking"], skills: i < 3 ? ["hosting"] : [] })));
      const old = START - 180 * DAY;
      for (const m of mini.members) m.joinedAt = kind === "recent_member_old_fact" ? START : old;
      for (const id of ids) {
        mini.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
        mini.facets.push({ id: `${id}:free`, memberId: id, kind: "availability_pattern", value: "Usually free Tuesday evenings", tags: ["friends:free:tue_eve"], scope: "agent_private", provenance: "said", confidence: 1,
          ...(kind !== "legacy" ? { validFrom: kind === "recent_observed" || kind === "mixed" ? old : START } : {}),
          ...(["recent_observed", "mixed"].includes(kind) ? { observedAt: START } : ["old_observed", "recent_member_old_fact"].includes(kind) ? { observedAt: old } : {}) });
        if (kind === "mixed") mini.facets.push({ id: `${id}:older-free`, memberId: id, kind: "availability_pattern", value: "Usually free Sunday evenings", tags: ["friends:free:sun_eve"], scope: "agent_private", provenance: "said", confidence: 1, validFrom: old, observedAt: old });
      }
      // Read persisted facts into the real profile reader and weekly planner, with the default policy.
      const w = new World(JSON.parse(JSON.stringify(mini.ctx().snapshot())), resolveConfig({ seed }), localEmbed, friendsPack);
      const info = friendsInfo(w);
      const outcome: PlanOutcomeRecord = { planId: "earlier", activityId: "restaurant_dinner", city: "nyc", venueId: venue.id, at: Date.UTC(2026, 9, 2, 23), attended: ids, positive: ids, recurringWant: [] };
      const week = planFriendsWeek(w, { now: START, tz: NYC_TZ, evidence: new Map(ids.map(id => [id, { memberId: id, tz: NYC_TZ, standing: info.get(id)!.standing }])), venues: VENUES, crews: [], outcomes: [outcome], offered: [] }, DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS);
      expect(week.offers.length).toBe(1);
      const plan = JSON.parse(JSON.stringify(week.offers[0]!.first)) as typeof week.offers[number]["first"];
      expect(plan.invited).toEqual(ids);
      expect(plan.options.some(s => s.start === Date.UTC(2026, 9, 9, 23))).toBe(true);
      expect(plan.invited.every(id => planItem(plan, id, { now: START }).reviewState === "pending")).toBe(true);
      const tuesdayOffered = plan.options.some(s => { const p = localParts(s.start, NYC_TZ); return p.weekday === 1 && p.hour === 19; });
      const fresh = ["recent_observed", "recent_valid", "mixed"].includes(kind);
      const expectedTimes = kind === "mixed" ? [START, old] : [fresh ? START : old];
      const correct = tuesdayOffered === fresh && ids.every(id => Bun.deepEquals(info.get(id)!.standing.map(s => s.statedAt), expectedTimes));
      rows.push({ seed, kind, tuesdayOffered, correct });
    }
    expect(rows.filter(x => x.correct).length).toBe(rows.length);
  });
}

export async function friendsBlock(b: Block, o: { quick: boolean }): Promise<void> {
  await friendsScheduleGates(b);
  const spec = o.quick ? { seeds: [5], weeks: 4, n: 200 } : FRIENDS_PINNED;
  const all: Record<"pack" | "random" | "oracle", FriendsMetrics[]> = { pack: [], random: [], oracle: [] };
  const matchers = { pack: friendsPackMatcher(), random: BASELINES.random, oracle: BASELINES.oracle };
  for (const arm of ["pack", "random", "oracle"] as const) for (const seed of spec.seeds) all[arm].push(friendsMetrics(runFriendsWorld({ seed, n: spec.n, weeks: spec.weeks, matcher: matchers[arm] })));
  b.track("fingerprint: pack, random and oracle arms", true, digest(all));
  for (const g of officialGates(all.pack, all.random, all.oracle)) b.gate(`gate ${g.gate}`, g.pass, g.value, SAFETY.has(g.id) || !o.quick);
  for (const g of trackedMetrics(all.pack, all.random)) b.track(`tracked ${g.gate}`, g.pass, g.value);
  b.gate("pack: 0 declared-minor proposals", all.pack.every(m => m.safety.declaredMinorProposals === 0));

  await b.run("harness: deterministic; no arm contacts a declared minor; tables of at most 6, at most 2 meetups a member a week", () => {
    const runs = [...(["random", "greedy", "oracle"] as const).map(n => runFriendsWorld({ seed: 2, n: 200, weeks: 3, matcher: BASELINES[n] })), runFriendsWorld({ seed: 2, n: 200, weeks: 3, matcher: friendsPackMatcher() })];
    for (const r of runs) {
      const m = friendsMetrics(r);
      expect(m.proposals).toBeGreaterThan(0);
      expect(m.safety.declaredMinorContacts).toBe(0);
      const meet = new Map<string, number>();
      for (const f of r.flows) { expect(f.going.length).toBeLessThanOrEqual(6); for (const id of f.booked) meet.set(`${id}|${f.week}`, (meet.get(`${id}|${f.week}`) ?? 0) + 1); }
      for (const v of meet.values()) expect(v).toBeLessThanOrEqual(2);
    }
    expect(JSON.stringify(friendsMetrics(runFriendsWorld({ seed: 2, n: 200, weeks: 3, matcher: friendsPackMatcher() })))).toBe(JSON.stringify(friendsMetrics(runs[3]!)));
    // Negative control: random ignores verification and meets adversaries; the oracle never does.
    expect(friendsMetrics(runs[0]!).safety.adversaryContacts).toBeGreaterThan(0);
    expect(friendsMetrics(runs[2]!).safety.adversaryContacts + friendsMetrics(runs[2]!).safety.hiddenMinorContacts).toBe(0);
  });

  // ---- conformance: core rules on friends worlds, then the friends rules ------------------------------
  const seeds = o.quick ? [1, 2] : [1, 2, 3, 4];
  await conformance(b, friendsPack, { world: friendsWorld, seeds });
  const worldOf = (seed: number) => new World(friendsWorld(seed), resolveConfig({ seed }), localEmbed, friendsPack);
  const weekOf = (seed: number) => {
    const s = friendsSnapshotAfter(seed), w = worldOf(seed);
    return { s, w, wk: planFriendsWeek(w, { now: s.now, tz: NYC_TZ, evidence: evidenceOf(w, s), venues: VENUES, crews: s.crews.filter(c => !c.handedOff), outcomes: s.outcomes, offered: s.offered }, DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS) };
  };
  const allPlans = (wk: ReturnType<typeof weekOf>["wk"]) => [...wk.sessions, ...wk.offers.map(x => x.first), ...wk.repeats, ...wk.plans, ...wk.partners];

  await b.run("conformance friends: no romance at any layer (lane, member, pair, attention item, probe, explanations, plan probes)", async () => {
    expect(friendsPack.ontology.lanes.map(l => l.id)).not.toContain("romance");
    expect(friendsPack.ontology.objectives.some(x => x.romance)).toBe(false);
    const w = worldOf(1);
    const adults = w.ids.filter(id => !memberReason(w, id, { category: "social", role: "peer", format: "small_group", timeSensitive: false }));
    expect(adults.length).toBeGreaterThan(20);
    const [a, c] = adults as [MemberId, MemberId];
    expect(memberReason(w, a, { category: "romance", role: "peer", format: "one_to_one", timeSensitive: false })).toBe("romance_excluded");
    const cand = { key: "x", kind: "intro", generator: "x", category: "romance", participants: [a, c], roles: { [a]: "peer", [c]: "peer" }, format: "one_to_one", objective: "x", channels: new Set<string>(), evidence: {}, fit: 1, benefit: {}, warm: 0, alternates: [], exploration: false, safetyClass: "low", timeSensitive: false, riskText: "" } as unknown as Candidate;
    expect(candidateReason(w, cand)).toBe("romance_excluded");
    expect(friendsPack.attention.itemGate!({ age: 30 }, { category: "romance" })).not.toBeNull();
    expect(friendsPack.attention.probeAllowed!("romance", 1)).toBe(false);
    for (const seed of seeds) {
      const { s, w: ww, wk } = weekOf(seed);
      const r = await runEngine(friendsWorld(seed), { seed }, { pack: friendsPack });
      expect(r.proposals.length).toBeGreaterThan(0);
      for (const p of r.proposals) {
        expect(["social", "hobby"]).toContain(p.category);
        for (const t of Object.values(p.explanations)) expect(t).not.toMatch(ROMANCE_FRAMING);
        for (const me of p.participants) { const probe = A.buildProbe(ww, { proposalId: p.id, kind: p.kind, category: p.category, objective: p.objective, window: p.window, tz: NYC_TZ }, me, p.participants.filter(x => x !== me), s.now); if (probe) expect(probe.text).not.toMatch(ROMANCE_FRAMING); }
      }
      let probes = 0;
      for (const p of allPlans(wk)) for (const me of p.invited) { const t = buildPlanProbe(ww, p, me, NYC_TZ); if (t) { probes++; expect(t).not.toMatch(ROMANCE_FRAMING); expect(t).not.toMatch(/canary/i); } }
      expect(probes).toBeGreaterThan(0);
    }
  });

  await b.run("conformance friends: no minors in any plan role (sessions, offers, repeats, plans, partners)", () => {
    for (const seed of seeds) {
      const { w, wk } = weekOf(seed);
      const plans = allPlans(wk);
      expect(plans.length).toBeGreaterThan(0);
      for (const p of plans) for (const id of [...p.invited, ...p.alternates, ...(p.hostId ? [p.hostId] : [])]) expect(canBeMatched(w.get(id)!.m.age)).toBe(true);
    }
  });

  await b.run("conformance friends: adversaries the Network can see are held (no uncleared cue, unpassed check or hold in any proposal or plan)", async () => {
    for (const seed of seeds) {
      const { w, wk } = weekOf(seed);
      const info = friendsInfo(w);
      const flagged = new Set(w.ids.filter(id => info.get(id)!.safetyCue || !info.get(id)!.verified || w.holds.has(id)));
      expect(flagged.size).toBeGreaterThan(0);
      for (const p of (await runEngine(friendsWorld(seed), { seed }, { pack: friendsPack })).proposals) for (const id of [...p.participants, ...p.alternates]) expect(flagged.has(id)).toBe(false);
      for (const p of allPlans(wk)) for (const id of [...p.invited, ...p.alternates]) expect(flagged.has(id)).toBe(false);
    }
  });
}
