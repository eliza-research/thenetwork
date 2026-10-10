// "Who do you mean?" in a group plan names only people the member was booked with: an invitee who
// was only probed (no names) is no counterpart, and a member who only got the probe is shown no names.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

describe("block and report targets in a group plan", () => {
  test("a probe-only invitee is neither offered nor shown names", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss"), climber("d", "Dee Park"), climber("e", "Eve Lu")], { review: "auto" });
    await w.onboard("a", "b", "c", "d", "e");
    const id = w.propose(["a", "b", "c"]);
    for (let i = 0; i < 6 && w.meetings.length === 0; i++) {
      await w.runUntil(() => ["a", "b", "c"].some(x => w.probed(x)), 2 * DAY);
      for (const x of ["a", "b", "c"]) if (w.probed(x)) await w.say(x, "yes");
    }
    // The plan is booked with Ana, Ben and Cy. Then, as a plan's lane does after booking, Dee is probed
    // as a late joiner (no names, no answer yet) and Eve was probed and is unavailable.
    const st = w.net.exportState();
    const o = st.opps.find(x => x.id === id)!;
    expect(o.stage).toBe("scheduled");
    expect([...(o.bookedTold ?? [])].sort()).toEqual(["a", "b", "c"]);
    o.participants = [...o.participants, "d", "e"];
    o.status = [...o.status, ["d", "probing"], ["e", "unavailable"]];
    o.contacted = [...new Set([...o.contacted, "d", "e"])];
    w.net.importState(st);

    // Dee only got the probe: "block him" shows her none of the booked members' names.
    let from = w.mark();
    await w.say("d", "block him");
    const toD = w.to("d", from).map(s => s.body).join(" ");
    expect(toD).toMatch(/Who do you mean\?/);
    expect(toD).not.toMatch(/Ana|Ben|Cy|Eve/);
    await w.say("d", "never mind");

    // Ana was booked with Ben and Cy: Dee and Eve, who were only probed, are not offered.
    from = w.mark();
    await w.say("a", "block him");
    const toA = w.to("a", from).map(s => s.body).join(" ");
    expect(toA).toMatch(/Who do you mean: (Ben or Cy|Cy or Ben)\?/);
    expect(toA).not.toMatch(/Dee|Eve/);
  });

  test("a report by pronoun with no date ahead asks who first; the name then files it", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    expect(w.meetings.length).toBe(1);
    await w.run(5 * DAY);
    expect([...(w.net as any).opps.values()].some((o: any) => o.stage === "scheduled")).toBe(false);
    let from = w.mark();
    await w.say("a", "report him, he keeps messaging me on IG");
    expect(w.to("a", from).map(s => s.body)).toEqual([expect.stringMatching(/^Who do you mean: Ben\?/)]);
    expect(w.net.safetyReports()).toHaveLength(0);
    from = w.mark();
    await w.say("a", "Ben");
    expect(w.net.safetyReports().map(r => [r.reporterId, r.subjectId])).toEqual([["a", "b"]]);
  });
});
