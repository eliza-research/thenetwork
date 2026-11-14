// Exercise text-only participant inference through the real world, channel and persona policy.
import { expect, test } from "bun:test";
import { DAY, HOUR, type NetworkContext } from "@thenetwork/core";
import { generatePersonas } from "../src/generator.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { DEFAULT_START, World } from "../src/world.ts";

class TextNetwork extends StubNetwork {
  channelContext!: NetworkContext;
  override init(ctx: NetworkContext) { super.init(ctx); this.channelContext = ctx; }
}

test("personas recognize unambiguous last initials without guessing ambiguous names", async () => {
  const observed: unknown[] = [], expected: unknown[] = [];
  const cases = [
    { label: "full", names: "Alex Brown", ids: ["m0002"] },
    { label: "initial", names: "Alex B.", ids: ["m0002"] },
    { label: "initial at end", names: "Alex B.", ids: ["m0002"], end: true },
    { label: "group", names: "Alex B. and Alex J.", ids: ["m0002", "m0003"] },
    { label: "unique first", names: "Jamie", ids: ["m0004"] },
    { label: "ambiguous first", names: "Alex", ids: [] },
    { label: "longer last name", names: "Alex Brownstone", ids: [] },
    { label: "ambiguous initial", names: "Alex B.", ids: [], ambiguous: true },
    { label: "full with ambiguous initial", names: "Alex Brown", ids: ["m0002"], ambiguous: true },
  ];
  for (const seed of [1, 2]) for (const c of cases) {
    const personas = generatePersonas({ n: c.ambiguous ? 5 : 4, seed, adversarialRate: 0, minorShare: 0, cityWeights: { sf: 1, nyc: 0 } });
    for (const [i, p] of personas.entries()) {
      p.name = ["Robin Cole", "Alex Brown", "Alex Jones", "Jamie Stone", "Alex Baker"][i]!;
      p.joinDay = 0; p.hidden.responsiveness = { latencyMedianMin: 1, latencySigma: 0, ignoreProb: 0 };
    }
    const network = new TextNetwork({ seed, randomIntros: false });
    const world = new World({ seed, personas, days: 2, network, writeLog: false,
      actions: personas.map(p => ({ at: DEFAULT_START + 9 * HOUR, action: { do: "join" as const, persona: p.id } })) });
    await world.begin(); await world.advanceTo(DEFAULT_START + DAY + 12 * HOUR);
    const body = c.end ? `For coffee, would you like to meet ${c.names}` : `Would you like to meet ${c.names} for coffee? Reply STOP to pause.`;
    const message = network.channelContext.send(personas[0]!.id, body, { meta: { proactive: true } });
    await world.advanceTo(world.end); const result = await world.complete();
    observed.push({ seed, label: c.label, joined: result.metrics.run.joined, others: result.memories.get(personas[0]!.id)!.proposals[`inferred:${message.id}`]?.others });
    expected.push({ seed, label: c.label, joined: personas.length, others: c.ids });
  }
  expect(observed).toEqual(expected);
}, 30_000);
