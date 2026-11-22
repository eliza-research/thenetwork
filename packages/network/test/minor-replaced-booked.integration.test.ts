// spec/opportunityLifecycle.md, "A new minor signal closes an unbooked opportunity involving that
// person": a member who got a probe, said no and was replaced stays on the roster. NYC world, seed 3:
// that member was found to be 16 after the two adults had booked, and the adults then got a reminder
// and a feedback request about a plan the minor had been asked about.
import { expect, test } from "vitest";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

test("a booked plan closes when a member who was asked about it and replaced is found to be a minor", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")], { review: "auto" });
  await w.onboard("a", "b", "c");
  const id = w.propose(["a", "b"], { alternates: ["c"] });
  expect(await w.runUntil(() => w.probed("a"))).toBe(true);
  await w.say("a", "yes");
  expect(await w.runUntil(() => w.probed("b"))).toBe(true);
  await w.say("b", "No thanks, I'll pass.");
  expect(await w.runUntil(() => w.probed("c"))).toBe(true);
  await w.say("c", "yes");
  expect(w.meetings.length).toBe(1);
  const from = w.mark();
  await w.say("b", "I'm 16, is that ok?");
  expect(w.log("minor_signal").map(l => l.detail.memberId)).toEqual(["b"]);
  expect(w.log("opportunity_closed").filter(l => l.detail.proposalId === id).map(l => l.detail.reason)).toEqual(["minors policy"]);
  await w.run(3 * 24 * 3600_000);
  // After the minor signal the adults hear only that the plan is off: no reminder, no feedback request.
  const about = w.sent.slice(from).filter(s => s.to !== "b" && s.meta.proposalId === id).map(s => s.meta.type);
  expect(about.every(t => t === "info" || t === "cancellation")).toBe(true);
  expect(about.length).toBeGreaterThan(0);
});
