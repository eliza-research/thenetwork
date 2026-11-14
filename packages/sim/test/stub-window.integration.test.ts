// The existing dinner scenario through the full world, channel, policy personas,
// and StubNetwork. A proposal window must not disappear when no slot fits it.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { DAY, HOUR } from "@thenetwork/core";
import { loadScenario, scenarioWorldOptions } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { runWorld } from "../src/world.ts";

test("the time-aware stub cancels unavailable windows and keeps feasible and unbounded bookings", async () => {
  const fixture = await loadScenario(join(import.meta.dir, "../scenarios/group-flake-morning-of.json"));
  const observed: unknown[] = [], expected: unknown[] = [];
  // Seed 5 also exercises the existing 19:00 fallback inside a broad window.
  for (const seed of [1, 2, 3, 4, 5]) for (const kind of ["short", "off-template", "wide", "unbounded", "legacy"] as const) {
    const wo = scenarioWorldOptions(structuredClone(fixture), {
      seed, writeLog: false, network: s => new StubNetwork({ seed, ...s.stub, timeAware: kind !== "legacy" }),
    });
    const input = wo.actions!.find(x => x.action.do === "propose")!;
    if (input.action.do !== "propose") throw new Error("missing dinner proposal");
    const proposal = input.action.proposal;
    if (kind === "short" || kind === "legacy") proposal.window = { start: input.at + 2 * HOUR, end: input.at + 3 * HOUR };
    if (kind === "off-template") proposal.window = { start: input.at + 2 * DAY + 3.5 * HOUR, end: input.at + 2 * DAY + 4.5 * HOUR };
    if (kind === "wide") proposal.window = { start: input.at + DAY, end: input.at + 5 * DAY };
    const world = await runWorld(wo);
    const meetings = world.records.filter(r => r.type === "meeting_scheduled" && r.proposalId === proposal.id);
    const scheduling = world.records.filter(r => r.type === "message" && r.msg.direction === "outbound" && r.msg.meta?.proposalId === proposal.id && r.msg.meta?.type === "scheduling");
    const cancelled = world.records.some(r => r.type === "network_log" && r.kind === "opportunity_closed" && r.detail.proposalId === proposal.id && r.detail.reason === "no_available_slot");
    const unavailable = kind === "short" || kind === "off-template";
    const inside = kind === "legacy" || meetings.every(r => r.type === "meeting_scheduled" && (!proposal.window || (r.at >= proposal.window.start && r.at <= proposal.window.end)));
    observed.push({ seed, kind, booked: meetings.length > 0, confirmed: scheduling.length > 0, cancelled, inside, errors: world.metrics.errors });
    expected.push({ seed, kind, booked: !unavailable, confirmed: !unavailable, cancelled: unavailable, inside: true, errors: 0 });
  }
  expect(observed).toEqual(expected);
}, 30_000);
