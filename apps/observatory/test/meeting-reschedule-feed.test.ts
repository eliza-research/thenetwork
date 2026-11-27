import { expect, test } from "vitest";
import { DAY, HOUR, type RunRecord } from "@thenetwork/core";
import { describeBookingStart, localBookingStart } from "../../../packages/network/src/rescheduling.ts";
import { Mini } from "../../../packages/network/test/mini.ts";
import { eventOf } from "../src/events.ts";
import { Projector } from "../src/projector.ts";
import { RealSource } from "../src/sources/real.ts";
import { emptyCounters, Store } from "../src/store.ts";

test("activity feeds distinguish the initial booking from its unanimously approved reschedule", async () => {
  const fixtures = [["a", "Anton Q"], ["b", "Bella Q"], ["c", "Carlos Q"]] as const;
  const ids = fixtures.map(([id]) => id);
  const world = new Mini(fixtures.map(([id, name]) => ({
    id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find climbing partners", category: "hobby" }],
  })), { plans: false });
  await world.onboard(...ids);
  const id = world.propose(ids);
  await world.answerProbes(ids);
  expect(world.meetings).toHaveLength(1);
  const bookedAt = world.clock.now();
  const originalAt = world.meetings[0]!.at;
  const proposedAt = originalAt + DAY;
  const booking = () => world.net.exportState().opps.find(item => item.id === id)!;
  expect(await world.runUntil(() => booking().bookedTold?.length === ids.length, 2 * DAY)).toBe(true);

  await world.say(ids[0]!, `RESCHEDULE ${localBookingStart(originalAt)} TO ${localBookingStart(proposedAt)}`);
  await world.run(HOUR);
  for (const member of ids) {
    const prompt = world.to(member).reverse().find(message => message.body.includes("Reply RESCHEDULE YES"));
    const vote = /RESCHEDULE YES [a-p]{16}/.exec(prompt?.body ?? "")?.[0];
    expect(vote).toBeDefined();
    await world.say(member, vote!);
  }
  expect(world.meetings).toHaveLength(2);
  expect(world.meetings[1]).toMatchObject({ at: proposedAt, previousAt: originalAt });
  const now = world.clock.now();
  const records = world.meetings.map((meeting, index): RunRecord => ({
    t: index === 0 ? bookedAt : now, type: "meeting_scheduled", meetingId: id, ...meeting,
  }));
  const game = new Store({
    mode: "game", app: "ntwrk", label: "SIMULATION", dataset: "synthetic",
    capabilities: { canStep: false, canIntervene: false, hiddenTruth: false, readOnly: false },
  }, { now, start: bookedAt, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  // Ingest service event rows without starting a real adapter connection.
  const real = new RealSource({ service: false });
  for (const person of world.members) {
    const member = {
      id: person.id, name: person.name, city: "nyc" as const, area: "Greenpoint",
      state: "normal" as const, joined: true, minor: false, age: person.age, counters: emptyCounters(),
    };
    game.upsertMember(member);
    real.store.upsertMember({ ...member, counters: emptyCounters() });
  }
  const projector = new Projector(game);
  for (const log of world.logs.filter(entry => ["review_queued", "review_decided", "probe_started"].includes(entry.kind))) {
    projector.apply({ type: "network_log", ...log });
  }
  for (const record of records) projector.apply(record);
  real["loadFeed"]([...records].reverse().map((record, i) => ({ ...eventOf(record), id: i })));
  const moved = `Meeting rescheduled: ${describeBookingStart(originalAt)} → ${describeBookingStart(proposedAt)} (New York time)`;
  for (const feed of [game.feed, real.store.feed]) {
    const entries = feed.filter(item => item.kind === "meeting");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ text: expect.stringMatching(/^Meeting set:/), opportunityId: id, members: ids });
    expect(entries[1]).toMatchObject({ text: expect.stringContaining(moved), opportunityId: id, members: ids });
    expect(entries[1]!.text).toContain("Anton");
  }
});
