import { describe, expect, test } from "bun:test";
import type { MemberId } from "@thenetwork/core";
import { resolveConfig } from "@thenetwork/engine/src/config.ts";
import { localEmbed } from "@thenetwork/engine/src/embed.ts";
import { DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, friendsPack, planFriendsWeek } from "@thenetwork/engine/src/packs/friends/index.ts";
import type { PlanOutcomeRecord } from "@thenetwork/engine/src/plans.ts";
import type { EngineInput } from "@thenetwork/engine/src/types.ts";
import { World } from "@thenetwork/engine/src/world.ts";
import { engineInputOf, evidenceOf, friendsPackMatcher } from "../../sim/src/apps/friends/packMatcher.ts";
import { buildFriendsSnapshot, NYC_TZ } from "../../sim/src/apps/friends/snapshot.ts";
import { runFriendsWorld, VENUES } from "../../sim/src/apps/friends/world.ts";

function friendsSnapshotAfter(seed: number, weeks = 3, n = 160) {
  const r = runFriendsWorld({ seed: 100 + seed, n, weeks, matcher: friendsPackMatcher() });
  const st = r.world.state;
  st.week = weeks;
  st.now += 7 * 86400000;
  return buildFriendsSnapshot(r.world.personas, st);
}

describe("friends weekly planner repeat blocked alternates", () => {
  test("repeat plan excludes blocked members from alternates", () => {
    const s = friendsSnapshotAfter(1);
    const input: EngineInput = engineInputOf(s);

    // Pick 5 active adult members from snapshot
    const candidates = s.members.map(m => m.id).slice(0, 5) as [MemberId, MemberId, MemberId, MemberId, MemberId];
    const [m1, m2, m3, m4, m5] = candidates;

    // m1 blocks m4
    input.edges.push({ from: m1, to: m4, type: "blocked", strength: 1, explicit: true, createdAt: s.now });

    const outcome: PlanOutcomeRecord = {
      planId: "p_test_prev",
      activityId: "restaurant_dinner",
      city: "nyc",
      at: s.now - 3 * 86400000,
      attended: [m1, m2, m3, m4, m5],
      positive: [m1, m2, m3], // m1, m2, m3 would do it again
      recurringWant: [],
      venueId: VENUES[0]!.id,
    };

    const w = new World(input, resolveConfig({ seed: 1 }), localEmbed, friendsPack);
    const ev = evidenceOf(w, s);
    // Ensure all 5 have evidence
    for (const id of [m1, m2, m3, m4, m5]) {
      if (!ev.has(id)) {
        ev.set(id, {
          memberId: id,
          tz: NYC_TZ,
          quietHours: [22, 8],
          standing: [],
          history: [{ at: outcome.at, outcome: "attended" }],
        });
      }
    }

    const wk = planFriendsWeek(
      w,
      {
        now: s.now,
        tz: NYC_TZ,
        evidence: ev,
        venues: VENUES,
        crews: [],
        outcomes: [outcome, ...s.outcomes],
        offered: [],
      },
      DEFAULT_FRIENDS_POLICY,
      FRIENDS_PLANS
    );

    // Look for repeat plans containing m1
    const repeatWithM1 = wk.repeats.find(p => p.invited.includes(m1));
    if (repeatWithM1) {
      expect(repeatWithM1.invited).not.toContain(m4);
      expect(repeatWithM1.alternates).not.toContain(m4);
    }

    // Check all repeats and plans: blocked pairs never co-occur
    for (const p of [...wk.repeats, ...wk.plans]) {
      if (p.invited.includes(m1)) {
        expect(p.invited.includes(m4)).toBe(false);
        expect(p.alternates.includes(m4)).toBe(false);
      }
      if (p.invited.includes(m4)) {
        expect(p.invited.includes(m1)).toBe(false);
        expect(p.alternates.includes(m1)).toBe(false);
      }
    }
  });

  test("finish() backfill never promotes a blocked alternate into invited when a seat drops", () => {
    const s = friendsSnapshotAfter(2);
    const input: EngineInput = engineInputOf(s);

    // Pick 2 members and block them
    const [u1, u2] = s.members.slice(0, 2).map(m => m.id) as [MemberId, MemberId];
    input.edges.push({ from: u1, to: u2, type: "blocked", strength: 1, explicit: true, createdAt: s.now });

    const w = new World(input, resolveConfig({ seed: 2 }), localEmbed, friendsPack);
    expect(w.blocked.has(u1 < u2 ? `${u1}|${u2}` : `${u2}|${u1}`)).toBe(true);

    const wk = planFriendsWeek(
      w,
      {
        now: s.now,
        tz: NYC_TZ,
        evidence: evidenceOf(w, s),
        venues: VENUES,
        crews: s.crews.filter(c => !c.handedOff),
        outcomes: s.outcomes,
        offered: s.offered,
      },
      DEFAULT_FRIENDS_POLICY,
      FRIENDS_PLANS
    );

    const allPlans = [...wk.sessions, ...wk.offers.map(x => x.first), ...wk.repeats, ...wk.plans, ...wk.partners];
    for (const p of allPlans) {
      expect(p.invited.includes(u1) && p.invited.includes(u2)).toBe(false);
      if (p.invited.includes(u1)) {
        expect(p.alternates.includes(u2)).toBe(false);
      }
      if (p.invited.includes(u2)) {
        expect(p.alternates.includes(u1)).toBe(false);
      }
    }
  });

  test("simulation world: blocked pairs never co-occur in invited or alternates", () => {
    const r = runFriendsWorld({ seed: 101, n: 160, weeks: 3, matcher: friendsPackMatcher() });
    const st = r.world.state;
    st.week = 3;
    st.now += 7 * 86400000;
    const s = buildFriendsSnapshot(r.world.personas, st);
    const input: EngineInput = engineInputOf(s);

    // Pick two attendees from the first outcome and block them
    if (s.outcomes.length > 0 && s.outcomes[0]!.attended.length >= 2) {
      const [u1, u2] = s.outcomes[0]!.attended.slice(0, 2) as [MemberId, MemberId];
      input.edges.push({ from: u1, to: u2, type: "blocked", strength: 1, explicit: true, createdAt: s.now });
    }

    const w = new World(input, resolveConfig({ seed: 101 }), localEmbed, friendsPack);
    const wk = planFriendsWeek(
      w,
      {
        now: s.now,
        tz: NYC_TZ,
        evidence: evidenceOf(w, s),
        venues: VENUES,
        crews: s.crews.filter(c => !c.handedOff),
        outcomes: s.outcomes,
        offered: s.offered,
      },
      DEFAULT_FRIENDS_POLICY,
      FRIENDS_PLANS
    );

    const allPlans = [...wk.sessions, ...wk.offers.map(x => x.first), ...wk.repeats, ...wk.plans, ...wk.partners];
    expect(allPlans.length).toBeGreaterThan(0);

    const isBlocked = (a: MemberId, b: MemberId) =>
      w.blocked.has(a < b ? `${a}|${b}` : `${b}|${a}`);

    for (const p of allPlans) {
      // 1. No pair in invited is blocked
      for (let i = 0; i < p.invited.length; i++) {
        for (let j = i + 1; j < p.invited.length; j++) {
          expect(isBlocked(p.invited[i]!, p.invited[j]!)).toBe(false);
        }
      }

      // 2. No alternate is blocked with any invited member
      for (const alt of p.alternates) {
        for (const inv of p.invited) {
          expect(isBlocked(alt, inv)).toBe(false);
        }
      }
    }
  }, 20000);
});
