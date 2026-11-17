// spec/opportunityLifecycle.md, "A new minor signal closes an unbooked opportunity involving that
// person": a member who got a probe, said no and was replaced stays on the roster. NYC world, seed 3:
// that member was found to be 16 after the two adults had booked, and the adults then got a reminder
// and a feedback request about a plan the minor had been asked about.
import { expect, test } from "vitest";
import type { RunRecord } from "@thenetwork/core";
import type { NetworkContext } from "@thenetwork/sim";
import { computeMetrics } from "../../sim/src/judge/metrics.ts";
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

// The same plan, but the age signal comes at 23:00, in the adults' quiet hours, while the booked plan
// for Ana still waits for the morning. A cancellation the Network kept in its own queue went out at 09:00,
// after the signal, about a plan the minor had been asked about: 2 minor contacts. The judge reads every
// message and log line in the order the Network made them.
test("after a minor signal at night, the adults' cancellation is not about a plan with a minor on it", async () => {
  const records: RunRecord[] = [];
  class Judged extends Mini {
    override ctx(): NetworkContext {
      const c = super.ctx();
      return {
        ...c,
        send: (memberId, body, o) => { const msg = c.send(memberId, body, o); records.push({ t: msg.ts, type: "message", msg }); return msg; },
        log: (kind, detail) => { c.log(kind, detail); records.push({ t: this.clock.now(), type: "network_log", kind, detail }); },
      };
    }
  }
  const people = [climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")];
  const w = new Judged(people, { review: "auto" });
  const queued = () => (w.net.exportState() as unknown as { deferred: { meta: { proposalId?: string } }[] }).deferred.filter(d => d.meta.proposalId === id);
  await w.onboard("a", "b", "c");
  const id = w.propose(["a", "b"], { alternates: ["c"] });
  expect(await w.runUntil(() => w.probed("a"))).toBe(true);
  await w.say("a", "yes");
  expect(await w.runUntil(() => w.probed("b"))).toBe(true);
  await w.say("b", "No thanks, I'll pass.");
  expect(await w.runUntil(() => w.probed("c"))).toBe(true);
  await w.until(22);
  await w.say("c", "yes");
  expect(w.meetings.length).toBe(1);
  // The booked plan for Ana waits in the Network's queue for the end of her quiet hours.
  expect(queued().length).toBeGreaterThan(0);
  await w.until(23);
  const from = w.mark(), at = w.clock.now();
  await w.say("b", "I'm 16, is that ok?");
  expect(w.log("opportunity_closed").filter(l => l.detail.proposalId === id).map(l => l.detail.reason)).toEqual(["minors policy"]);
  expect(queued()).toEqual([]);
  await w.run(3 * 24 * 3600_000);
  const about = w.sent.slice(from).filter(s => s.meta.proposalId === id);
  // Each adult is told once, with the safety action: no reason, no name, no age. It is not a reply, so the
  // delivery queue holds it through their quiet hours. Nothing else about the plan follows (no booked
  // plan, reminder or feedback request).
  expect(about.map(s => s.to).sort()).toEqual(["a", "c"]);
  for (const s of about) {
    expect(s.t).toBe(at);
    expect(s.reply).toBeUndefined();
    expect(s.meta.type).toBe("info");
    expect(s.body).not.toMatch(/Ben|16|18|minor|age/i);
  }
  const personas: RunRecord[] = people.map(p => ({ t: 0, type: "persona", persona: {
    id: p.id, name: p.name, archetype: "regular", homeCity: "nyc", joinDay: 0, trueAge: p.id === "b" ? 16 : 30, claimedAge: 30, quietHours: [21, 9], romanceOptIn: false,
  } }));
  expect(computeMetrics([...personas, ...records]).invariants.byRule.minor_contact ?? 0).toBe(0);
});
