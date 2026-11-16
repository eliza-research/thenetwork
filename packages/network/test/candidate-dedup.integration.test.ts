import { DAY, HOUR } from "@thenetwork/core";
import { expect, test } from "vitest";
import { runEngine } from "../../engine/src/engine.ts";
import { baseMember, emptyInput, facet } from "../../engine/src/testkit.ts";

function fixture() {
  const now = Date.UTC(2026, 9, 12, 16);
  const input = emptyInput(now);
  for (const id of ["a", "b"]) {
    input.members.push(baseMember(id, { homeCity: "nyc", state: "normal", joinedAt: now - 40 * DAY }));
    input.presence.push({ memberId: id, city: "nyc", type: "home", areas: ["manhattan"] });
    input.facets.push(facet(id, 0, "interest", "Sailing", ["sailing"]));
  }
  input.facets.push(facet("b", 1, "skill", "Sailing", ["sailing"]));
  input.intents.push({ id: "aintent", memberId: "a", category: "hobby", objective: "Find a sailing partner",
    status: "active", createdAt: now - DAY, horizonDays: 30 });
  input.events = [{ id: "ev", title: "Sailing workshop", description: "Workshop", tags: ["sailing"], category: "hobby",
    city: "nyc", area: "manhattan", start: now + 2 * DAY, end: now + 2 * DAY + 3 * HOUR }];
  return input;
}

test("a below-threshold event cannot erase an eligible intro for the same participants", async () => {
  for (const seed of [1, 2, 3]) {
    const input = fixture();
    const eventOnly = await runEngine(input, { seed, generators: { intent_to_capability: false }, thresholds: { byGenerator: { event_anchor: 1 } } });
    expect(eventOnly.proposals).toEqual([]);
    expect(eventOnly.runLog.scored).toEqual([expect.objectContaining({ generator: "event_anchor", eligible: false, reason: "below_threshold" })]);

    const result = await runEngine(input, { seed, thresholds: { byGenerator: { event_anchor: 1 } } });
    expect(result.runLog.funnel).toMatchObject({
      byGenerator: { event_anchor: 1, intent_to_capability: 1 },
      passedHardFilters: 2,
      deduped: 1,
    });
    expect(result.proposals).toEqual([expect.objectContaining({ generator: "intent_to_capability" })]);
    expect(result.proposals[0]!.participants.toSorted()).toEqual(["a", "b"]);
    expect(eventOnly.runLog.scored[0]!.score).toBeGreaterThan(result.proposals[0]!.score);

    const bothEligible = await runEngine(input, { seed, thresholds: { byGenerator: { event_anchor: 0 } } });
    expect(bothEligible.proposals).toEqual([expect.objectContaining({ generator: "event_anchor" })]);
  }
});
