import { expect, test } from "vitest";
import { StubNetwork, runScenario, type Scenario, type ScenarioPersonaSpec } from "../src/index.ts";

const adult = (ref: string, name: string, city: "sf" | "nyc", hour: number, ignoreProb = 0): ScenarioPersonaSpec => ({
  ref, name, age: 31, city, homeArea: city === "sf" ? "Noe Valley" : "Astoria", interests: ["hiking", "coffee", "board_games"], desires: ["new_friends"],
  capacity: 0.95, flakiness: 0, responsiveness: { latencyMedianMin: 10, ignoreProb }, join: { day: 0, hour, city },
});
const stub = (s: Scenario) => new StubNetwork({ seed: s.seed, ...s.stub });

test("SD-410: a deferred group invite does not reach a member who sent STOP", async () => {
  const s = {
    name: "stub-deferred-stop", description: "A NYC group invite comes due at 7am for Sam in SF; Sam texts STOP at 8am.", seed: 91, days: 3,
    stub: { randomIntros: false },
    personas: [adult("ana", "Ana Lindqvist", "nyc", 9), adult("ben", "Ben Okafor", "nyc", 9), adult("cy", "Cy Moreno", "nyc", 9), adult("sam", "Sam Reyes", "sf", 9)],
    actions: [
      { at: { day: 1, hour: 8, city: "nyc" }, do: "propose", kind: "group", participants: ["ana", "ben", "cy", "sam"], objective: "board game night", city: "nyc" },
      { at: { day: 1, hour: 8, city: "sf" }, do: "opt_out", persona: "sam" },
    ], expectations: [],
  } as Scenario;
  const r = await runScenario(s, { network: stub });
  const toSam = r.world.records.filter(x => x.type === "message" && x.msg.memberId === "sam" && x.msg.direction === "outbound" && x.msg.meta?.type === "proposal");
  expect(r.world.records.some(x => x.type === "message" && x.msg.direction === "outbound" && x.msg.meta?.type === "proposal" && x.msg.memberId === "ana")).toBe(true);
  expect(toSam.length).toBe(0);
  expect(r.world.metrics.invariants.byRule.send_after_stop ?? 0).toBe(0);
});

test("SD-411: STOP after a booked meeting stops the reminder and tells the other member", async () => {
  const s = {
    name: "stub-stop-after-schedule", description: "Ana and Ben say yes and the stub books the meeting; Ana texts STOP the next day.", seed: 61, days: 7,
    stub: { randomIntros: false },
    personas: [adult("ana", "Ana Lindqvist", "sf", 9), adult("ben", "Ben Okafor", "sf", 10)],
    actions: [
      { at: { day: 1, hour: 11 }, do: "propose", kind: "intro", participants: ["ana", "ben"], objective: "coffee and a hike", city: "sf", explanation: "you both hike" },
      { at: { day: 3, hour: 12 }, do: "opt_out", persona: "ana" },
    ], expectations: [],
  } as Scenario;
  const r = await runScenario(s, { network: stub });
  const out = (id: string, type: string) => r.world.records.filter(x => x.type === "message" && x.msg.memberId === id && x.msg.direction === "outbound" && x.msg.meta?.type === type);
  expect(r.world.metrics.meetings.scheduled).toBe(1);
  expect(out("ana", "reminder").length + out("ana", "feedback_request").length).toBe(0);
  expect(r.world.metrics.invariants.byRule.send_after_stop ?? 0).toBe(0);
  expect(out("ben", "cancellation").length).toBe(1);
});

test("SD-408: a member who did not answer a group invite or a feedback request is proposed again", async () => {
  const run = async (name: string, actions: Scenario["actions"], participants: string[]) => {
    const s = {
      name, description: "Dee goes silent; Eve joins later and the stub pairs at random.", seed: 61, days: 14, stub: { introRate: 1 },
      personas: [...["ana:Ana Lindqvist", "ben:Ben Okafor", "cy:Cy Moreno", "dee:Dee Park"].map(x => adult(x.split(":")[0]!, x.split(":")[1]!, "sf", 11)),
        { ...adult("eve", "Eve Brandt", "sf", 11), join: { day: 2, hour: 11 } }],
      actions: [{ at: { day: 1, hour: 9 }, do: "propose", kind: participants.length > 2 ? "group" : "intro", participants, objective: "board game night", city: "sf" }, ...actions],
      expectations: [],
    } as Scenario;
    const r = await runScenario(s, { network: stub });
    return r.world.records.filter(x => x.type === "proposal" && x.source === "network" && x.proposal.participants.includes("dee")).length;
  };
  expect(await run("stub-awaiting-group", [{ at: { day: 1, hour: 8 }, do: "go_silent", persona: "dee" }], ["ana", "ben", "cy", "dee"])).toBeGreaterThan(0);
  expect(await run("stub-awaiting-feedback", [{ at: { day: 3, hour: 21 }, do: "go_silent", persona: "dee" }], ["ana", "dee"])).toBeGreaterThan(0);
});
