// The vouch credit of network capital (PRD 39.2.2, packages/capital) through the real ConsentNetwork
// and the real engine: an invited adult joins, meets another member, and both say it went well.
// The Network must emit value_received with the provider's confirmation, so that the ledger gives
// the voucher the vouch credit. The small NYC world (mini.ts); nothing is sent.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { capitalWiring } from "../src/capital.ts";
import { Mini } from "./mini.ts";

const T = 120_000;
const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

describe("the vouch credit in the Network", () => {
  test("SD-154 an invitee who meets a member and says it went well earns the voucher the vouch credit", async () => {
    const wiring = capitalWiring(undefined, { reader: false });
    const w = new Mini([climber("v", "Vic Lane"), climber("i", "Ivy Moss"), climber("c", "Cal Park")], { review: "auto", onLedger: wiring.onLedger });
    w.members.find(m => m.id === "i")!.invitedBy = "v";
    await w.onboard("v", "i", "c");
    expect(wiring.ledger.isEligible("i")).toBe(true);
    w.propose(["i", "c"]);
    await w.answerProbes(["i", "c"]);
    expect(w.meetings.length).toBe(1);
    await w.run(6 * DAY);
    // The invitee answers first, then the member they met.
    await w.say("i", "It was great, we really clicked. Would do it again.");
    await w.say("c", "It was great, we really clicked. Would do it again.");
    await w.run(5 * DAY);
    expect(wiring.counts.value_received).toBeGreaterThan(0);
    expect(wiring.counts.plan_attended).toBe(2);
    expect(wiring.ledger.internalEntries("v").filter(e => e.category === "vouch").length).toBe(1);
    expect(wiring.ledger.balance("v")).toBeGreaterThan(0);
    expect(wiring.rejected()).toBe(0);
  }, T);
});
