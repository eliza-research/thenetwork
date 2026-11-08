// A member who was probed for a group plan and said no never learned who was going: their report
// about a booked member is a stranger's report (SD-044), and their block keeps the pair apart but
// does not call off the plan for the people who are going (SD-045).
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

/** A plan booked for Ana, Ben and Cy. Dee was probed for it and said no (a plan keeps her in `participants`). */
async function bookedWithDecliner() {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss"), climber("d", "Dee Park")], { review: "auto" });
  await w.onboard("a", "b", "c", "d");
  const id = w.propose(["a", "b", "c"]);
  for (let i = 0; i < 6 && w.meetings.length === 0; i++) {
    await w.runUntil(() => ["a", "b", "c"].some(x => w.probed(x)), 2 * DAY);
    for (const x of ["a", "b", "c"]) if (w.probed(x)) await w.say(x, "yes");
  }
  const st = w.net.exportState();
  const o = st.opps.find(x => x.id === id)!;
  expect(o.stage).toBe("scheduled");
  expect([...(o.bookedTold ?? [])].sort()).toEqual(["a", "b", "c"]);
  o.participants = [...o.participants, "d"];
  o.status = [...o.status, ["d", "no"]];
  o.contacted = [...new Set([...o.contacted, "d"])];
  w.net.importState(st);
  return { w, id };
}

describe("a plan decliner's report and block", () => {
  test("SD-044: a report by a member who only got the anonymous probe is not a report by someone who met them", async () => {
    const { w } = await bookedWithDecliner();
    await w.say("d", "report Ana Diaz, she harassed me");
    expect(w.log("report").map(l => [l.detail.target, l.detail.met])).toEqual([["a", false]]);
    expect(w.log("report_received").map(l => l.detail.met)).toEqual([false]);
  });

  test("SD-045: a block by a member who is not going does not call off the plan for the others", async () => {
    const { w, id } = await bookedWithDecliner();
    const from = w.mark();
    await w.say("d", "block Ana Diaz");
    const o = w.net.exportState().opps.find(x => x.id === id)!;
    expect(o.stage).toBe("scheduled");
    expect(w.to("b", from)).toEqual([]);
    expect(w.to("c", from)).toEqual([]);
    expect(w.log("meeting_cancelled")).toEqual([]);
  });
});
