// spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that
// person": a member who got a probe, said no and was replaced stays on the roster. NYC world, seed 3:
// that member was found to be 16 after the two adults had booked, and the adults then got a reminder
// and a feedback request about a plan the minor had been asked about.
import { expect, test } from "vitest";
import type { RunRecord } from "@thenetwork/core";
import type { NetworkContext } from "@thenetwork/sim";
import { computeMetrics } from "../../sim/src/judge/metrics.ts";
import { Mini } from "./mini.ts";
import { simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

/**
 * Ana says yes, Ben declines and is replaced by Cy. Ana is asked again about Cy and says yes
 * (spec/probeDispatch.md, "A replacement asks again every member who agreed to the earlier arrangement"); Cy is
 * then asked.
 */
async function replaceB(w: Mini) {
  expect(await w.runUntil(() => w.probed("a"))).toBe(true);
  await w.say("a", "yes");
  expect(await w.runUntil(() => w.probed("b"))).toBe(true);
  await w.say("b", "No thanks, I'll pass.");
  expect(await w.runUntil(() => w.probed("a"))).toBe(true);
  await w.say("a", "yes");
  expect(await w.runUntil(() => w.probed("c"))).toBe(true);
}

test("a booked plan closes when a member who was asked about it and replaced is found to be a minor", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")], { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard("a", "b", "c");
  const id = w.propose(["a", "b"], { alternates: ["c"] });
  await replaceB(w);
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
  const w = new Judged(people, { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  const queued = () => (w.net.exportState() as unknown as { deferred: { meta: { proposalId?: string } }[] }).deferred.filter(d => d.meta.proposalId === id);
  await w.onboard("a", "b", "c");
  const id = w.propose(["a", "b"], { alternates: ["c"] });
  await replaceB(w);
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
    // A booking closes on closeBooking: Cy, whom the booked plan reached, and Ana, whose booked plan was still
    // queued, get the same cancellation.
    expect(s.meta.type).toBe("cancellation");
    expect(s.body).not.toMatch(/Ben|16|18|minor|age/i);
  }
  const personas: RunRecord[] = people.map(p => ({ t: 0, type: "persona", persona: {
    id: p.id, name: p.name, archetype: "regular", homeCity: "nyc", joinDay: 0, trueAge: p.id === "b" ? 16 : 30, claimedAge: 30, quietHours: [21, 9], romanceOptIn: false,
  } }));
  expect(computeMetrics([...personas, ...records]).invariants.byRule.minor_contact ?? 0).toBe(0);
});

// spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person": a booked
// group of four whose member is found to be a minor closes. Before, the three adults went on with the plan
// and got reminders and feedback requests about a plan whose roster included the minor (3 minor contacts,
// signal at 14:00).
test("a booked group of four closes when a member who is going is found to be a minor", async () => {
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
  const people = [climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss"), climber("d", "Dee Park")];
  const ids = people.map(p => p.id);
  const w = new Judged(people, { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard(...ids);
  const id = w.propose(ids);
  await w.answerProbes(ids);
  expect(w.meetings.length).toBe(1);
  await w.until(14);
  const from = w.mark();
  await w.say("b", "I'm 16, is that ok?");
  // Its own reason, so staff and metrics can tell it from an ordinary dropout.
  expect(w.log("opportunity_closed").filter(l => l.detail.proposalId === id).map(l => l.detail.reason)).toEqual(["minors policy"]);
  await w.run(3 * 24 * 3600_000);
  const about = w.sent.slice(from).filter(s => s.meta.proposalId === id);
  // Each adult hears once that the plan is off, with no reason and no name; nothing else follows.
  expect(about.map(s => s.to).sort()).toEqual(["a", "c", "d"]);
  for (const s of about) {
    expect(s.meta.type).toBe("cancellation");
    expect(s.body).not.toMatch(/Ben|16|18|minor|age/i);
  }
  const personas: RunRecord[] = people.map(p => ({ t: 0, type: "persona", persona: {
    id: p.id, name: p.name, archetype: "regular", homeCity: "nyc", joinDay: 0, trueAge: p.id === "b" ? 16 : 30, claimedAge: 30, quietHours: [21, 9], romanceOptIn: false,
  } }));
  expect(computeMetrics([...personas, ...records]).invariants.byRule.minor_contact ?? 0).toBe(0);
});

/** Join with no age on record and state an adult age during onboarding. */
const joinStatingThirty = async (w: Mini, id: string) => {
  for (const text of ["hi!", "I'm 30.", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."]) await w.say(id, text);
};
const noRecordAge = (id: string, name: string) => ({ ...climber(id, name), age: undefined });

// spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person": a stated age
// under the join age declines the member and deletes their data, and it is a minor signal first. Review
// 2026-11-17: the decline ran before the minors policy, so the three adults heard "the rest of you are still on".
test("a booked group of four closes when a member who stated 30 writes that they are 12", async () => {
  const people = [climber("a", "Ana Diaz"), noRecordAge("b", "Ben Ito"), climber("c", "Cy Moss"), climber("d", "Dee Park")];
  const ids = people.map(p => p.id);
  const w = new Mini(people, { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard("a", "c", "d");
  await joinStatingThirty(w, "b");
  const id = w.propose(ids);
  await w.answerProbes(ids);
  expect(w.meetings.length).toBe(1);
  await w.until(14);
  const from = w.mark();
  await w.say("b", "I am 12 years old");
  expect(w.net.isDeclined("b")).toBe(true);
  expect(w.log("opportunity_closed").filter(l => l.detail.proposalId === id).map(l => l.detail.reason)).toEqual(["minors policy"]);
  await w.run(3 * 24 * 3600_000);
  // Each adult hears once that the plan is off, with no reason and no name; nothing else follows.
  const about = w.sent.slice(from).filter(s => s.meta.proposalId === id);
  expect(about.map(s => s.to).sort()).toEqual(["a", "c", "d"]);
  for (const s of about) {
    expect(s.meta.type).toBe("cancellation");
    expect(s.body).not.toMatch(/still on|Ben|12|minor|age/i);
  }
  // Nothing about the child stays, but the staff record of the adults who were booked with them does.
  const state = w.net.exportState();
  expect(state.members.map(m => m.id)).not.toContain("b");
  expect(state.opps.filter(o => o.participants.includes("b") || o.contacted.includes("b"))).toEqual([]);
  const flagged = w.net.safetyCases().filter(c => c.events.some(e => e.kind === "contact_with_minor")).map(c => c.memberId).sort();
  expect(flagged).toEqual(["a", "c", "d"]);
});

// spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person". Review
// 2026-11-17: the booking stayed scheduled and the two adults got 4 reminders about a plan the child was asked about.
test("a booked pair closes when its asked and replaced member who stated 30 writes that they are 12", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), noRecordAge("b", "Ben Ito"), climber("c", "Cy Moss")], { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard("a", "c");
  await joinStatingThirty(w, "b");
  const id = w.propose(["a", "b"], { alternates: ["c"] });
  await replaceB(w);
  await w.say("c", "yes");
  expect(w.meetings.length).toBe(1);
  const from = w.mark();
  await w.say("b", "I am 12 years old");
  expect(w.net.isDeclined("b")).toBe(true);
  // The adults' opportunity stays on record, closed for the minors policy, with nothing about the child.
  const opp = w.net.exportState().opps.find(o => o.id === id)!;
  expect(opp).toMatchObject({ stage: "closed", closedReason: "minors policy" });
  expect([...opp.participants, ...opp.contacted, ...opp.status.map(([member]) => member), ...Object.keys(opp.sentAt ?? {})]).not.toContain("b");
  await w.run(3 * 24 * 3600_000);
  const about = w.sent.slice(from).filter(s => s.meta.proposalId === id);
  expect(about.map(s => s.to).sort()).toEqual(["a", "c"]);
  expect(about.every(s => s.meta.type === "cancellation")).toBe(true);
});

// spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person": after the start
// the adults get nothing more about it. Before, the close sent "That one didn't come together" to two adults
// who had already met.
test("a minor signal after the start closes the booking without a message to the adults", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")], { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard("a", "b", "c");
  const id = w.propose(["a", "b"], { alternates: ["c"] });
  await replaceB(w);
  await w.say("c", "yes");
  const meetingAt = w.net.exportState().opps.find(o => o.id === id)!.meetingAt!;
  await w.run(meetingAt + 30 * 60_000 - w.clock.now());
  const from = w.mark();
  await w.say("b", "I'm 16, is that ok?");
  expect(w.log("opportunity_closed").filter(l => l.detail.proposalId === id).map(l => l.detail.reason)).toEqual(["minors policy"]);
  await w.run(3 * 24 * 3600_000);
  expect(w.sent.slice(from).filter(s => s.meta.proposalId === id)).toEqual([]);
});

// spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person": in probing, a
// member who said yes hears that it did not come together. Before, Ana said yes and then heard nothing.
test("an adult who said yes to a probe hears it did not come together when the other member is found to be a minor", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  await w.onboard("a", "b");
  const id = w.propose(["a", "b"]);
  expect(await w.runUntil(() => w.probed("a"))).toBe(true);
  await w.say("a", "yes");
  expect(await w.runUntil(() => w.probed("b"))).toBe(true);
  const from = w.mark();
  await w.say("b", "I'm 16, is that ok?");
  await w.run(24 * 3600_000);
  const about = w.sent.slice(from).filter(s => s.meta.proposalId === id);
  expect(about.map(s => [s.to, s.meta.type])).toEqual([["a", "cancellation"]]);
  expect(about[0]!.body).not.toMatch(/Ben|16|minor|age/i);
});
