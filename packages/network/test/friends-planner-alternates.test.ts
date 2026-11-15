import { describe, expect, test } from "bun:test";
import { canBeMatched, type MemberId } from "@thenetwork/core";
import { resolveConfig } from "@thenetwork/engine/src/config.ts";
import { localEmbed } from "@thenetwork/engine/src/embed.ts";
import { DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, friendsPack, planFriendsWeek } from "@thenetwork/engine/src/packs/friends/index.ts";
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

describe("friends weekly planner alternate deduplication", () => {
  for (const seed of [1, 2]) {
    test(`seed ${seed}: alternates are never invited in any plan type and never duplicated across plans`, () => {
      const s = friendsSnapshotAfter(seed);
      const input: EngineInput = engineInputOf(s);
      const w = new World(input, resolveConfig({ seed }), localEmbed, friendsPack);
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

      // 1. Gather all invited member IDs across all plan types
      const allInvited = new Set<MemberId>([
        ...wk.sessions.flatMap(p => p.invited),
        ...wk.offers.flatMap(o => o.first.invited),
        ...wk.repeats.flatMap(p => p.invited),
        ...wk.plans.flatMap(p => p.invited),
        ...wk.partners.flatMap(p => p.invited),
      ]);

      // 2. Verify alternates invariant: an alternate is never invited elsewhere this run, nor duplicated
      const seenAlternates = new Set<MemberId>();
      for (const p of [...wk.repeats, ...wk.plans]) {
        for (const alt of p.alternates) {
          expect(allInvited.has(alt)).toBe(false);
          expect(seenAlternates.has(alt)).toBe(false);
          seenAlternates.add(alt);
        }
      }
    }, 15000);
  }
});
