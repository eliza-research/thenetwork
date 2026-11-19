import { expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

test("unprompted feedback follows meeting order after restart, then skips already answered meetings", async () => {
  for (const reverse of [false, true]) {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")]);
    await w.onboard("a", "b", "c");
    const id = w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    expect(w.meetings.length).toBe(1);
    const state = w.net.exportState(), template = state.opps.find(o => o.id === id)!;
    const now = w.clock.now() + 7 * DAY;
    w.clock.set(now);
    // Restore two completed bookings whose invitation order differs from their meeting order.
    state.opps = [
      { ...template, id: "created-first-met-latest", stage: "done", meetingAt: now - DAY, createdAt: now - 6 * DAY, feedbackFrom: [], feedbackSent: true },
      { ...template, id: "created-last-met-earlier", participants: ["a", "c"], status: [["a", "yes"], ["c", "yes"]], contacted: ["a", "c"], stage: "done", meetingAt: now - 4 * DAY, createdAt: now - 5 * DAY, feedbackFrom: [], feedbackSent: true },
    ];
    if (reverse) state.opps.reverse();
    for (const m of state.members) m.awaiting = undefined;
    w.net.importState(state);
    w.restart();
    const feedback = () => w.net.exportState().feedback.map(f => ({ opportunityId: f.opportunityId, about: f.about }));
    const latest = { opportunityId: "created-first-met-latest", about: "b" };
    const earlier = { opportunityId: "created-last-met-earlier", about: "c" };
    await w.say("a", "It was great, we really clicked. Would do it again.");
    expect(feedback()).toEqual([latest]);
    w.restart();
    await w.say("a", "It was great, we really clicked. Would do it again.");
    expect(feedback()).toEqual([latest, earlier]);
    w.restart();
    await w.say("a", "It was great, we really clicked. Would do it again.");
    expect(feedback()).toEqual([latest, earlier]);
  }
});
