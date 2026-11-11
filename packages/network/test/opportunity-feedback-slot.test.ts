// The answer to "How did it go?" belongs to the meeting it asks about (SD-077). A probe for a new item
// that goes out while the feedback question is still open would take the member's one answer slot,
// and "Great time, thanks!" would be read as a yes to meet a stranger. The probe waits until the
// feedback is answered. The real ConsentNetwork and engine on a SimClock (mini.ts), with the
// simulated reviewer.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const opp = (w: Mini, id: string) => [...(w.net as any).opps.values()].find((o: any) => o.id === id);

describe("feedback answer and a new probe", () => {
  test(`"Great time, thanks!" answers the feedback, not a new probe`, async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cleo Park")]);
    await w.onboard("a", "b", "c");
    const first = w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    expect(opp(w, first).stage).toBe("scheduled");
    const meetingAt = opp(w, first).meetingAt as number;
    // The member writes after the reminder, so a new invite is allowed after the feedback ask.
    await w.runUntil(() => opp(w, first).reminded.has("a"), 6 * DAY);
    await w.say("a", "see you there");
    await w.runUntil(() => w.clock.now() >= meetingAt + 3 * HOUR && opp(w, first).feedbackSent, 2 * DAY);
    expect(w.net.memberList().find(m => m.id === "a")?.awaiting?.kind).toBe("feedback");
    const second = w.propose(["a", "c"]);
    await w.run(2 * DAY);
    await w.say("a", "Great time, thanks!");
    expect(opp(w, second).status.get("a")).not.toBe("available");
    expect(w.log("feedback").filter(l => l.detail.memberId === "a" && l.detail.proposalId === first)).toHaveLength(1);
    // After the feedback, the probe goes out and gets its own answer.
    expect(await w.runUntil(() => w.probed("a"), 3 * DAY)).toBe(true);
  });
});
