// Full worlds with the existing STOP persona, real policy initiatives and the
// channel: opting back in must not leave the member's routine permanently dead.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { DAY, HOUR } from "@thenetwork/core";
import { loadScenario, scenarioWorldOptions } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { DEFAULT_START, runWorld } from "../src/world.ts";

test("routine requests return after START while stopped members remain quiet", async () => {
  const fixture = await loadScenario(join(import.meta.dir, "../scenarios/stop-keyword.json"));
  const stopAt = DEFAULT_START + 20 * HOUR, resumeAt = DEFAULT_START + 7 * DAY + 11 * HOUR;
  const observed: unknown[] = [], expected: unknown[] = [];
  for (const seed of [1, 2, 3]) for (const kind of ["resumed", "stopped", "active"] as const) {
    const s = structuredClone(fixture);
    s.days = 45; s.background = { personas: 0 }; s.stub = { randomIntros: false };
    s.actions = kind === "active" ? [] : [{ do: "opt_out", persona: "quitter", at: { day: 0, hour: 20 } }];
    if (kind === "resumed") s.actions.push({ do: "say", persona: "quitter", text: "START", at: { day: 7, hour: 11 } });
    const world = await runWorld(scenarioWorldOptions(s, { seed, writeLog: false, network: x => new StubNetwork({ seed, ...x.stub }) }));
    const mem = world.memories.get("quitter")!;
    const inbound = world.records.flatMap(r => r.type === "message" && r.msg.direction === "inbound" && r.msg.memberId === "quitter" ? [r.msg] : []);
    const asks = (mem.signals ?? []).filter(x => x.source === "ask" && x.at > resumeAt);
    const requestsDelivered = asks.filter(x => inbound.some(m => m.ts === x.at)).length;
    const whileStopped = kind === "active" ? 0 : inbound.filter(m => m.ts > stopAt && (kind === "stopped" || m.ts < resumeAt)).length;
    observed.push({ seed, kind, requestsReturn: requestsDelivered > 0, whileStopped, stopped: mem.optedOut, errors: world.metrics.errors, invariants: world.metrics.invariants.total });
    expected.push({ seed, kind, requestsReturn: kind !== "stopped", whileStopped: 0, stopped: kind === "stopped", errors: 0, invariants: 0 });
  }
  expect(observed).toEqual(expected);
}, 30_000);
