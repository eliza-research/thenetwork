// Complete scripted worlds through the built-in StubNetwork and policy personas.
// A generated home city must put joining and later scripted actions on the same clock.
import { expect, test } from "bun:test";
import { runScenario, type Scenario } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";

test("scenario joins use the generated home city unless the script overrides it", async () => {
  const observed: unknown[] = [], expected: unknown[] = [];
  for (const seed of [1, 2]) for (const variant of ["generated", "sf", "nyc", "override-sf", "override-nyc", "default-hour"] as const) {
    const city = variant === "sf" || variant === "nyc" ? variant : undefined;
    const clockCity = variant === "override-sf" ? "sf" : variant === "override-nyc" ? "nyc" : undefined;
    const day = seed - 1;
    const s: Scenario = {
      name: `join-clock-${variant}`, description: "Join before the next local-time message", seed, days: 3,
      personas: [{ ref: "member", age: 30, city, join: { day, hour: variant === "default-hour" ? undefined : 9, minute: 30, city: clockCity } }],
      actions: [{ at: { day, hour: 10, city: clockCity }, do: "say", persona: "member", text: "Hello from the scripted morning." }],
      expectations: [],
    };
    const { world } = await runScenario(s, { network: () => new StubNetwork({ seed, randomIntros: false }), writeLog: false });
    const home = world.personas[0]!.homeCity;
    const joins = world.records.filter(r => r.type === "join");
    const join = joins[0]!;
    const say = world.records.find(r => r.type === "scenario" && r.action === "say")!;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: (clockCity ?? home) === "sf" ? "America/Los_Angeles" : "America/New_York",
      day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23",
    }).formatToParts(new Date(join.t)).map(p => [p.type, p.value]));
    observed.push({ seed, variant, joins: joins.length, day: +parts.day!, hour: +parts.hour!, minute: +parts.minute!, beforeSay: join.t < say.t, errors: world.metrics.errors });
    expected.push({ seed, variant, joins: 1, day: 5 + day, hour: 9, minute: 30, beforeSay: true, errors: 0 });
  }
  expect(observed).toEqual(expected);
}, 30_000);
