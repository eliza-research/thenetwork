// The voucher's close circle in network capital (PRD 39.2.2, packages/capital): value that a member
// tied to the voucher by member-controlled credits (help, needs, member-started plans) gives the
// invitee does not earn the vouch credit. Such credits decay over the long pair window
// (controlledPairWindowDays, 90 days), so the tie must hold for that window too, not only for the
// short one. The real ConsentNetwork and engine on the small NYC world (mini.ts); nothing is sent.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { capitalWiring } from "../src/capital.ts";
import { Mini } from "./mini.ts";

const T = 180_000;
const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

describe("the voucher's ties in the Network", () => {
  test("SD-350 a member who helped the voucher 40 days ago does not earn the voucher the vouch credit", async () => {
    const wiring = capitalWiring(undefined, { reader: false });
    const w = new Mini([climber("v", "Vic Lane"), climber("c", "Cal Park")], { review: "auto", onLedger: wiring.onLedger });
    await w.onboard("v", "c");
    // One help round between the voucher and the friend, through the Network's emitter (helpFeedback, network.ts).
    const emit = (w.net as unknown as { emit(e: object, key: string): void }).emit.bind(w.net);
    emit({ type: "help_given", helper: "v", recipient: "c", helpId: "o_help" }, "o_help");
    emit({ type: "help_confirmed", helpId: "o_help", recipient: "c", useful: true }, "o_help");
    expect(wiring.ledger.internalEntries("v").filter(e => e.category === "help").length).toBe(1);
    // 35 days later the voucher invites a new member, who meets the friend and says it went well.
    w.clock.set(w.clock.now() + 35 * DAY);
    w.add({ ...climber("i", "Ivy Moss") });
    w.members.find(m => m.id === "i")!.invitedBy = "v";
    await w.onboard("i");
    expect(wiring.ledger.isEligible("i")).toBe(true);
    w.propose(["i", "c"]);
    await w.answerProbes(["i", "c"]);
    expect(w.meetings.length).toBe(1);
    await w.run(6 * DAY);
    await w.say("i", "It was great, we really clicked. Would do it again.");
    await w.say("c", "It was great, we really clicked. Would do it again.");
    await w.run(5 * DAY);
    expect(wiring.counts.value_received).toBeGreaterThan(0);
    expect(wiring.ledger.internalEntries("v").filter(e => e.category === "vouch").length).toBe(0);
    expect(wiring.rejected()).toBe(0);
  }, T);
});
