// The persona block: regression gates for the simulated member's opt-out state (sim-channel-opt-out in
// docs/research/state-machines/sim.md). Each gate runs a short scripted world.
// The Network under test is silent (it sends nothing), so every inbound text is the persona's own. No model call.
import type { NetworkUnderTest } from "../../packages/core/src/index.ts";
import { runScenario, type Scenario, type ScenarioPersonaSpec } from "../../packages/sim/src/index.ts";
import { HELP_TEXT } from "../../packages/sim/src/channel.ts";
import { Block, expect } from "./gate.ts";

const silent = (): NetworkUnderTest => ({ name: "silent", init: () => {}, tick: () => {}, onInbound: () => {} });

const member = (ref: string, name: string): ScenarioPersonaSpec => ({
  ref, name, age: 29, city: "sf", homeArea: "Mission", interests: ["climbing", "coffee", "board_games"], desires: ["new_friends"],
  capacity: 0.95, responsiveness: { latencyMedianMin: 10, ignoreProb: 0 }, join: { day: 0, hour: 9 },
});

export async function personaBlock(b: Block): Promise<void> {
  // SD-401 (sim S-14): the opted-out guard let only the literal "START" reach the channel. UNSTOP, RESUME and
  // HELP, which the channel and production accept after STOP, were dropped before the channel.
  await b.run("persona: HELP and UNSTOP after STOP reach the channel", async () => {
    const s = {
      name: "keywords-after-stop", description: "Gwen texts STOP, then HELP, then UNSTOP.", seed: 81, days: 3,
      personas: [member("gwen", "Gwen Larsen")],
      actions: [
        { at: { day: 1, hour: 10 }, do: "opt_out", persona: "gwen" },
        { at: { day: 1, hour: 11 }, do: "say", persona: "gwen", text: "HELP" },
        { at: { day: 1, hour: 12 }, do: "say", persona: "gwen", text: "unstop" },
      ], expectations: [],
    } as Scenario;
    const r = await runScenario(s, { network: silent });
    const msgs = r.world.channel.messagesFor("gwen");
    const stop = msgs.find(m => m.direction === "inbound" && m.keyword === "STOP");
    expect(!!stop).toBe(true);
    const after = msgs.filter(m => m.ts > stop!.ts);
    expect(after.some(m => m.direction === "outbound" && m.system && m.body === HELP_TEXT)).toBe(true);
    expect(after.some(m => m.direction === "inbound" && m.keyword === "START")).toBe(true);
    expect(r.world.memories.get("gwen")!.optedOut).toBe(false);
  });
}
