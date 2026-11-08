// The observatory projector on a real simulated run (observatory-opportunity in
// docs/research/state-machines/observatory.md): the sim World with the push stub, its run records
// projected into a Store. No model call, no Postgres.
import { expect, test } from "bun:test";
import { StubNetwork, runScenario, type Scenario, type ScenarioPersonaSpec } from "@thenetwork/sim";
import { Projector } from "../src/projector.ts";
import { Store, emptyCounters } from "../src/store.ts";

const member = (ref: string, name: string, latencyMedianMin: number): ScenarioPersonaSpec => ({
  ref, name, age: 31, city: "sf", homeArea: "Noe Valley", interests: ["board_games", "cooking", "hiking"], desires: ["new_friends"],
  capacity: 0.95, flakiness: 0, responsiveness: { latencyMedianMin, ignoreProb: 0 }, join: { day: 0, hour: 9 },
});

// SD-498 (observatory D19): a late yes to a booked group makes the World report the meeting again with every
// participant. The projector counted an accept again for each member who was already confirmed.
test("a late joiner does not count the other members' accepts again", async () => {
  const s = {
    name: "late-joiner", description: "Ana, Ben and Cy say yes at once; Dee says yes after the meeting is booked.", seed: 31, days: 4,
    stub: { randomIntros: false },
    personas: [member("ana", "Ana Lindqvist", 5), member("ben", "Ben Okafor", 5), member("cy", "Cy Moreno", 5), member("dee", "Dee Park", 600)],
    actions: [{ at: { day: 1, hour: 9 }, do: "propose", kind: "group", participants: ["ana", "ben", "cy", "dee"], objective: "board game night", city: "sf" }],
    expectations: [],
  } as Scenario;
  const r = await runScenario(s, { network: sc => new StubNetwork({ seed: sc.seed, ...sc.stub }) });
  const recs = r.world.records;
  const booked = recs.filter(x => x.type === "meeting_scheduled");
  // The run has the case: one meeting, reported twice, the second time with Dee added.
  expect(new Set(booked.map(x => x.type === "meeting_scheduled" && x.meetingId)).size).toBe(1);
  expect(booked.length).toBe(2);
  expect(booked[1]!.type === "meeting_scheduled" && booked[1]!.participants.includes("dee")).toBe(true);

  const start = recs[0]!.t;
  const store = new Store({ mode: "game", app: "ntwrk", label: "test", dataset: "test", capabilities: { canStep: false, canIntervene: false, hiddenTruth: false, readOnly: true } },
    { now: start, start, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  for (const x of recs) if (x.type === "persona")
    store.upsertMember({ id: x.persona.id, name: x.persona.name, city: x.persona.homeCity, state: "not_joined", joined: false, minor: false, age: x.persona.claimedAge, counters: emptyCounters() });
  const projector = new Projector(store);
  for (const rec of recs) projector.apply(rec);
  // Each of the four said yes to the one opportunity once.
  for (const id of ["ana", "ben", "cy", "dee"]) expect(store.member(id)!.counters.accepted).toBe(1);
  expect(store.counts.accepts).toBe(4);
}, 60_000);
