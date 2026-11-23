import { expect, test } from "vitest";
import { HOUR, type NetworkContext, type NetworkUnderTest } from "@thenetwork/core";
import { nycPersonas } from "../../network/harness/experiment.ts";
import type { PersonaAgent } from "../src/agent/types.ts";
import { World } from "../src/world.ts";

// spec/friendsWeek.md, "A Friends repeat uses its own completed table and a fresh review"
test("a delivered plan refusal creates no repeat-interest edge in the simulated snapshot", async () => {
  const personas = (await nycPersonas()).filter(p => p.id === "ny-0033" || p.id === "ny-0093").map(p => ({ ...p, joinDay: 0 }));
  expect(personas).toHaveLength(2);
  const members = personas.map(p => p.id);
  const planId = "fixture-held-plan";
  const plan = { planId, activity: "hiking" };
  const fixture: { context?: NetworkContext } = {};
  const network: NetworkUnderTest = {
    name: "repeat feedback fixture",
    init(context) { fixture.context = context; },
    onInbound() {},
    tick() {},
  };
  const agent: PersonaAgent = {
    mode: "policy",
    async joinMessage() { return "Hello!"; },
    async initiative() { return undefined; },
    async respond({ persona, memory }, message) {
      if (message.meta?.type === "proposal") {
        memory.proposals[planId] = { decision: "accept", plannedShow: true, enjoyment: 1, others: members.filter(id => id !== persona.id) };
      }
      return { action: "ignore", intent: "ignore", messageType: message.meta?.type ?? "info", decision: "none", delayMs: 0 };
    },
  };
  const world = new World({ app: "ntwrk", seed: 4, personas, days: 4, network, agent, plans: true, writeLog: false });
  await world.begin();
  await world.advanceTo(world.clock.now() + 36 * HOUR);
  expect(world.snapshot().members).toHaveLength(2);
  const context = fixture.context!;
  const meetingAt = world.clock.now() + HOUR;
  for (const member of members) {
    const invitation = context.send(member, "Want to join a hike?", { reply: true, meta: { type: "proposal", proposalId: planId, plan } });
    expect(invitation.status).toBe("delivered");
  }
  context.recordMeeting({ proposalId: planId, participants: members, at: meetingAt, city: "nyc", kind: "plan" });
  await world.advanceTo(meetingAt);
  const outcome = world.records.find(r => r.type === "outcome" && r.proposalId === planId);
  expect(outcome?.type === "outcome" ? Object.values(outcome.attendance).map(a => a.showed) : []).toEqual([true, true]);
  for (const member of members) {
    const prompt = context.send(member, "Would you do that again?", { reply: true, meta: { type: "feedback_request", proposalId: planId, plan } });
    expect(prompt.status).toBe("delivered");
  }
  await world.advanceTo(meetingAt + 1);
  const edges = () => world.snapshot().edges.filter(e => e.type === "would_interact_again").map(e => ({ from: e.from, to: e.to }));
  expect(edges()).toEqual([]);
  const answers = ["Not again, thanks.", "Yes, I won't miss doing that again."];
  for (const [index, text] of answers.entries()) world.act({ do: "say", persona: members[index]!, text });
  await world.advanceTo(meetingAt + 2);
  for (const [index, text] of answers.entries()) {
    expect(world.records.some(r => r.type === "message" && r.msg.direction === "inbound"
      && r.msg.memberId === members[index] && r.msg.body === text && r.msg.status === "delivered")).toBe(true);
  }
  expect(edges()).toEqual([{ from: members[1], to: members[0] }]);
});
