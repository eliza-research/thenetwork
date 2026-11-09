// One missed meeting counts as one no-show (SD-328). Ana came and said Ben never showed. Ben stayed
// silent, so the attendance close (4 days after the meeting) counted his no-show. Before the fix,
// Ben's late answer "Sorry I never showed up, I couldn't make it" (still inside the 7-day feedback
// window) counted the same no-show a second time. The real ConsentNetwork and engine on a SimClock (mini.ts), with the
// simulated reviewer.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const opp = (w: Mini, id: string) => [...(w.net as any).opps.values()].find((o: any) => o.id === id);
const noShows = (w: Mini, id: string) => ((w.net as any).members.get(id) as any).noShows as number;

describe("a late feedback answer after the attendance close", () => {
  test("counts a no-show once", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
    await w.onboard("a", "b");
    const id = w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    const o = opp(w, id);
    expect(o.stage).toBe("scheduled");
    const meetingAt = o.meetingAt as number;
    await w.runUntil(() => w.clock.now() >= meetingAt + 3 * HOUR && o.feedbackSent, 6 * DAY);
    await w.say("a", "I was there but Ben never showed up.");
    expect(o.post?.a?.otherNoShow).toBe(true);
    expect(await w.runUntil(() => !!o.finalized, 5 * DAY)).toBe(true);
    expect(noShows(w, "b")).toBe(1);
    expect(w.clock.now() - meetingAt).toBeLessThan(7 * DAY);
    await w.say("b", "Sorry I never showed up, I couldn't make it.");
    expect(w.log("feedback").filter(l => l.detail.memberId === "b" && l.detail.proposalId === id)).toHaveLength(1);
    expect(noShows(w, "b")).toBe(1);
  });
});
