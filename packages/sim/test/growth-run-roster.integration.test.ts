import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { fileAt } from "../../core/src/runtime/files.ts";
import { friendFactory } from "../../network/harness/growth.ts";
import { ConsentNetwork } from "../../network/src/network.ts";
import { simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";
import { scenarioWorldOptions } from "../src/scenario.ts";
import { World } from "../src/world.ts";

test.each([true, false])("a growth run with writeLog=%s returns the invited persona", async writeLog => {
  const runsDir = await mkdtemp(join(tmpdir(), "network-growth-roster-"));
  const seed = 83;
  try {
    const opts = scenarioWorldOptions({
      name: "growth-roster", description: "One member invites a friend during the run.", seed, days: 3,
      personas: [{ ref: "host", age: 30, city: "nyc", archetype: "connector", join: { day: 0, hour: 9 } }],
      actions: [{ at: { day: 1, hour: 11 }, do: "say", persona: "host",
        text: "my friend Maya would love this, can you invite them?" }],
      expectations: [],
    }, { network: () => new ConsentNetwork({ seed, inlineJudge: simulatedReviewJudge({ exceptions: false }), matchingEnabled: false, plans: false }) });
    const initial = opts.personas;
    const world = new World({ ...opts, writeLog, runsDir, spawnFriend: friendFactory({
      seed, joinRate: 1, badActorRate: 0, joinDays: [0, 0],
    }) });
    const result = await world.run();
    const joined = result.records.flatMap(record => record.type === "join" ? [record.memberId] : []);
    const expected = ["host", "nyc-g1-0001"];
    expect(joined).toEqual(expected);
    expect(result.records.flatMap(record => record.type === "persona" ? [record.persona.id] : [])).toEqual(expected);
    expect(initial.map(persona => persona.id)).toEqual(["host"]);
    expect(result.metrics.run.joined).toBe(2);
    expect(result.records[0]).toMatchObject({ type: "run_start", config: { personas: 1 } });
    const returned = result.personas.map(persona => persona.id);
    if (writeLog) {
      const dir = result.dir!;
      expect((await readdir(dir)).sort()).toEqual(["events.jsonl", "metrics.json", "personas.json"]);
      const saved = await fileAt(join(dir, "personas.json")).json();
      expect({ returned, saved: saved.map((persona: { id: string }) => persona.id) }).toEqual({ returned: expected, saved: expected });
      expect(saved).toEqual(JSON.parse(JSON.stringify(result.personas)));
      expect(await fileAt(join(dir, "events.jsonl")).text()).toBe(result.records.map(record => JSON.stringify(record)).join("\n") + "\n");
      expect(await fileAt(join(dir, "metrics.json")).json()).toEqual(result.metrics);
    } else {
      expect(result.dir).toBeUndefined();
      expect(await readdir(runsDir)).toEqual([]);
      expect(returned).toEqual(expected);
    }
  } finally {
    await rm(runsDir, { recursive: true, force: true });
  }
});
