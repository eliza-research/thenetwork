import { expect, test } from "vitest";
import { holdEveryItem } from "../../../packages/engine/src/reviewJudge.ts";
import { Mini } from "../../../packages/network/test/mini.ts";
import { describe as describeEvent } from "../src/events.ts";
import { Projector } from "../src/projector.ts";
import { emptyCounters, Store } from "../src/store.ts";

test("a group member who leaves with no substitute leaves the observatory roster and count", async () => {
  const planned = ["ana", "ben", "cy", "dee"];
  const remaining = ["ana", "ben", "cy"];
  const world = new Mini(planned.map(id => ({
    id, name: id, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
  })), { inlineJudge: holdEveryItem.inline, growth: false });
  await world.onboard(...planned);
  const id = world.propose(planned, { explanations: { ana: "climbing nearby", ben: "climbing nearby", cy: "climbing nearby", dee: "climbing nearby" } });
  expect(await world.runUntil(() => world.net.reviewQueue().some(item => item.oppId === id))).toBe(true);
  expect(world.net.decide(id, "approve", { reviewer: "staff" })).toEqual({ ok: true });
  await world.answerProbes(planned, member => (member === "dee" ? "no" : "yes"));

  const native = () => world.net.exportState().opps.find(item => item.id === id)!;
  expect(native().participants).toEqual(remaining);
  expect(native().stage).not.toBe("closed");
  expect(world.log("probe_replaced").filter(record => record.detail.oppId === id)).toHaveLength(1);
  const departure = world.log("probe_replaced").find(record => record.detail.oppId === id)!;
  expect(departure.detail.out).toBe("dee");
  expect(departure.detail.in).toBeUndefined();
  expect((departure.detail.proposal as { participants: string[] }).participants).toEqual(remaining);
  expect((departure.detail.proposal as { explanations: Record<string, string> }).explanations).not.toHaveProperty("dee");
  expect(world.logs.filter(record => record.detail.oppId === id).map(record => record.kind))
    .not.toContain("opportunity_closed");

  const now = world.clock.now();
  const store = new Store({
    mode: "game", label: "Synthetic", dataset: "Synthetic",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: true, readOnly: false },
  }, { now, start: now, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  for (const member of planned) {
    store.upsertMember({ id: member, name: member, city: "nyc", joined: true, minor: false, state: "normal", counters: emptyCounters() });
  }
  const projector = new Projector(store);
  for (const record of world.logs) projector.apply({ ...record, type: "network_log" });

  const shown = store.opps.get(id)!;
  expect(shown.participants).toEqual(remaining);
  expect(store.member("dee")!.counters.proposals).toBe(0);
  expect(remaining.map(member => store.member(member)!.counters.proposals)).toEqual([1, 1, 1]);
  expect(Object.keys(shown.status)).not.toContain("undefined");
  expect(describeEvent({ at: departure.t, actor_type: "agent", actor_id: "network", type: "probe_replaced", object_type: null, object_id: null, payload: departure.detail }).text).not.toContain("undefined");
  expect([...store.opps.values()].filter(o => o.participants.includes("dee"))).toEqual([]);
});
