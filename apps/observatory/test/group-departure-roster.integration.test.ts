import { expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { Mini } from "../../../packages/network/test/mini.ts";
import { Projector } from "../src/projector.ts";
import { emptyCounters, Store } from "../src/store.ts";

test("a group member who leaves with no substitute stays in the observatory roster", async () => {
  // spec/probeDispatch.md, "A replacement keeps the requester or hiring manager and all eligible
  // group members": "If no alternate is accepted, a group can continue after removing the
  // unavailable member when at least three members remain available to participate."
  // spec/observatoryRoster.md, "A replacement uses the Network's recorded roster" and
  // "Reviewed offers contribute to a member's proposal activity after approval": the departed
  // member is no longer a participant in the recorded roster, so the roster and the proposal
  // count must stop showing them.
  const planned = ["ana", "ben", "cy", "dee"];
  const remaining = ["ana", "ben", "cy"];
  const world = new Mini(planned.map(id => ({
    id, name: id, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
  })), { review: "human", growth: false });
  await world.onboard(...planned);
  const id = world.propose(planned);
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
  expect([...store.opps.values()].filter(o => o.participants.includes("dee"))).toEqual([]);
});
