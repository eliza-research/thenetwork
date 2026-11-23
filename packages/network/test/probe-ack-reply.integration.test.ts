// A bare acknowledgement answers the last message the Network sent (spec/models/opportunity.md,
// readProbe). NYC world, seed 3: a member with a probe waiting asked for something else, got an
// answer, and wrote "Thanks! 👍💯". The Network read the thanks as a yes to the probe, booked the
// plan and named the member to the other person; the member's real answer to the probe was a no.
import { expect, test } from "vitest";
import { Mini } from "./mini.ts";
import { simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

test("a thanks for another message is not a yes to the waiting probe", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  expect(await w.runUntil(() => w.probed("a"))).toBe(true);
  await w.say("a", "yes");
  expect(await w.runUntil(() => w.probed("b"))).toBe(true);
  const from = w.mark();
  await w.say("b", "Still hoping to meet someone to date. Anything come up?");
  expect(w.to("b", from).length).toBeGreaterThan(0);
  await w.say("b", "Thanks! 👍💯");
  expect(w.log("probe_answer").filter(l => l.detail.memberId === "b")).toEqual([]);
  expect(w.meetings).toEqual([]);
  expect(w.to("a", from).some(s => s.body.includes("Ben"))).toBe(false);
  // The probe still waits for b's own answer, and a clear yes to it books the plan.
  await w.say("b", "yes");
  expect(w.log("probe_answer").filter(l => l.detail.memberId === "b").map(l => l.detail.yes)).toEqual([true]);
});

test("a bare thanks right after the probe still answers it", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  expect(await w.runUntil(() => w.probed("a"))).toBe(true);
  await w.say("a", "yes");
  expect(await w.runUntil(() => w.probed("b"))).toBe(true);
  await w.say("b", "👍");
  expect(w.log("probe_answer").filter(l => l.detail.memberId === "b").map(l => l.detail.yes)).toEqual([true]);
});
