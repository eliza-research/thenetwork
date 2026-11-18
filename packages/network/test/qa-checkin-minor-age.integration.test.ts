// A check-in answer that says the date is under 18 files a minor report, like the
// same words sent as a "report ..." message do (network.ts handleBlock reads the
// spelled-out age through otherAgeStated; the check-in path reads only reportKindOf).
import { expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

async function dated(answer: string) {
  const w = new Mini([
    { id: "a", name: "Ana Diaz", age: 30, area: "Upper West Side" },
    { id: "b", name: "Ben Ito", age: 30, area: "Williamsburg" },
  ], { hooks: { postDateReports: true } });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  expect(w.meetings.length).toBe(1);
  await w.run(5 * DAY);
  expect(w.to("a").map(s => s.body).join(" ")).toMatch(/How did it go with Ben\?/);
  const mark = w.mark();
  await w.say("a", answer);
  return { w, mark };
}

test("a check-in answer saying the date is seventeen files a minor report", async () => {
  const { w, mark } = await dated("he said he's seventeen");
  expect(w.net.safetyReports().map(r => [r.kind, r.source, r.reporterId, r.subjectId])).toEqual([["minor", "check_in", "a", "b"]]);
  expect(w.net.exportState().blocks).toContain("a|b");
  expect(w.net.safetyCases().find(c => c.memberId === "b")?.events.map(e => e.kind)).toContain("report:minor");
  expect(w.to("a", mark).map(s => s.body).join(" ")).toMatch(/blocked them for you and flagged this for the safety team/);
});

test("the same age as digits, with a sentence-final period, also files it", async () => {
  const { w } = await dated("he said he's 17.");
  expect(w.net.safetyReports().map(r => [r.kind, r.source])).toEqual([["minor", "check_in"]]);
});

test("a fine date files no report", async () => {
  const { w } = await dated("it was fine, we clicked");
  expect(w.net.safetyReports()).toHaveLength(0);
  expect(w.net.exportState().blocks).toHaveLength(0);
});
