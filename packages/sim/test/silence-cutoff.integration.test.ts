// The existing silence scenario through the full world, channel, policy agents,
// and final-state grader. Replies before the scripted cutoff are legitimate.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadScenario, runScenario } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";

test("silence grading uses the executed cutoff and retains real late-message failures", async () => {
  const fixture = await loadScenario(join(import.meta.dir, "../scenarios/member-goes-silent.json"));
  const observed: unknown[] = [], expected: unknown[] = [];
  for (const seed of [21, 27, 29]) for (const kind of ["original", "after", "same-before", "same-after", "day-only"] as const) {
    const s = structuredClone(fixture);
    if (kind === "after") s.actions.push({ do: "say", persona: "ghost", text: "Thanks.", at: { day: 1, hour: 13 } });
    const sameTime = { do: "say" as const, persona: "ghost", text: "Thanks.", at: { day: 1, hour: 12 } };
    if (kind === "same-before") s.actions.unshift(sameTime);
    if (kind === "same-after") s.actions.push(sameTime);
    if (kind === "day-only") s.actions = [];
    const r = await runScenario(s, { seed, writeLog: false, network: x => new StubNetwork({ seed, ...x.stub }) });
    const silence = r.world.records.findIndex(x => x.type === "scenario" && x.action === "go_silent" && x.detail?.persona === "ghost");
    const late = silence < 0 ? null : r.world.records.slice(silence + 1).filter(x => x.type === "message" && x.msg.direction === "inbound" && x.msg.memberId === "ghost").length;
    observed.push({ seed, kind, status: r.results.find(x => x.expectation.check === "silent_after")!.status, late, errors: r.world.metrics.errors });
    const fails = kind === "after" || kind === "same-after" || kind === "day-only";
    expected.push({ seed, kind, status: fails ? "fail" : "pass", late: kind === "day-only" ? null : fails ? 1 : 0, errors: 0 });
  }
  expect(observed).toEqual(expected);
}, 30_000);
