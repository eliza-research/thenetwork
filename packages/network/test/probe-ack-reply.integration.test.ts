// A bare acknowledgement answers the last message the Network sent (spec/models/opportunity.md,
// readProbe). NYC world, seed 3: a member with a probe waiting asked for something else, got an
// answer, and wrote "Thanks! 👍💯". The Network read the thanks as a yes to the probe, booked the
// plan and named the member to the other person; the member's real answer to the probe was a no.
import { expect, test } from "vitest";
import { parseReply } from "../../core/src/replies.ts";
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

test.each([
  ["deal me out", "no"],
  ["go ahead without me", "no"],
  ["Yes, go ahead without me, thanks.", "no"],
  ["Afraid not.", "no"],
  ["I'm afraid not, thanks.", "no"],
  ["Not a chance!", "no"],
  ["No chance.", "no"],
  ["Not a chance. Great!", "unsure"],
  ["Great. Not a chance.", "unsure"],
  ["“Not a chance. Great!”", "unsure"],
  ["Ana said, “Afraid not.” I can make it.", "yes"],
  ["I can't see why not", "yes"],
  ["Why the heck not!", "yes"],
  ["Let's do that.", "yes"],
  ["That would work for me.", "yes"],
  ["That wouldn't work for me.", "no"],
  ["Let's not do that.", "no"],
  ["That would be great if I get a ride.", "unsure"],
  ["Deal!", "yes"],
  ["Go ahead.", "yes"],
  ["“Go ahead without me. Yes.”", "unsure"],
  ["Ana said, 'Deal me out.'", "unsure"],
  ["Ana said go ahead without me.", "unsure"],
  ["Don't deal me out.", "unsure"],
  ["Yes, please don’t go ahead without me.", "unsure"],
  ["She said, “Go ahead without me.” I can make it.", "yes"],
] as const)("reads %s as %s on both the shared reader and an actual delivered probe", async (reply, answer) => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  expect(await w.runUntil(() => w.probed("a"))).toBe(true);
  await w.say("a", "yes");
  expect(await w.runUntil(() => w.probed("b"))).toBe(true);
  const from = w.mark();
  await w.say("b", reply);
  expect(w.log("probe_answer").filter(l => l.detail.memberId === "b").map(l => l.detail.yes)).toEqual(answer === "unsure" ? [] : [answer === "yes"]);
  expect(w.meetings).toHaveLength(answer === "yes" ? 1 : 0);
  expect(w.to("a", from).some(s => s.body.includes("Ben"))).toBe(answer === "yes");
  expect(parseReply(reply).answer).toBe(answer);
  if (answer === "unsure") {
    await w.say("b", "Yes, I'd love to go.");
    expect(w.meetings).toHaveLength(1);
  }
});

test("a booked plan survives a negated withdrawal and ends on a direct one", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  const booking = w.net.exportState().opps.find(o => o.stage === "scheduled");
  if (!booking) throw new Error("Expected the accepted probe to book a plan.");
  await w.say("b", "Yes, please don’t go ahead without me.");
  expect(w.net.opps.get(booking.id)?.stage).toBe("scheduled");
  await w.say("b", "Go ahead without me.");
  expect(w.net.opps.get(booking.id)?.stage).toBe("closed");
  expect(w.log("booked_cancelled").map(entry => entry.detail.oppId)).toEqual([booking.id]);
});
