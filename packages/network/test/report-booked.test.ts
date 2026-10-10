// An urgent "report X" text before a booked date (network-consent-18): the reporter met the subject
// (a booked plan reached both), so the report holds the subject. The booked date is still called off
// as a block: the other member hears it is off (never why or who), meeting_cancelled is logged with
// reason "blocked", and the reporter is not offered another time with the person they reported.
import { describe, expect, test } from "bun:test";
import { copy } from "../src/copy.ts";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

describe("an urgent report before a booked date", () => {
  test("cancels the date neutrally for the subject, then holds them", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    expect(w.meetings.length).toBe(1);
    expect([...(w.net as any).opps.values()].some((o: any) => o.stage === "scheduled")).toBe(true);
    const from = w.mark();
    await w.say("a", "report Ben, he threatened me");
    expect(w.to("b", from).map(s => s.body)).toContain(copy.declinedQuiet);
    expect(w.log("meeting_cancelled").map(l => l.detail.reason)).toEqual(["blocked"]);
    const toA = w.to("a", from).map(s => s.body);
    expect(toA).toEqual([copy.reported]);
    expect(w.net.eligible("b" as never)).toBe(false);
  });
});
