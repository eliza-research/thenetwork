// peon's check-in after an intro says "tell me if anything felt off" (jobs.ts SEAT_COPY.checkIn). With
// peon's own hooks (service/packs.ts peonHooks), a scam in that answer is a report for staff and a
// block between the two, as on slop (SD-221).
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { copy } from "../src/copy.ts";
import { peonHooks } from "../service/packs.ts";
import { Mini } from "./mini.ts";

const worker = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["design"], skills: ["figma"], wants: [{ objective: "find a design job", category: "professional" as const }] });

describe("peon: the answer to the check-in", () => {
  test("SD-221: a scam in the check-in answer files a report", async () => {
    const w = new Mini([worker("a", "Ana Diaz"), worker("b", "Ben Ito")], { review: "auto", hooks: peonHooks() });
    await w.onboard("a", "b");
    w.propose(["a", "b"], { category: "professional", objective: "a design job" });
    await w.answerProbes(["a", "b"]);
    expect(w.meetings.length).toBe(1);
    expect(await w.runUntil(() => w.net.memberList().find(m => m.id === "a")?.awaiting?.kind === "feedback", 10 * DAY)).toBe(true);
    const from = w.mark();
    await w.say("a", "They asked me to pay $200 for training and for my SSN. It felt like a scam.");
    expect(w.net.safetyReports().map(r => [r.reporterId, r.subjectId, r.kind, r.source])).toEqual([["a", "b", "scam", "check_in"]]);
    expect(w.to("a", from).map(s => s.body)).toEqual([copy.reported]);
  });
});
