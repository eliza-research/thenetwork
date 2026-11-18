// A member booked into a group plan and a one-to-one date at once (a plan yes waiting for quorum does
// not make them busy) cancels one of them: the Network drops the booking the text names, else the
// soonest, and tells that booking's other people (PRD F17, F18).
import { expect, test } from "bun:test";
import { HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const runner = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["running", "hiking"], skills: [], wants: [{ objective: "find people to run with", category: "hobby" as const }] });

async function twoBookings() {
  const w = new Mini([runner("a", "Ana Diaz"), runner("b", "Ben Ito"), runner("c", "Cal Moss"), runner("d", "Dee Lane"), { ...runner("e", "Eve Ruiz"), interests: ["chess"] }], { review: "auto", matchingEnabled: true } as any);
  await w.onboard("a", "b", "c", "d", "e");
  const opps = () => [...(w.net as any).opps.values()] as any[];
  const plan = () => opps().find(o => o.plan);
  // Ana says yes to the group run probe; the plan waits for the others.
  for (let i = 0; i < 24 * 8 && !(plan() && plan().status.get("a") === "available"); i++) {
    await w.run(HOUR);
    const aw = (w.net as any).members.get("a").awaiting;
    if (aw?.kind === "probe" && plan() && aw.oppId === plan().id) await w.say("a", "yes");
  }
  // Meanwhile a coffee with Eve is booked.
  w.propose(["a", "e"], { category: "professional", objective: "a coffee chat about careers" });
  await w.answerProbes(["a", "e"]);
  const date = opps().find(o => !o.plan && o.participants.includes("e"));
  for (let i = 0; i < 24 * 4 && plan().stage !== "scheduled"; i++) { await w.run(HOUR); for (const id of ["b", "c", "d"]) if (w.probed(id)) await w.say(id, "yes"); }
  expect(plan().stage).toBe("scheduled");
  expect(date.stage).toBe("scheduled");
  expect(date.meetingAt).toBeLessThan(plan().meetingAt);
  await w.say("a", "great, thanks");
  w.clock.advance(HOUR);
  return { w, plan: plan(), date };
}

const types = (w: Mini, id: string, from: number) => w.to(id as any, from).map(s => (s.meta as any).type);

test("a cancel that names the coffee drops the coffee, not the group run", async () => {
  const { w, plan, date } = await twoBookings();
  const from = w.mark();
  await w.say("a", "I can't make it to coffee on Saturday anymore, sorry");
  expect(date.status.get("a")).toBe("dropped");
  expect(date.stage).toBe("closed");
  expect(types(w, "e", from)).toContain("cancellation");
  expect(plan.status.get("a")).toBe("yes");
  for (const id of ["b", "c", "d"]) expect(types(w, id, from)).not.toContain("cancellation");
}, 120_000);

test("a cancel that names the group run drops the group run, not the coffee", async () => {
  const { w, plan, date } = await twoBookings();
  const from = w.mark();
  await w.say("a", "sorry, I can't make it to the run on Sunday anymore");
  expect(plan.status.get("a")).toBe("dropped");
  expect(date.status.get("a")).toBe("yes");
  expect(types(w, "e", from)).not.toContain("cancellation");
}, 120_000);

test("a cancel that names neither drops the sooner booking", async () => {
  const { w, plan, date } = await twoBookings();
  await w.say("a", "sorry, I can't make it anymore");
  expect(date.status.get("a")).toBe("dropped");
  expect(plan.status.get("a")).toBe("yes");
}, 120_000);
