// A member on hold or banned keeps no power over other members (trust.ts: a reporter on hold is not
// credible). Their "report X" text is kept for staff, but an urgent report from them does not take
// the person they name out of matching (SD-072). A member on hold may still block: the pair stays apart.
import { describe, expect, test } from "bun:test";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

async function booked() {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  expect(w.meetings.length).toBe(1);
  expect(w.net.safetyHeld("a" as never)).toBe(false);
  return w;
}

describe("a report by a member on hold or banned", () => {
  for (const action of ["banned", "held"] as const) {
    test(`SD-072: a ${action} reporter's urgent report is kept for staff but holds nobody`, async () => {
      const w = await booked();
      const r = action === "banned" ? w.net.markBanned("b" as never, "safety@ntwrk.party") : w.net.holdMember("b" as never, "safety@ntwrk.party");
      expect(r.ok).toBe(true);
      await w.say("b", "report Ana, she threatened me");
      const rep = w.net.safetyReports().filter(x => x.subjectId === "a");
      expect(rep.map(x => [x.reporterId, x.kind, x.status])).toEqual([["b", "unsafe", "open"]]);
      // Not out of matching: no hold, no report hold, and nothing dropped her from what she was in.
      expect(w.net.safetyHeld("a" as never)).toBe(false);
      expect(w.log("trust").filter(l => l.detail.memberId === "a")).toEqual([]);
    });
  }
});
