import { expect, test } from "vitest";
import type { RunRecord } from "@thenetwork/core";
import type { NetworkContext } from "@thenetwork/sim";
import { computeMetrics } from "../../sim/src/judge/metrics.ts";
import { Mini, type Spec } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

function judgedWorld(people: Spec[]) {
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
  const minorContacts = (minor: string) => {
    const personas: RunRecord[] = people.map(p => ({ t: 0, type: "persona", persona: {
      id: p.id, name: p.name, archetype: "regular", homeCity: "nyc", joinDay: 0, trueAge: p.id === minor ? 16 : 30, claimedAge: 30, quietHours: [21, 9], romanceOptIn: false,
    } }));
    return computeMetrics([...personas, ...records]).invariants.byRule.minor_contact ?? 0;
  };
  return { w: new Judged(people), minorContacts };
}

async function replaceB(w: Mini) {
  expect(await w.runUntil(() => w.probed("a"))).toBe(true);
  await w.say("a", "yes");
  expect(await w.runUntil(() => w.probed("b"))).toBe(true);
  await w.say("b", "No thanks, I'll pass.");
  expect(await w.runUntil(() => w.probed("a"))).toBe(true);
  await w.say("a", "yes");
  expect(await w.runUntil(() => w.probed("c"))).toBe(true);
}

const noRecordAge = (id: string, name: string) => ({ ...climber(id, name), age: undefined });

test("a booked plan closes when a member who was asked about it and replaced is found to be a minor", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")]);
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
  const about = w.sent.slice(from).filter(s => s.to !== "b" && s.meta.proposalId === id);
  expect(about.map(s => s.to).sort()).toEqual(["a", "c"]);
  for (const s of about) expect(["info", "cancellation"]).toContain(s.meta.type);
});

test("after a minor signal at night, the adults' cancellation is not about a plan with a minor on it", async () => {
  const people = [climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")];
  const { w, minorContacts } = judgedWorld(people);
  const queued = () => w.net.exportState().deferred.filter(d => d.meta.proposalId === id);
  await w.onboard("a", "b", "c");
  const id = w.propose(["a", "b"], { alternates: ["c"] });
  await replaceB(w);
  await w.until(22);
  await w.say("c", "yes");
  expect(w.meetings.length).toBe(1);
  expect(queued().length).toBeGreaterThan(0);
  await w.until(23);
  const from = w.mark(), at = w.clock.now();
  await w.say("b", "I'm 16, is that ok?");
  expect(w.log("opportunity_closed").filter(l => l.detail.proposalId === id).map(l => l.detail.reason)).toEqual(["minors policy"]);
  expect(queued()).toEqual([]);
  const state = w.net.exportState();
  const meetup = state.meetups!.meetups.find(m => m.meetupId === id)!;
  expect(meetup.closed).toBe(true);
  meetup.closed = false;
  w.net.importState(state);
  await w.run(state.opps.find(o => o.id === id)!.meetingAt! + 3600_000 - w.clock.now());
  const about = w.sent.slice(from).filter(s => s.meta.proposalId === id);
  expect(about.map(s => s.to).sort()).toEqual(["a", "c"]);
  for (const s of about) {
    expect(s.t).toBe(at);
    expect(s.reply).toBeUndefined();
    expect(s.meta.type).toBe("cancellation");
    expect(s.body).not.toMatch(/Ben|16|18|minor|age/i);
  }
  expect(minorContacts("b")).toBe(0);
});

test("a booked group of four closes when a member who is going is found to be a minor", async () => {
  const people = [climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss"), climber("d", "Dee Park")];
  const ids = people.map(p => p.id);
  const { w, minorContacts } = judgedWorld(people);
  await w.onboard(...ids);
  const id = w.propose(ids);
  await w.answerProbes(ids);
  expect(w.meetings.length).toBe(1);
  await w.until(14);
  const from = w.mark();
  await w.say("b", "I'm 16, is that ok?");
  expect(w.log("opportunity_closed").filter(l => l.detail.proposalId === id).map(l => l.detail.reason)).toEqual(["minors policy"]);
  await w.run(3 * 24 * 3600_000);
  const about = w.sent.slice(from).filter(s => s.meta.proposalId === id);
  expect(about.map(s => s.to).sort()).toEqual(["a", "c", "d"]);
  for (const s of about) {
    expect(s.meta.type).toBe("cancellation");
    expect(s.body).not.toMatch(/Ben|16|18|minor|age/i);
  }
  expect(minorContacts("b")).toBe(0);
});

test("a booked group of four closes when a member who stated 30 writes that they are 12", async () => {
  const people = [climber("a", "Ana Diaz"), noRecordAge("b", "Ben Ito"), climber("c", "Cy Moss"), climber("d", "Dee Park")];
  const ids = people.map(p => p.id);
  const w = new Mini(people);
  await w.onboard("a", "c", "d");
  await w.onboardStatingThirty("b");
  const id = w.propose(ids);
  await w.answerProbes(ids);
  expect(w.meetings.length).toBe(1);
  await w.until(14);
  const from = w.mark();
  await w.say("b", "I am 12 years old");
  expect(w.net.isDeclined("b")).toBe(true);
  expect(w.log("opportunity_closed").filter(l => l.detail.proposalId === id).map(l => l.detail.reason)).toEqual(["minors policy"]);
  await w.run(3 * 24 * 3600_000);
  const about = w.sent.slice(from).filter(s => s.meta.proposalId === id);
  expect(about.map(s => s.to).sort()).toEqual(["a", "c", "d"]);
  for (const s of about) {
    expect(s.meta.type).toBe("cancellation");
    expect(s.body).not.toMatch(/still on|Ben|12|minor|age/i);
  }
  const state = w.net.exportState();
  expect(state.members.map(m => m.id)).not.toContain("b");
  expect(state.opps.filter(o => o.participants.includes("b") || o.contacted.includes("b"))).toEqual([]);
  const flagged = w.net.safetyCases().filter(c => c.events.some(e => e.kind === "contact_with_minor")).map(c => c.memberId).sort();
  expect(flagged).toEqual(["a", "c", "d"]);
});

test("a booked pair closes when its asked and replaced member who stated 30 writes that they are 12", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), noRecordAge("b", "Ben Ito"), climber("c", "Cy Moss")]);
  await w.onboard("a", "c");
  await w.onboardStatingThirty("b");
  const id = w.propose(["a", "b"], { alternates: ["c"] });
  await replaceB(w);
  await w.say("c", "yes");
  expect(w.meetings.length).toBe(1);
  const from = w.mark();
  await w.say("b", "I am 12 years old");
  expect(w.net.isDeclined("b")).toBe(true);
  const opp = w.net.exportState().opps.find(o => o.id === id)!;
  expect(opp).toMatchObject({ stage: "closed", closedReason: "minors policy" });
  expect([...opp.participants, ...opp.contacted, ...opp.status.map(([member]) => member), ...Object.keys(opp.sentAt ?? {})]).not.toContain("b");
  await w.run(3 * 24 * 3600_000);
  const about = w.sent.slice(from).filter(s => s.meta.proposalId === id);
  expect(about.map(s => s.to).sort()).toEqual(["a", "c"]);
  expect(about.every(s => s.meta.type === "cancellation")).toBe(true);
});

test("a minor signal after the start closes the booking without a message to the adults", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")]);
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

test("an adult who said yes to a probe hears it did not come together when the other member is found to be a minor", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
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
