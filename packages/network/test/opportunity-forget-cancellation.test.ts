// A member who leaves the app or deletes their data at night cancels their booked meeting (SD-248).
// The partner's cancellation waits for the end of quiet hours, and it must still go out after the
// opportunity is deleted with the member's data: the partner must not go to the venue for a plan
// that is off. The real ConsentNetwork and engine on a SimClock (mini.ts), with the simulated reviewer.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const opp = (w: Mini, id: string) => [...(w.net as any).opps.values()].find((o: any) => o.id === id);

describe("forget in quiet hours on a booked meeting", () => {
  test("the partner gets the cancellation in the morning", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
    await w.onboard("a", "b");
    const id = w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    expect(opp(w, id).stage).toBe("scheduled");
    expect(await w.runUntil(() => opp(w, id).bookedTold?.includes("b"), DAY)).toBe(true);
    const meetingAt = opp(w, id).meetingAt as number;
    // 23:00 New York: quiet hours for the partner.
    await w.until(23);
    expect(w.clock.now()).toBeLessThan(meetingAt);
    const from = w.mark();
    w.net.forgetMember("a");
    expect(opp(w, id)).toBeUndefined();
    await w.run(DAY);
    const notices = w.to("b", from).filter(s => s.meta.type === "cancellation");
    expect(notices).toHaveLength(1);
    expect(notices[0]!.t).toBeLessThan(meetingAt);
    expect(notices[0]!.body).not.toContain("Ana");
  });
});
