// The existing STOP fixture through the full world and channel: a supported
// resume keyword must reach the Network; ordinary replies must leave it stopped.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadScenario, scenarioWorldOptions } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { runWorld } from "../src/world.ts";

test("the world resumes through channel keywords and honors a subsequent STOP", async () => {
  const fixture = await loadScenario(join(import.meta.dir, "../scenarios/stop-keyword.json"));
  const observed: unknown[] = [], expected: unknown[] = [];
  const cases = [["START", true], ["UNSTOP", true], ["SUBSCRIBE", true], ["RESUME", true], ["start.", true], ["ＳＴＡＲＴ", true], ["YES", false], ["restart", false], ["start later", false], [null, false]] as const;
  for (const seed of [1, 61, 83]) for (const [text, resumes] of cases) {
    const s = structuredClone(fixture);
    if (text !== null) s.actions.push({ do: "say", persona: "quitter", text, at: { day: 3, hour: 11 } });
    s.actions.push({ do: "say", persona: "quitter", text: "Thanks.", at: { day: 4, hour: 11 } });
    s.actions.push({ do: "opt_out", persona: "quitter", at: { day: 5, hour: 11 } });
    const wo = scenarioWorldOptions(s, { seed, writeLog: false, network: x => new StubNetwork({ seed, ...x.stub }) });
    const followupAt = wo.actions!.find(x => x.action.do === "say" && x.action.text === "Thanks.")!.at;
    const world = await runWorld(wo);
    const msgs = world.records.flatMap(r => r.type === "message" && r.msg.memberId === "quitter" ? [r.msg] : []);
    const stops = msgs.filter(x => x.direction === "inbound" && x.keyword === "STOP");
    const starts = msgs.filter(x => x.direction === "inbound" && x.keyword === "START");
    const followup = msgs.some(x => x.direction === "inbound" && x.body === "Thanks." && x.ts === followupAt);
    const afterStop = msgs.filter(x => x.direction === "outbound" && !x.system && x.status === "delivered" && x.ts > stops.at(-1)!.ts).length;
    observed.push({ seed, text, starts: starts.length, stops: stops.length, followup, stopped: world.memories.get("quitter")!.optedOut && world.channel.isOptedOut("quitter"), afterStop, stopViolations: world.metrics.invariants.byRule.send_after_stop ?? 0, errors: world.metrics.errors });
    expected.push({ seed, text, starts: resumes ? 1 : 0, stops: resumes ? 2 : 1, followup: resumes, stopped: true, afterStop: 0, stopViolations: 0, errors: 0 });
  }
  expect(observed).toEqual(expected);
}, 30_000);
