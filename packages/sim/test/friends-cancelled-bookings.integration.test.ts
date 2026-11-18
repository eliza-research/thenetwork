import { expect, test } from "bun:test";
import { friendsMetrics } from "../src/apps/friends/metrics.ts";
import { friendsPackMatcher } from "../src/apps/friends/packMatcher.ts";
import { runFriendsWorld } from "../src/apps/friends/world.ts";

test("Friends cancelled plans leave no booked seats or attendance obligations", () => {
  const rows = [];
  let cancellations = 0, bookedSeats = 0;
  for (const seed of [5, 6, 7, 8]) {
    const r = runFriendsWorld({ seed, n: 400, weeks: 8, matcher: friendsPackMatcher() });
    const cancelled = new Set(r.world.state.interactions.filter(i => i.outcome === "cancelled").map(i => i.id));
    const cancelledSeats = r.flows.filter(f => cancelled.has(f.key)).reduce((s, f) => s + f.booked.length, 0);
    const reserved = r.flows.filter(f => !cancelled.has(f.key)).reduce((s, f) => s + f.booked.length, 0);
    const attended = r.flows.reduce((s, f) => s + f.attended.length, 0);
    cancellations += cancelled.size;
    bookedSeats += reserved;
    rows.push({ seed,
      actual: { cancelledSeats, attendance: friendsMetrics(r).attendance },
      expected: { cancelledSeats: 0, attendance: attended / reserved },
    });
  }
  expect(cancellations).toBeGreaterThan(0);
  expect(bookedSeats).toBeGreaterThan(0);
  expect(rows.map(({ seed, actual }) => ({ seed, ...actual })))
    .toEqual(rows.map(({ seed, expected }) => ({ seed, ...expected })));
}, 120_000);
