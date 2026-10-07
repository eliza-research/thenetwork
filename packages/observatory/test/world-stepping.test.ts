// The simulator's new stepping API must not change behaviour: run() and begin + stepped
// advanceTo + complete produce the same records for the same seed.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/judge";
import { DEFAULT_START, generatePersonas, StubNetwork, World } from "@thenetwork/sim";
import { createEngine } from "../../sim/engines/engine-v1.ts";

const strip = (rs: RunRecord[]) => rs.map(r => (r.type === "run_end" ? { ...r, wallMs: 0 } : r));
function world(onRecord?: (r: RunRecord) => void) {
  return new World({
    seed: 7, personas: generatePersonas({ n: 40, seed: 7, joinSpreadDays: 2 }), days: 4, writeLog: false, runId: "stepping-test",
    network: new StubNetwork({ seed: 7, randomIntros: false }), engine: createEngine(), onRecord,
  });
}

describe("World stepping API", () => {
  test("run() equals begin + stepped advanceTo + complete", async () => {
    const a = await world().run();
    const streamed: RunRecord[] = [];
    const w = world(r => streamed.push(r));
    await w.begin();
    for (let t = DEFAULT_START; t < w.end; t += 7 * HOUR) await w.advanceTo(t);
    await w.advanceTo(w.end);
    const b = await w.complete();
    expect(a.records.length).toBeGreaterThan(200);
    expect(JSON.stringify(strip(b.records))).toBe(JSON.stringify(strip(a.records)));
    // onRecord streams every record, in order.
    expect(streamed.length).toBe(b.records.length);
    expect(streamed[streamed.length - 1]!.type).toBe("run_end");
  });

  test("advanceTo never passes the end and act() runs at the current time", async () => {
    const w = world();
    await w.begin();
    await w.advanceTo(DEFAULT_START + DAY);
    const before = w.records.length;
    w.act({ do: "say", persona: w.personaList()[0]!.id, text: "hello there network" });
    await w.advanceTo(w.clock.now());
    expect(w.records.slice(before).some(r => r.type === "scenario" && r.action === "say")).toBe(true);
    await w.advanceTo(w.end + 10 * DAY);
    expect(w.clock.now()).toBe(w.end);
    expect(w.snapshot().members.length).toBeGreaterThan(0);
  });
});
