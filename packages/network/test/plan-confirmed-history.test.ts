// A booked plan's confirmation never reaches the opportunity History: the Network logs
// `plan_confirmed` (spec/meetingSettlement.md, "Record confirmation once"), but
// `NETWORK_EVENT_KINDS` does not list it, so `eventOf` drops the record and neither the
// game-mode detail nor the real-mode event store ever sees it. A member who confirms by
// silence leaves no message either, so the History jumps from "Meeting scheduled" to
// "Meeting happened" with no confirmation in between.
import { describe, expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { describe as describeEvent, eventOf, type EventRow } from "../../apps/observatory/src/events.ts";
import { Mini } from "./mini.ts";

const ids = ["a", "b", "c"];

async function bookedFixture() {
  const w = new Mini(ids.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find climbing partners", category: "hobby" as const }],
  })), { plans: false });
  await w.onboard(...ids);
  const id = w.propose(ids);
  await w.answerProbes(ids);
  expect(w.meetings).toHaveLength(1);
  const opp = () => w.net.exportState().opps.find(o => o.id === id)!;
  expect(opp().stage).toBe("scheduled");
  expect(await w.runUntil(() => (opp().bookedTold ?? []).length === ids.length, 2 * DAY)).toBe(true);
  return { w, id, opp };
}

/** The game-mode opportunity detail filter (apps/observatory/src/sources/game.ts). */
function inOpportunityHistory(row: EventRow | undefined, id: string) {
  return !!row && (row.object_type === "opportunity" ? row.object_id === id : row.payload?.oppId === id);
}

describe("plan_confirmed reaches the opportunity History", () => {
  test("a silence confirmation is a History event", async () => {
    const { w, id } = await bookedFixture();
    await w.run(49 * HOUR);
    const confirmed = w.log("plan_confirmed").filter(l => l.detail.oppId === id && l.detail.how === "silence");
    expect(confirmed.length).toBeGreaterThan(0);
    for (const l of confirmed) {
      const row = eventOf({ t: l.t, type: "network_log", kind: l.kind, detail: l.detail });
      expect(inOpportunityHistory(row, id)).toBe(true);
      expect(describeEvent(row!, x => x).text).toMatch(/confirmed the booked plan/);
    }
  }, 60_000);

  test("a confirmation in words is a History event", async () => {
    const { w, id } = await bookedFixture();
    await w.say("a", "yes, see you there");
    const confirmed = w.log("plan_confirmed").filter(l => l.detail.oppId === id && l.detail.memberId === "a");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.detail.how).toBe("said");
    const row = eventOf({ t: confirmed[0]!.t, type: "network_log", kind: confirmed[0]!.kind, detail: confirmed[0]!.detail });
    expect(inOpportunityHistory(row, id)).toBe(true);
    expect(describeEvent(row!, x => x).text).toMatch(/confirmed the booked plan/);
  });
});
