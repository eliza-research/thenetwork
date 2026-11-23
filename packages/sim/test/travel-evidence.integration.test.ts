import { expect, test } from "vitest";
import { DAY, type RunRecord } from "@thenetwork/core";
import { pickTimes } from "../src/agent/availability.ts";
import { generatePersonas } from "../src/generator.ts";
import { scenarioWorldOptions } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { World } from "../src/world.ts";

test("oracle travel: members must share a city at the same time inside the proposal window", async () => {
    for (const overlap of [false, true]) {
      const opts = scenarioWorldOptions({
        name: "joint-presence", description: "A good pair still needs a common time in the city.", seed: 83, days: 4,
        personas: ["a", "b"].map(ref => ({ ref, age: 30, city: "nyc" as const, interests: ["film", "books", "coffee"], desires: ["new_friends"], capacity: 1, socialEnergy: 1, join: { day: 0, hour: 9 } })),
        actions: [{ at: { day: 0, hour: 13 }, do: "propose", kind: "intro", participants: ["a", "b"], objective: "coffee", city: "nyc" }], expectations: [],
      }, { network: () => new StubNetwork({ seed: 83, randomIntros: false }) });
      for (const p of opts.personas) { p.hidden.boundaries = []; p.hidden.openness = 1; p.relationships = []; p.secondaryCity = undefined; }
      opts.personas[0]!.hidden.trips = [{ city: "sf", fromDay: 2, toDay: 3 }];
      opts.personas[1]!.hidden.trips = [{ city: "sf", fromDay: 0, toDay: overlap ? 0 : 1 }];
      const action = opts.actions!.find(a => a.action.do === "propose")!.action;
      if (action.do === "propose") action.proposal.window = { start: opts.start!, end: opts.start! + 4 * DAY - 1 };
      const r = await new World(opts).run();
      const proposal = r.records.find((x): x is Extract<RunRecord, { type: "proposal" }> => x.type === "proposal" && x.source === "scenario")!;
      expect(proposal.oracle.quality).toBeGreaterThan(0.9);
      expect(proposal.oracle.compatible).toBe(overlap);
      expect(proposal.oracle.flags.includes("city_mismatch")).toBe(!overlap);
    }
  });

  test("traveler recall: count compatible pairs in their actual shared city once", async () => {
    for (const arm of ["visitor", "returned", "both-away", "two-cities"] as const) {
      const opts = scenarioWorldOptions({
        name: `traveler-recall-${arm}`, description: "Recall follows actual presence rather than home city.", seed: 83, days: 2,
        personas: ["a", "b"].map(ref => ({ ref, age: 30, city: "nyc" as const, interests: ["film", "books", "coffee"], desires: ["new_friends"], capacity: 1, socialEnergy: 1, join: { day: 0, hour: 9 } })),
        actions: [], expectations: [],
      }, { network: () => new StubNetwork({ seed: 83, randomIntros: false }) });
      for (const p of opts.personas) { p.hidden.boundaries = []; p.hidden.openness = 1; p.relationships = []; p.secondaryCity = undefined; p.hidden.trips = []; }
      const [a, peer] = opts.personas;
      if (arm === "visitor" || arm === "returned") {
        peer!.homeCity = "sf";
        peer!.hidden.trips = [{ city: "nyc", fromDay: 0, toDay: arm === "visitor" ? 3 : 0 }];
      } else if (arm === "both-away") {
        for (const p of opts.personas) p.hidden.trips = [{ city: "sf", fromDay: 0, toDay: 3 }];
      } else {
        for (const p of opts.personas) p.secondaryCity = "sf";
      }
      const w = new World(opts), r = await w.run();
      const latent = r.records.find((x): x is Extract<RunRecord, { type: "latent_opportunities" }> => x.type === "latent_opportunities")!;
      const city = arm === "both-away" ? "sf" : "nyc";
      const verdict = w.oracle.evaluate({ id: `latent:${a!.id}:${peer!.id}`, kind: "intro", participants: [a!.id, peer!.id], city, window: { start: latent.t, end: latent.t } });
      expect(verdict.quality).toBeGreaterThan(0.9);
      expect(verdict.compatible).toBe(arm !== "returned");
      expect(latent.pairs.length).toBe(arm === "returned" ? 0 : 1);
      if (latent.pairs.length) expect(latent.pairs[0]!.quality).toBe(verdict.quality);
    }
  });

test("traveler availability: offered times use the meeting city's local date and hour", async () => {
    const p = generatePersonas({ n: 1, seed: 83, minorShare: 0, adversarialRate: 0 })[0]!;
    p.id = "traveler"; p.homeCity = "sf"; p.secondaryCity = undefined;
    p.routine = { ...p.routine, wake: 8, sleep: 23, busyBlocks: [[9, 17]], freeEvenings: [1, 2, 3, 4, 5] };
    p.hidden.trips = [{ city: "nyc", fromDay: 0, toDay: 6 }];
    const w = new World({ app: "ntwrk", seed: 83, personas: [p], days: 1, network: new StubNetwork({ seed: 83, randomIntros: false }), writeLog: false });
    await w.run();
    const options = [{ key: "evening", start: Date.UTC(2026, 9, 5, 23) }, { key: "sleeping", start: Date.UTC(2026, 9, 6, 7) }];
    expect(pickTimes(p, options, "nyc", 83, w.oracle)).toEqual(["evening"]);
    const resident = structuredClone(p); resident.hidden.trips = [];
    expect(pickTimes(resident, options, "sf", 83, w.oracle)).toEqual([]);
  });
