// An unclear probe answer never reaches the opportunity History as an event: the
// Network logs `probe_unclear` with the opportunity id and asks once more
// (spec/probeReply.md, "An unresolved offered time needs a time choice"; a
// conditional or hedged reply is asked again and nothing is booked on it), but
// `NETWORK_EVENT_KINDS` does not list it, so `eventOf` drops the record. Every
// other probe lifecycle kind (`probe_started`, `probe_sent`, `probe_answer`,
// `probe_replaced`, `probe_closed`) is stored; the unclear step is the only one
// with no History event row.
import { describe, expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { describe as describeEvent, eventOf, type EventRow } from "../../../apps/observatory/src/events.ts";
import { Mini } from "./mini.ts";

const ids = ["a", "b"];

/** The game-mode opportunity detail filter (apps/observatory/src/sources/game.ts). */
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
    expect(describeEvent(row!, x => x).text).toMatch(/unclear/);
  }, 60_000);
});
