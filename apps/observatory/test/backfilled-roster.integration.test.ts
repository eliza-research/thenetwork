import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { holdEveryItem } from "../../../packages/engine/src/reviewJudge.ts";
import { Mini } from "../../../packages/network/test/mini.ts";
import { Projector } from "../src/projector.ts";
import { emptyCounters, Store } from "../src/store.ts";

test("a reviewed plan snapshots its roster through backfill and closure", async () => {
  // spec/product/stories.md, "F35 — Inspect a member's experience as staff"
  const primary = ["a", "b", "c"], all = [...primary, "d"];
  const world = new Mini(all.map(id => ({ id, name: id, age: 30, area: "Inwood", interests: ["hiking"] })), { inlineJudge: holdEveryItem.inline });
  await world.onboard(...all);
  const now = world.clock.now();
  const startsAt = Date.UTC(2026, 9, 10, 14);
  const window = { start: startsAt, end: startsAt + 4 * HOUR };
  const plan: plans.Plan = {
    id: "observatory-roster", city: "nyc", activityId: "day_hike", venueId: "inwood-hill",
    place: { name: "Inwood Hill Park", area: "Inwood" }, window, invited: primary, alternates: ["d"],
    partner: false, size: { min: 3, target: 3, max: 3 }, quorum: 3, probeDeadline: startsAt - 30 * HOUR,
    score: 0.8, u: {}, familiar: {}, createdAt: now, category: "social",
  };
  const snapshot = world.net.exportState();
  for (const member of snapshot.members) member.stated = { windows: [window], at: now, until: now + 7 * DAY };
  world.net.importState(snapshot);
  (world.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
  await world.net.tick(now);
  const { oppId } = world.net.reviewQueue()[0]!;
  expect(world.net.review(oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await world.runUntil(() => primary.every(id => world.probed(id)), DAY)).toBe(true);
  await world.say("a", "no");
  expect(await world.runUntil(() => world.probed("d"), DAY)).toBe(true);

  const store = new Store({
    mode: "game", label: "Synthetic", dataset: "Synthetic",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: true, readOnly: false },
  }, { now, start: now, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  for (const id of all) {
    store.upsertMember({ id, name: id, city: "nyc", joined: true, minor: false, state: "normal", counters: emptyCounters() });
  }
  const projector = new Projector(store);
  let consumed = 0;
  const refresh = () => {
    for (const record of world.logs.slice(consumed)) projector.apply({ ...record, type: "network_log" });
    consumed = world.logs.length;
  };
  const native = () => world.net.exportState().opps.find(o => o.id === oppId)!;
  refresh();
  expect(native()).toMatchObject({ participants: all, alternates: [] });
  expect(store.opps.get(oppId)).toMatchObject({ participants: native().participants, alternates: native().alternates });

  for (const id of ["b", "c", "d"]) await world.say(id, "no");
  await world.runUntil(() => native().stage === "closed", 5 * DAY);
  expect(native().stage).toBe("closed");
  expect(world.log("probe_closed").find(record => record.detail.proposalId === oppId)?.detail)
    .toMatchObject({ alternates: native().alternates });
  refresh();
  expect(store.opps.get(oppId)).toMatchObject({ state: "SKIPPED", participants: native().participants, alternates: native().alternates });
});
