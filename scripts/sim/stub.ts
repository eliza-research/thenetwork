// The stub block: regression gates for the push baseline (StubNetwork, packages/sim/src/stubNetwork.ts; the
// sim-stub-member and sim-stub-opportunity machines in docs/research/state-machines/sim.md). Each gate runs a
// short scripted world on a pinned seed. No model call.
import { StubNetwork, runScenario, type Scenario, type ScenarioPersonaSpec } from "../../packages/sim/src/index.ts";
import { Block, expect } from "./gate.ts";

const adult = (ref: string, name: string, city: "sf" | "nyc", hour: number, ignoreProb = 0): ScenarioPersonaSpec => ({
  ref, name, age: 31, city, homeArea: city === "sf" ? "Noe Valley" : "Astoria", interests: ["hiking", "coffee", "board_games"], desires: ["new_friends"],
  capacity: 0.95, flakiness: 0, responsiveness: { latencyMedianMin: 10, ignoreProb }, join: { day: 0, hour, city },
});
const stub = (s: Scenario) => new StubNetwork({ seed: s.seed, ...s.stub });

export async function stubBlock(b: Block): Promise<void> {
  // SD-410 (sim S-18): tick replays a deferred invite while the opportunity is still inviting. It did not check
  // that the member was still invited, so a member who sent STOP during the deferral got the invite.
  await b.run("stub: a deferred group invite does not reach a member who sent STOP", async () => {
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
}
