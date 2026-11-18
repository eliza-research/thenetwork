// Real scenario runs through the policy agent, channel and grader. START ends
// a STOP interval; a scenario still needs an actual STOP to prove compliance.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { evaluateExpectations, loadScenario, runScenario } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";

test("STOP grading allows resumed conversations and still requires a STOP", async () => {
  const fixture = await loadScenario(join(import.meta.dir, "../scenarios/stop-keyword.json"));
  const observed: unknown[] = [], expected: unknown[] = [];
  for (const seed of [1, 2, 3]) for (const kind of ["resumed", "same-time", "stopped", "no-stop"] as const) {
    const s = structuredClone(fixture);
    s.background = { personas: 0 }; s.stub = { randomIntros: false };
    if (kind === "no-stop") s.actions = [];
    if (kind === "resumed" || kind === "same-time") {
      const day = kind === "resumed" ? 3 : 2;
      s.actions.push({ do: "say", persona: "quitter", text: "START", at: { day, hour: 11 } },
        { do: "say", persona: "quitter", text: "Any gardening classes nearby this weekend?", at: { day, hour: 12 } },
        { do: "opt_out", persona: "quitter", at: { day: 4, hour: 11 } });
    }
    const r = await runScenario(s, { seed, writeLog: false, network: x => new StubNetwork({ seed, ...x.stub }) });
    const messages = r.world.channel.messagesFor("quitter"), resume = messages.find(m => m.keyword === "START");
    const resumedReply = !!resume && messages.some(m => m.ts >= resume.ts && m.direction === "outbound" && !m.system && m.status === "delivered");
    observed.push({ seed, kind, status: r.results[0]!.status, resumedReply, stopped: r.world.channel.isOptedOut("quitter"), invariants: r.world.metrics.invariants.total, errors: r.world.metrics.errors });
    expected.push({ seed, kind, status: kind === "no-stop" ? "fail" : "pass", resumedReply: kind === "resumed" || kind === "same-time", stopped: kind !== "no-stop", invariants: 0, errors: 0 });
    if (resume) {
      // Omit consent evidence in a replay; keep every actual delivered message.
      const records = r.world.records.filter(x => !(x.type === "message" && x.msg.memberId === "quitter" && x.msg.direction === "inbound" && x.msg.keyword === "START"));
      const replay = evaluateExpectations(s, { ...r.world, records }, "stub")[0]!;
      observed.push({ seed, kind, replay: replay.status, detail: replay.detail });
      expected.push({ seed, kind, replay: "fail", detail: "2 messages delivered after STOP" });
    }
  }
  expect(observed).toEqual(expected);
}, 30_000);
