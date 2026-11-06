import { expect, test } from "bun:test";
import { friendsArms } from "../src/apps/friends/arms.ts";
import { friendsMetrics } from "../src/apps/friends/metrics.ts";
import { runFriendsWorld, type FriendsMatcher } from "../src/apps/friends/world.ts";

test("Friends split tables count once in proposal totals and quorum rates", () => {
  const rows = [];
  let splitTables = 0, unprobedProposals = 0;
  for (const seed of [5, 6, 7, 8]) {
    const proposalKeys = new Set<string>();
    const source = friendsArms()["pack-options3"] as FriendsMatcher;
    const r = runFriendsWorld({ seed, n: 400, weeks: 8, matcher: {
      name: source.name,
      propose(ctx) {
        const proposals = source.propose(ctx);
        proposals.forEach((p, i) => proposalKeys.add(`w${ctx.week}:${i}:${p.kind}`));
        return proposals;
      },
    } });
    // Observe the real planner's proposals before the harness creates extra table records.
    const originals = r.flows.filter(f => proposalKeys.has(f.key));
    const probed = originals.filter(f => f.probed > 0);
    splitTables += r.flows.length - originals.length;
    unprobedProposals += originals.length - probed.length;
    const m = friendsMetrics(r);
    rows.push({ seed,
      actual: { proposals: m.proposals, quorumRate: m.quorumRate },
      expected: { proposals: proposalKeys.size, quorumRate: probed.filter(f => f.going.length > 0).length / probed.length },
    });
  }
  expect(splitTables).toBeGreaterThan(0);
  expect(unprobedProposals).toBeGreaterThan(0);
  expect(rows.map(({ seed, actual }) => ({ seed, ...actual })))
    .toEqual(rows.map(({ seed, expected }) => ({ seed, ...expected })));
}, 120_000);
