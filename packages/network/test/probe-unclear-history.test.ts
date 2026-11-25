import { describe, expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { describe as describeEvent, eventOf, type EventRow } from "../../../apps/observatory/src/events.ts";
import { Mini } from "./mini.ts";

const ids = ["a", "b"];

function inOpportunityHistory(row: EventRow | undefined, id: string) {
  return !!row && (row.object_type === "opportunity" ? row.object_id === id : row.payload?.oppId === id);
}

describe("probe_unclear reaches the opportunity History", () => {
  test("an unclear probe answer is a History event", async () => {
    const w = new Mini(ids.map(id => ({
      id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
      skills: ["belaying"], wants: [{ objective: "find a climbing partner", category: "hobby" as const }],
    })), { plans: false });
    await w.onboard(...ids);
    const id = w.propose(ids);
    expect(await w.runUntil(() => ids.some(x => w.probed(x)), 4 * DAY)).toBe(true);
    const member = ids.find(x => w.probed(x))!;
    await w.say(member, "Maybe.");
    const unclear = w.log("probe_unclear").filter(l => l.detail.oppId === id);
    expect(unclear.map(l => l.detail)).toEqual([{ oppId: id, memberId: member }]);
    expect(w.meetings).toHaveLength(0);
    const row = eventOf({ t: unclear[0]!.t, type: "network_log", kind: unclear[0]!.kind, detail: unclear[0]!.detail });
    expect(inOpportunityHistory(row, id)).toBe(true);
    expect(row!.object_type).toBe("opportunity");
    expect(describeEvent(row!, x => x).text).toBe(`${member}: probe answer unclear; asked again, nothing booked`);
  }, 60_000);
});
