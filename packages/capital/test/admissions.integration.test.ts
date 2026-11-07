import { expect, test } from "bun:test";
import { simulate } from "../experiments/world.ts";
import { measure } from "../experiments/run.ts";

test("capital reports bad invitees who joined before the run ended", () => {
  const reported: number[] = [], observed: number[] = [];
  let pendingBad = 0, joinedSybil = 0;
  for (const seed of [1, 2, 3, 4]) {
    const run = simulate({ seed, days: 90 });
    reported.push(measure(run).vouch.badAdmitted);
    // Count the generated population independently of the invitation decisions.
    observed.push(run.personas.filter(p => p.joinDay < run.days
      && (p.type === "invitee_bad" || p.type === "sybil")).length);
    const present = new Set(run.personas.map(p => p.id));
    pendingBad += run.invites.filter(i => i.quality === "bad" && i.joined && !present.has(i.invitee)).length;
    joinedSybil += run.personas.filter(p => p.type === "sybil").length;
  }
  expect(pendingBad).toBeGreaterThan(0);
  expect(joinedSybil).toBeGreaterThan(0);
  expect(reported).toEqual(observed);
}, 30_000);
