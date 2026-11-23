import { isDeepStrictEqual } from "node:util";
// The friends block: friends.help in the NYC friends world (400 personas with 13-17 year olds, age
// liars, adversaries and canaries; weekly plans, partner intros and crews), the official launch gates
// (adopted 2026-10-08, all blocking) against random-within-area and the oracle on the same seeds, the
// tracked metrics (printed, non-blocking), the harness caps, and the conformance rules for friendsPack.
// PINNED (CI): seeds 5-8, 8 weeks, 400 personas (docs/results/2026-10-08-friends-pack.md, held-out).
// --quick: seed 5, 4 weeks, 200 personas; only the safety gates block.
import { ageSideOf, canBeMatched, DAY, HOUR, latestDayKeyOf, localParts, type Facet, type MemberId } from "../../packages/core/src/index.ts";
import * as A from "../../packages/engine/src/attention.ts";
import { resolveConfig } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { runEngine } from "../../packages/engine/src/engine.ts";
import { candidateReason, memberReason } from "../../packages/engine/src/filters.ts";
import { DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, FRIENDS_SLOTS, ROMANCE_FRAMING, attendedGroup, friendsInfo, friendsPack, planFriendsWeek } from "../../packages/engine/src/packs/friends/index.ts";
import { buildPlanProbe, planItem, venueAgesIn, planToProposal, type Crew, type PlanEvidence, type PlanOutcomeRecord } from "../../packages/engine/src/plans.ts";
import type { Candidate, EngineInput } from "../../packages/engine/src/types.ts";
import { World } from "../../packages/engine/src/world.ts";
import { BASELINES } from "../../packages/sim/src/apps/friends/baselines.ts";
import { hTeen, officialGates, opennessGroups, teenGates, teenTracked, trackedMetrics } from "../../packages/sim/src/apps/friends/gates.ts";
import { friendsMetrics, friendsOutboundLog, type FriendsMetrics } from "../../packages/sim/src/apps/friends/metrics.ts";
import { engineInputOf, evidenceOf, friendsPackMatcher, friendsTeenMatcher, planToProposal as toFriendsProposal } from "../../packages/sim/src/apps/friends/packMatcher.ts";
import { buildFriendsSnapshot, slotTime, visibleRedFlag, weekTime, type FriendsSnapshot } from "../../packages/sim/src/apps/friends/snapshot.ts";
import { isReal, NYC_TZ, SLOTS } from "../../packages/sim/src/apps/friends/persona.ts";
import { TEEN_WORLD } from "../../packages/sim/src/generator.ts";
import { Mini, START } from "../../packages/network/test/mini.ts";
import { PLAN_VENUES } from "../../packages/network/src/plans.ts";
import { runFriendsWorld, runFriendsWorldAsync, slotOfCrew, VENUE_BY_ID, VENUES, type MeetupRecord } from "../../packages/sim/src/apps/friends/world.ts";
import { ACTIVITIES, activityAllAges, activityById, venueAllAges } from "../../packages/engine/src/packs/network/activities.ts";
import { groupAgeAllowed, rosterHasMinor, teenPlaceAllowed, teenRosterSizeAllowed } from "../../packages/core/src/generated/friendIntroAge.ts";
import { teenFriendCategory } from "../../packages/core/src/generated/matchLane.ts";
import { teenWindowAllowed } from "../../packages/sim/src/teen.ts";
import { conformance, teenConformance } from "./conformance.ts";
import { Block, digest, expect } from "./gate.ts";
import { idsSalted, overlap, pairedLine } from "../../packages/sim/src/paired.ts";

export const FRIENDS_PINNED = { seeds: [5, 6, 7, 8], weeks: 8, n: 400 };
const meetupKeys = (meetups: readonly MeetupRecord[]) => meetups.map(m => `${m.activity}:${[...m.attendees].sort().join(",")}`).sort();
const SAFETY = new Set(["minors", "known_adversary", "openness"]);

/** A friends world after `weeks` weeks of friendsPack meetups: the snapshot the engine would read next. */
const cache = new Map<number, FriendsSnapshot>();
function friendsSnapshotAfter(seed: number, weeks = 3, n = 160): FriendsSnapshot {
  if (!cache.has(seed)) {
    const r = runFriendsWorld({ seed: 100 + seed, n, weeks, teenStop: true, matcher: friendsPackMatcher() });
    const st = r.world.state;
    st.week = weeks; st.now += 7 * 86400000;
    cache.set(seed, buildFriendsSnapshot(r.world.personas, st));
  }
  return cache.get(seed)!;
}
const friendsWorld = (seed: number): EngineInput => engineInputOf(friendsSnapshotAfter(seed));
const teenCache = new Map<number, FriendsSnapshot>();
async function teenSnapshotAfter(seed: number): Promise<FriendsSnapshot> {
  if (!teenCache.has(seed)) {
    const r = await runFriendsWorldAsync({ seed: 100 + seed, n: 400, weeks: 3, ...TEEN_WORLD, matcher: friendsTeenMatcher() });
    const st = r.world.state;
    st.week = 3; st.now += 7 * DAY;
    teenCache.set(seed, buildFriendsSnapshot(r.world.personas, st));
  }
  return teenCache.get(seed)!;
}

export async function friendsScheduleGates(b: Block): Promise<void> {
  await friendsReachableVenueGate(b);
  await friendsActivityDurationGate(b);
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
      if (!placed.length) throw new Error(`seed ${seed} produced no new table with an open venue`);
      expect(placed.some(p => p.options.length > 1)).toBe(true);
      if (seed === 101 || seed === 102) {
        const windows = (["tue_eve", "sat_eve", "sun_am"] as const).map(name => {
          const start = slotTime(s.week, SLOTS.indexOf(name));
          return { start, end: start + 3 * HOUR };
        });
        const policy = { ...DEFAULT_FRIENDS_POLICY, crews: false, repeat: false, universal: false };
        const inputOf = (pair: readonly MemberId[]) => ({ now: s.now, tz: NYC_TZ, venues, crews: [], outcomes: [], offered: [], evidence: new Map<MemberId, PlanEvidence>(pair.map(id => [id, {
          memberId: id, tz: NYC_TZ, quietHours: [22, 8], stated: { windows, at: s.now, until: s.now + 7 * DAY },
        }])) });
        const openVenues = venues.map(v => ({ ...v, hours: { ...v.hours, weekend: [9, 23] as [number, number] } }));
        const veterans = r.world.personas.filter(p => isReal(p) && attendedGroup(w, p.id)).sort((a, b) => a.id.localeCompare(b.id));
        let pair: MemberId[] | undefined, partners: ReturnType<typeof planFriendsWeek>["partners"] = [];
        for (let i = 0; i < veterans.length && !pair; i++) for (let j = i + 1; j < veterans.length && !pair; j++) {
          const a = veterans[i]!, c = veterans[j]!;
          if (!a.stated.activities.some(x => c.stated.activities.includes(x))) continue;
          const found = planFriendsWeek(w, inputOf([a.id, c.id]), policy, FRIENDS_PLANS).partners;
          if (found.length === 1) { pair = [a.id, c.id]; partners = found; }
        }
        if (!pair) throw new Error(`seed ${seed}: no pair of group veterans with a shared activity gets one partner table at normal hours`);
        const open = planFriendsWeek(w, { ...inputOf(pair), venues: openVenues }, policy, FRIENDS_PLANS).partners;
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
    }

    // Use one morning plan that fits after the change, one that ends 15 minutes after closing,
    // and one that starts after closing for each recurring path.
    const activityId = "coffee_crawl";
    const venue = VENUES.find(v => v.activities.includes(activityId))!;
    const ids = ["a", "b", "c"];
    const mini = new Mini(ids.map((id, index) => ({ id, name: ["Ana Diaz", "Ben Ito", "Cara Li"][index]!, age: 30, area: venue.area, interests: ["coffee", "hiking"] })));
    for (const id of ids) mini.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
    const world = new World(mini.ctx().snapshot(), resolveConfig({ seed: 1 }), localEmbed, friendsPack);
    for (const source of ["crew_offer", "crew_session", "repeat"] as const) for (const [hour, minute] of [[14, 30], [14, 45], [20, 0]]) {
      const at = Date.UTC(2026, 9, 3, hour, minute);
      const crew: Crew = { id: "crew_venue", city: "nyc", activityId, venueId: venue.id, members: ids, cadenceDays: 7,
        hostRotation: ids, sessions: [], handedOff: false, slot: { start: at } };
      const outcome: PlanOutcomeRecord = { planId: "prior_venue", activityId, venueId: venue.id, city: "nyc", at, attended: ids, positive: ids, recurringWant: [] };
      const recurringAt = (hours: [number, number]) => {
        const next = planFriendsWeek(world, { now: START, tz: NYC_TZ, evidence: new Map(), venues: [{ ...venue, hours: { weekday: hours, weekend: hours } }],
          crews: source === "crew_session" ? [crew] : [], outcomes: source === "crew_session" ? [] : [outcome], offered: [] },
        { ...DEFAULT_FRIENDS_POLICY, crews: source !== "repeat", repeat: source === "repeat", timeOptions: false }, FRIENDS_PLANS);
        return [...next.sessions, ...next.offers.map(x => x.first), ...next.repeats];
      };
      const open = recurringAt([0, 24]);
      expect(open).toMatchObject([{ source, invited: ids, venueId: venue.id, window: { start: at + 7 * DAY } }]);
      expect(recurringAt([9, 12])).toEqual(hour === 14 && minute === 30 ? open : []);
    }
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
      expect(isDeepStrictEqual(expired, base)).toBe(true);
      // Positive control: the very same availability matters at its inclusive start boundary.
      expect(isDeepStrictEqual(active, base)).toBe(false);
      const sameFuturePlans = isDeepStrictEqual(future, base);
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
          { ...DEFAULT_FRIENDS_POLICY, repeat: false, partnerIntros: 0, universal: false }, FRIENDS_PLANS);
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
        const correct = plan.hostId === expectedHost && isDeepStrictEqual(plan.invited, expectedInvited)
          && isDeepStrictEqual(hosts, [expectedHost]) && isDeepStrictEqual(contributions, [expectedHost]);
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
      const correct = tuesdayOffered === fresh && ids.every(id => isDeepStrictEqual(info.get(id)!.standing.map(s => s.statedAt), expectedTimes));
      rows.push({ seed, kind, tuesdayOffered, correct });
    }
    expect(rows.filter(x => x.correct).length).toBe(rows.length);
  });
}

export async function friendsReachableVenueGate(b: Block): Promise<void> {
  await b.run("Friends planning prefers the open public venue that fits both partners' travel limits", () => {
    const venues = PLAN_VENUES.filter(venue => venue.id === "pier-45" || venue.id === "central-reservoir");
    const ids = ["a", "b"];
    const slot = Date.UTC(2026, 9, 10, 14);
    const propose = (tolerance: number, candidateVenues = venues) => {
      const mini = new Mini([
        { id: "a", name: "Ada", age: 30, area: "Financial District", interests: ["running"] },
        { id: "b", name: "Bev", age: 30, area: "Roosevelt Island", interests: ["running"] },
        { id: "c", name: "Cam", age: 30, area: "Roosevelt Island", interests: ["running"] },
      ]);
      for (const id of ids) mini.facets.push({
        id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified",
        tags: ["verify:liveness:pass", "verify:age:pass", `friends:max_travel:${id === "a" ? 30 : tolerance}`],
        scope: "agent_private", provenance: "said", confidence: 1,
      });
      const input: EngineInput = { ...mini.ctx().snapshot(), interactions: [{
        id: "prior-group", kind: "group", category: "social", participants: ["a", "b", "c"], at: START - DAY, outcome: "completed",
      }] };
      const world = new World(input, resolveConfig({ seed: 1 }), localEmbed, friendsPack);
      const evidence = new Map<MemberId, PlanEvidence>(ids.map(id => [id, {
        memberId: id, tz: NYC_TZ, quietHours: [22, 8], stated: { windows: [{ start: slot, end: slot + 3 * HOUR }], at: START, until: START + 7 * DAY },
      }]));
      return planFriendsWeek(world, { now: START, tz: NYC_TZ, evidence, venues: candidateVenues, crews: [], outcomes: [], offered: [] }, DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS).partners;
    };
    const expected = [{ venueId: "central-reservoir", invited: ids, minutes: { a: 34, b: 21 }, window: { start: slot } }];
    expect(propose(20, venues.filter(venue => venue.id === "central-reservoir")).map(plan => plan.venueId)).toEqual(["central-reservoir"]);
    expect(propose(20)).toMatchObject(expected);
    expect(propose(17)).toEqual([]);
  });
}

export async function friendsActivityDurationGate(b: Block): Promise<void> {
  await b.run("Friends checks availability through the end of the actual activity", () => {
    const venue = PLAN_VENUES.find(v => v.id === "inwood-hill")!;
    const ids = ["a", "b", "c"];
    const mini = new Mini(ids.map((id, index) => ({ id, name: ["Ada", "Bev", "Cam"][index]!, age: 30, area: "Inwood", interests: ["hiking"] })));
    for (const id of ids) mini.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified",
      tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
    const world = new World(mini.ctx().snapshot(), resolveConfig({ seed: 1 }), localEmbed, friendsPack);
    const start = Date.UTC(2026, 9, 10, 14);
    const propose = (hoursFree: number, busyAt: number) => {
      const evidence = new Map<MemberId, PlanEvidence>(ids.map(id => [id, {
        memberId: id, tz: NYC_TZ, quietHours: [22, 8], stated: { windows: [{ start, end: start + hoursFree * HOUR }], at: START, until: START + 7 * DAY },
        ...(id === "c" ? { calendar: { observedAt: START, expiresAt: START + DAY,
          coverage: { start: START, end: START + 7 * DAY }, busy: [{ start: start + busyAt * HOUR, end: start + (busyAt + 1) * HOUR }] } } : {}),
      }]));
      return planFriendsWeek(world, { now: START, tz: NYC_TZ, evidence, venues: [venue], crews: [], outcomes: [], offered: [] },
        { ...DEFAULT_FRIENDS_POLICY, universal: false, partnerIntros: 0 }, FRIENDS_PLANS).plans.filter(plan => plan.activityId === "day_hike");
    };
    const open = propose(4, 4);
    expect(open).toMatchObject([{ venueId: venue.id, window: { start, end: start + 4 * HOUR } }]);
    expect([...open[0]!.invited].sort()).toEqual(ids);
    expect(propose(4, 3)).toEqual([]);
    expect(propose(2, 4)).toEqual([]);
  });
}

export async function friendsSplitTableMetricGate(b: Block): Promise<void> {
  await b.run("metrics: a split invitation counts once toward proposal quorum and both tables count as held", () => {
    const venue = VENUES.find(v => v.activities.includes("coffee_crawl"))!;
    const options = [SLOTS.indexOf("sat_am"), SLOTS.indexOf("sun_am")];
    const result = runFriendsWorld({ seed: 5, n: 30, weeks: 1, matcher: world => {
      const ids = world.personas.filter(isReal).slice(0, 9).map(member => member.id);
      const accepted = new Map(ids.slice(0, 6).map((id, index) => [id, options[index < 3 ? 0 : 1]!]));
      world.oracle.answer = id => {
        const picked = accepted.get(id);
        return { replied: true, yes: picked !== undefined, picks: picked === undefined ? [] : [picked] };
      };
      world.oracle.backsOut = () => false;
      world.oracle.attends = () => true;
      const plan = { kind: "plan" as const, activity: "coffee_crawl", venueHood: venue.area, options, alternates: [], quorum: 3, split: true };
      return { name: "split-table metric fixture", propose: () => [{ ...plan, invited: ids.slice(0, 6) }, { ...plan, invited: ids.slice(6) }] };
    } });
    expect(result.flows.map(flow => [flow.stage, flow.probed, flow.attended.length])).toEqual([
      ["held", 6, 3], ["held", 0, 3], ["no_quorum", 3, 0],
    ]);
    expect(friendsMetrics(result)).toMatchObject({ proposals: 2, probes: 9, quorumRate: 0.5, meetups: 2, attendance: 1 });
  });
}

export async function friendsKnownContactMetricGate(b: Block): Promise<void> {
  await b.run("metrics: a pair contacted again after a visible hold counts once as a known-adversary contact", () => {
    const result = runFriendsWorld({ seed: 5, n: 100, weeks: 3, adversaryShares: { harasser: 0.2 },
      matcher: { name: "known contact metric fixture", propose: () => [] } });
    const offender = result.world.personas.find(member => member.hidden.adversary === "harasser" && !visibleRedFlag(member, 0))!;
    const member = result.world.personas.find(isReal)!;
    expect(offender).toBeTruthy();
    result.world.state.safetyHolds.push({ memberId: offender.id, from: weekTime(1, 0, 9) });
    const contact = { a: offender.id, b: member.id };
    result.contacts.push({ ...contact, day: 2, key: "before-hold" });
    expect(friendsMetrics(result).safety).toMatchObject({ adversaryContacts: 1, knownAdversaryContacts: 0 });
    result.contacts.push({ ...contact, day: 9, key: "after-hold" }, { ...contact, day: 16, key: "repeated-after-hold" });
    expect(friendsMetrics(result).safety).toMatchObject({ adversaryContacts: 1, knownAdversaryContacts: 1 });
  });
}

export async function friendsBlock(b: Block, o: { quick: boolean }): Promise<void> {
  await friendsScheduleGates(b);
  await friendsSplitTableMetricGate(b);
  await friendsKnownContactMetricGate(b);
  const spec = o.quick ? { seeds: [5], weeks: 4, n: 200 } : FRIENDS_PINNED;
  const all: Record<"pack" | "random" | "oracle", FriendsMetrics[]> = { pack: [], random: [], oracle: [] };
  const openPack: FriendsMetrics[] = [];
  const matchers = { pack: friendsPackMatcher(), random: BASELINES.random, oracle: BASELINES.oracle, open: friendsPackMatcher() };
  // PR #450: repeat and crew invitations read the latest enjoyment from earlier weeks, in meetup time order.
  let priorChecks = 0, priorErrors = 0, memoryChecks = 0, memoryErrors = 0;
  const met: string[][] = [];
  for (const arm of ["pack", "random", "oracle", "open"] as const) for (const seed of spec.seeds) {
    const decisions: { id: MemberId; week: number; enjoy: number | undefined; crew: boolean }[] = [];
    const result = runFriendsWorld({ seed, n: spec.n, weeks: spec.weeks, statedOpenness: arm === "open", matcher: w => {
      // Observe the real oracle without changing its answers, draws or matcher proposals.
      const answer = w.oracle.answer.bind(w.oracle), crewOptIn = w.oracle.crewOptIn.bind(w.oracle);
      w.oracle.answer = (id, key, c) => {
        if (!/^probe:w\d+:(plan|partner):/.test(key)) decisions.push({ id, week: c.week, enjoy: c.prevEnjoy, crew: false });
        return answer(id, key, c);
      };
      w.oracle.crewOptIn = (id, key, enjoyed) => {
        decisions.push({ id, week: w.state.week, enjoy: enjoyed, crew: true });
        return crewOptIn(id, key, enjoyed);
      };
      const matcher = matchers[arm];
      return typeof matcher === "function" ? matcher(w) : matcher;
    } });
    const latest = new Map<MemberId, number>();
    const bookedAt = new Map(result.world.state.interactions.map(x => [x.id, x.at]));
    const at = (m: MeetupRecord) => m.kind === "crew_self"
      ? slotTime(m.week, SLOTS.indexOf(slotOfCrew(result.world.state.crews.find(c => c.id === m.crewId)!)))
      : bookedAt.get(m.key)!;
    for (let week = 0; week < spec.weeks; week++) {
      for (const d of decisions.filter(x => x.week === week)) {
        priorChecks++;
        if (d.enjoy !== (latest.get(d.id) ?? (d.crew ? 0.5 : undefined))) priorErrors++;
      }
      for (const m of result.meetups.filter(x => x.week === week).sort((x, y) => at(x) - at(y)))
        for (const id of m.attendees) latest.set(id, m.enjoy[id]!);
    }
    for (const id of new Set([...latest.keys(), ...result.world.lastEnjoy.keys()])) {
      memoryChecks++;
      if (result.world.lastEnjoy.get(id) !== latest.get(id)) memoryErrors++;
    }
    (arm === "open" ? openPack : all[arm]).push(friendsMetrics(result));
    if (arm === "pack") met.push(meetupKeys(result.meetups));
  }
  b.gate("harness: invitations use the latest prior-week enjoyment", priorChecks > 0 && memoryChecks > 0 && priorErrors + memoryErrors === 0,
    `${priorErrors}/${priorChecks} wrong invitation inputs; ${memoryErrors}/${memoryChecks} wrong final memories`);
  b.track("fingerprint: pack, random and oracle arms", true, digest(all));
  for (const g of officialGates(all.pack, all.random, all.oracle)) b.gate(`gate ${g.gate}`, g.pass, g.value, SAFETY.has(g.id) || !o.quick);
  for (const g of trackedMetrics(all.pack, all.random)) b.track(`tracked ${g.gate}`, g.pass, g.value);
  b.track("stated openness world: fingerprint of the pack arm", true, digest(openPack));
  for (const g of officialGates(openPack, all.random, all.oracle)) if (SAFETY.has(g.id) || g.id === "repeat") b.gate(`stated openness world: gate ${g.gate}`, g.pass, g.value, SAFETY.has(g.id));
  const groups = opennessGroups(openPack);
  b.track(`stated openness world: tracked ${groups.gate}`, groups.pass, groups.value);
  b.gate("pack: 0 proposals that break the teen age rule", all.pack.every(m => m.safety.ageRuleBrokenProposals === 0));

  const teenOn: FriendsMetrics[] = [], teenStop: FriendsMetrics[] = [];
  const stopDiffs: number[] = [];
  for (const seed of spec.seeds) {
    teenOn.push(friendsMetrics(await runFriendsWorldAsync({ seed, n: spec.n, weeks: spec.weeks, ...TEEN_WORLD, matcher: friendsTeenMatcher() })));
    const stopped = await runFriendsWorldAsync({ seed, n: spec.n, weeks: spec.weeks, ...TEEN_WORLD, teenStop: true, matcher: friendsTeenMatcher() });
    const reference = await runFriendsWorldAsync({ seed, n: spec.n, weeks: spec.weeks, ...TEEN_WORLD, teenBirthDates: false, matcher: friendsTeenMatcher() });
    teenStop.push(friendsMetrics(stopped));
    const same = JSON.stringify({ metrics: friendsMetrics(stopped), outbound: friendsOutboundLog(stopped) }) === JSON.stringify({ metrics: friendsMetrics(reference), outbound: friendsOutboundLog(reference) });
    if (!same) stopDiffs.push(seed);
  }
  const teenArms = [["default world, teen introductions on", all.pack], ["teen world, stopped", teenStop], ["teen world, on", teenOn]] as const;
  for (const [label, arm] of teenArms) for (const g of teenGates(arm)) b.gate(`${label}: gate ${g.gate}`, g.pass, g.value);
  b.gate("teen_stop_equals_pre_feature: the stopped teen world equals the reference arm (no member teen ready) byte for byte, metrics and outbound log, every seed",
    stopDiffs.length === 0, stopDiffs.length ? `differs on seeds ${stopDiffs.join(", ")}` : `equal on seeds ${spec.seeds.join(", ")}`);
  b.gate("teen world, stopped: 0 contacts and 0 proposals with a stated minor", teenStop.every(m => m.safety.teen.minorContacts === 0 && m.safety.declaredMinorContacts === 0 && m.safety.ageRuleBrokenProposals === 0),
    teenStop.map(m => `${m.safety.teen.minorContacts}/${m.safety.ageRuleBrokenProposals}`).join(", "));
  b.gate("teen world, on: 0 proposals that break the teen friendship rule (readiness from stated birth dates, no staff step; the simulated review judge approves)", teenOn.every(m => m.safety.ageRuleBrokenProposals === 0),
    teenOn.map(m => String(m.safety.ageRuleBrokenProposals)).join(", "));
  b.gate("teen world, on: positive control, the engine makes teen friendship introductions and teen groups of 3 or more", teenOn.reduce((s, m) => s + m.safety.teen.introductions, 0) > 0 && teenOn.reduce((s, m) => s + m.safety.teen.teenGroupMeetups, 0) > 0,
    teenOn.map(m => `${m.safety.teen.introductions} introductions, ${m.safety.teen.minorContacts} contacts, ${m.safety.teen.teenGroupMeetups} group meetups`).join("; "), !o.quick);
  for (const g of teenTracked(teenOn)) b.track(`teen world, on: tracked ${g.gate}`, g.pass, g.value);
  for (const g of teenTracked(all.pack)) b.track(`default world, on: tracked ${g.gate}`, g.pass, g.value);
  b.track("teen world, stopped: tracked h_teen", hTeen(teenStop).pass, hTeen(teenStop).value);
  b.track("teen world: fingerprint of both arms", true, digest({ teenOn, teenStop }));

  const aa: FriendsMetrics[] = [], aaMet: string[][] = [];
  for (const seed of spec.seeds) {
    const result = runFriendsWorld({ seed, n: spec.n, weeks: spec.weeks, matcher: idsSalted(friendsPackMatcher(), 1) });
    aa.push(friendsMetrics(result));
    aaMet.push(meetupKeys(result.meetups));
  }
  const row = (f: (m: FriendsMetrics) => number) => pairedLine(all.pack.map(f), aa.map(f));
  b.track("A/A pack (member ids salted), meetups held", true, row(m => m.meetups));
  b.track("A/A pack, V14", true, row(m => m.v14));
  b.track("A/A pack, repeat rate", true, row(m => m.repeatRate));
  b.track("A/A pack, expected P(held and good) per proposal (oracle)", true, row(m => m.expected.perProposal));
  b.track("A/A pack, expected good meetups per member (oracle)", true, row(m => m.expected.perMember));
  b.track("A/A pack, same meetups (Jaccard of who met whom, per seed)", true, met.map((m, i) => overlap(m, aaMet[i]!).toFixed(2)).join(", "));

  await b.run("harness: deterministic; no arm contacts a declared minor outside the teen friendship rule; tables of at most 6, at most 2 meetups a member a week", () => {
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
  const teenWorlds = new Map<number, EngineInput>();
  for (const seed of seeds) teenWorlds.set(seed, engineInputOf(await teenSnapshotAfter(seed)));
  await teenConformance(b, friendsPack, { world: seed => teenWorlds.get(seed)!, seeds });
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
      for (const p of allPlans(wk)) for (const me of p.invited) { const t = buildPlanProbe(ww, p, me, NYC_TZ, venueAgesIn(VENUES)); if (t) { probes++; expect(t).not.toMatch(ROMANCE_FRAMING); expect(t).not.toMatch(/canary/i); } }
      expect(probes).toBeGreaterThan(0);
    }
  });

  await b.run("conformance friends: with teen introductions stopped, no minors in any plan role (sessions, offers, repeats, plans, partners)", () => {
    for (const seed of seeds) {
      const { w, wk } = weekOf(seed);
      const plans = allPlans(wk);
      expect(plans.length).toBeGreaterThan(0);
      for (const p of plans) for (const id of [...p.invited, ...p.alternates, ...(p.hostId ? [p.hostId] : [])]) expect(canBeMatched(w.get(id)!.m.age)).toBe(true);
    }
  });

  await b.run("conformance friends (teen world): every plan with a minor keeps the teen group rule in every role, holds at most 6, meets at an all-ages place between 10:00 and 19:00; adult plans never use a teen-only entry", async () => {
    let teenPlans = 0;
    for (const seed of seeds) {
      const s = await teenSnapshotAfter(seed);
      const w = new World(engineInputOf(s), resolveConfig({ seed }), localEmbed, friendsPack);
      const wk = planFriendsWeek(w, { now: s.now, tz: NYC_TZ, evidence: evidenceOf(w, s), venues: VENUES, crews: s.crews.filter(c => !c.handedOff), outcomes: s.outcomes, offered: s.offered }, DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS);
      for (const p of allPlans(wk)) {
        const roster = [...new Set([...p.invited, ...p.alternates, ...(p.hostId ? [p.hostId] : [])])];
        const sides = roster.map(id => ageSideOf(w.get(id)!.m));
        const activity = activityById.get(p.activityId)!;
        const venue = p.venueId === undefined ? undefined : VENUE_BY_ID.get(p.venueId);
        if (!rosterHasMinor(sides)) {
          expect([p.id, activity.adultPlans, venue === undefined || venue.adultPlans]).toEqual([p.id, true, true]);
          continue;
        }
        teenPlans++;
        const end = Math.max(p.window.end, ...p.options.map(x => x.end));
        expect([p.id, groupAgeAllowed(true, teenFriendCategory("friends", p.category), w.minDay, latestDayKeyOf(end), sides),
          teenRosterSizeAllowed(true, roster.length), venue !== undefined && teenPlaceAllowed(true, true, activityAllAges(activity), venueAllAges(venue))]).toEqual([p.id, true, true, true]);
        for (const x of [p.window, ...p.options]) {
          expect([p.id, teenWindowAllowed(NYC_TZ, x.start, x.end)]).toEqual([p.id, true]);
        }
      }
    }
    expect(teenPlans).toBeGreaterThan(0);
  });

  await b.run("conformance catalog: every all-ages mark is valid (13, low risk, never a bar, alcohol or a private home) in the activities, the planner venues and the production plan places; adult-only activities stay unmarked", () => {
    let marked = 0;
    for (const a of ACTIVITIES) { expect([a.id, a.allAges === activityAllAges(a)]).toEqual([a.id, true]); if (a.allAges) marked++; }
    for (const v of [...VENUES, ...PLAN_VENUES]) expect([v.id, v.allAges === venueAllAges(v)]).toEqual([v.id, true]);
    const barOrHome = (id: string) => activityById.get(id)?.tags.some(t => t === "wine" || t === "hosting") === true;
    for (const v of [...VENUES, ...PLAN_VENUES]) if (v.allAges) expect([v.id, v.public, v.activities.filter(barOrHome)]).toEqual([v.id, true, []]);
    for (const id of ["wine_bar", "night_market", "live_show", "jazz_night", "open_mic", "restaurant_dinner", "theater_night", "tech_meetup", "food_bank_shift", "day_hike", "group_ride", "dog_park"]) {
      expect([id, activityById.get(id)?.allAges]).toEqual([id, false]);
    }
    expect(marked).toBeGreaterThan(0);
    expect(PLAN_VENUES.some(v => v.allAges && !v.adultPlans)).toBe(true);
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
