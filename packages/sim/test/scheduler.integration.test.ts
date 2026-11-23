import { expect, test } from "vitest";
import { generatePersonas } from "../src/generator.ts";
import type { RunMode } from "../src/scheduler.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { DEFAULT_START, World } from "../src/world.ts";

test.each(["accelerated", "realtime"] as const)("a join added while pacing in %s mode runs before the pending tick", async mode => {
  const tickAt = DEFAULT_START + 5 * 60_000;
  const speed = mode === "accelerated" ? 20 : 1;
  const joinAt = tickAt - speed * 25;
  const make = (runMode: RunMode) => {
    const [person] = generatePersonas({ n: 1, seed: 1, minorShare: 0, adversarialRate: 0 });
    person!.joinDay = 2; // The action, rather than the initial schedule, joins this persona.
    return { person: person!, world: new World({
      seed: 1, personas: [person!], days: 1, mode: runMode, speed,
      network: new StubNetwork({ seed: 1, randomIntros: false }), writeLog: false,
    }) };
  };
  const control = make("discrete"), paced = make(mode);
  for (const { world } of [control, paced]) {
    await world.begin();
    await world.advanceTo(joinAt);
  }
  control.world.act({ do: "join", persona: control.person.id });
  await control.world.advanceTo(tickAt);

  // advanceTo reaches the actual timer before yielding, so the new action enters while the tick waits.
  const advancing = paced.world.advanceTo(tickAt);
  paced.world.act({ do: "join", persona: paced.person.id });
  await advancing;

  expect(paced.world.records.filter(r => r.type === "join")).toEqual([
    { type: "join", memberId: paced.person.id, t: joinAt },
  ]);
  expect(paced.world.snapshot().members.map(m => m.id)).toEqual([paced.person.id]);
  expect(paced.world.channel.all()).toEqual(control.world.channel.all());
  expect(paced.world.scheduler.processed).toBe(control.world.scheduler.processed);
  expect(paced.world.clock.now()).toBe(tickAt);
  expect(paced.world.records.filter(r => r.type === "network_error")).toEqual([]);
});
