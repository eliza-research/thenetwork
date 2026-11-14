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

  test("a booked group closes when only two consenting members remain", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")], { review: "auto" });
    await w.onboard("a", "b", "c");
    const id = w.propose(["a", "b", "c"]);
    for (let i = 0; i < 6 && w.meetings.length === 0; i++) {
      await w.runUntil(() => ["a", "b", "c"].some(x => w.probed(x)), 2 * DAY);
      for (const x of ["a", "b", "c"]) if (w.probed(x)) await w.say(x, "yes");
    }
    const opportunity = () => w.net.exportState().opps.find(o => o.id === id);
    expect(opportunity()?.stage).toBe("scheduled");
    const from = w.mark();
    await w.say("c", "sorry, I can't make it anymore");
    // spec/opportunityLifecycle.md, "Only an approved proposal with enough consent can book"
    expect(opportunity()?.stage).toBe("closed");
    for (const id of ["a", "b"]) expect(w.to(id, from).map(s => s.body)).toEqual([expect.stringMatching(/this one is off now/i)]);
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

  test("affirming 'Who do you mean: Ben?' with 'yes' files the report", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    await w.run(5 * DAY);
    let from = w.mark();
    await w.say("a", "report him, he was creepy");
    expect(w.to("a", from).map(s => s.body)).toEqual([expect.stringMatching(/^Who do you mean: Ben\?/)]);
    expect(w.net.safetyReports()).toHaveLength(0);
    from = w.mark();
    await w.say("a", "yes");
    expect(w.net.safetyReports().map(r => [r.reporterId, r.subjectId])).toEqual([["a", "b"]]);
  });

  test("a member with no counterparts can block someone by name after answering 'Who do you mean?'", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
    await w.onboard("a", "b");
    let from = w.mark();
    await w.say("a", "block him");
    expect(w.to("a", from).map(s => s.body)).toEqual([expect.stringMatching(/^Who do you mean\?/)]);
    from = w.mark();
    await w.say("a", "Ben");
    expect((w.net as any).blocks.has("a|b")).toBe(true);
  });

  test("active probe reply 'yes' is not hijacked by pendingSafety", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")], { review: "auto" });
    await w.onboard("a", "b", "c");
    // 'a' triggers a safety clarification question
    let from = w.mark();
    await w.say("a", "block him");
    expect(w.to("a", from).map(s => s.body)).toEqual([expect.stringMatching(/^Who do you mean\?/)]);
    
    // Now a probe arrives for 'a'
    w.propose(["a", "c"]);
    await w.runUntil(() => w.probed("a"), 2 * DAY);
    expect(w.probed("a")).toBe(true);
    
    // Answering 'yes' answers the probe rather than executing pendingSafety
    from = w.mark();
    await w.say("a", "yes");
    // Verify probe was answered and not hijacked to block
    expect(w.probed("a")).toBe(false);
    expect((w.net as any).blocks.has("a|b")).toBe(false);
  });

  test("reporting someone not a counterpart after 'Who do you mean?' does not file a report", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
    await w.onboard("a", "b");
    let from = w.mark();
    await w.say("a", "report him, he was creepy");
    expect(w.to("a", from).map(s => s.body)).toEqual([expect.stringMatching(/^Who do you mean\?/)]);
    from = w.mark();
    await w.say("a", "Ben");
    // Report is not filed because 'b' was never a counterpart of 'a'
    expect(w.net.safetyReports()).toHaveLength(0);
    expect(w.to("a", from).map(s => s.body)).toEqual([expect.stringMatching(/couldn't tell who you mean/i)]);
  });
});

