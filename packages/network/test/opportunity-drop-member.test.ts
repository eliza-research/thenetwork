// dropMember (STOP, leave, a hold) on a booked meeting drops only a member who is going (SD-047). A
// member who already called off a booked group meeting and then sends STOP is not dropped a second
// time: the others hear about it once, and the cancellation is counted once. The real ConsentNetwork
// and engine on a SimClock (mini.ts), with the simulated reviewer.
import { describe, expect, test } from "bun:test";
import { HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const opp = (w: Mini, id: string) => [...(w.net as any).opps.values()].find((o: any) => o.id === id);

describe("dropMember on a booked group meeting", () => {
  test("STOP after a cancel does not drop the member again", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cleo Park")]);
    await w.onboard("a", "b", "c");
    const id = w.propose(["a", "b", "c"]);
    await w.answerProbes(["a", "b", "c"]);
    expect(opp(w, id).stage).toBe("scheduled");
    await w.run(2 * HOUR);
    await w.say("c", "I need to cancel, sorry");
    expect(opp(w, id).status.get("c")).toBe("dropped");
    expect(opp(w, id).stage).toBe("scheduled");
    const from = w.mark();
    await w.run(HOUR);
    // The carrier keyword, as the inbound path passes it.
    await w.net.onInbound({ id: "stop-c", memberId: "c", body: "STOP", keyword: "STOP", ts: w.clock.now(), channel: "sms" } as never);
    await w.run(HOUR);
    expect(w.log("booked_cancelled").filter(l => l.detail.memberId === "c").length).toBe(1);
    expect([...w.to("a", from), ...w.to("b", from)].filter(s => s.meta.type === "cancellation")).toEqual([]);
  });
});
