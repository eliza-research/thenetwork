import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { evaluateExpectations, loadScenario, scenarioWorldOptions } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { runWorld } from "../src/world.ts";

test("a drop notification passes only when every remaining member receives it", async () => {
  const template = await loadScenario(resolve(import.meta.dir, "../scenarios/group-flake-morning-of.json"));
  const actual = [], expected = [];
  for (const seed of [2, 7, 29]) for (const noShow of [false, true]) for (const failureRate of [0, 0.1]) {
    const scenario = structuredClone(template);
    if (noShow) scenario.actions.unshift({ at: { day: 0, hour: 20 }, do: "force_flake", persona: "dinner-5", how: "no_show" });
    const world = await runWorld({ ...scenarioWorldOptions(scenario, {
      seed, network: () => new StubNetwork({ randomIntros: false }), writeLog: false,
    }), failureRate });
    const booking = world.records.filter(r => r.type === "meeting_scheduled").at(-1)!;
    const outcome = world.records.find(r => r.type === "outcome")!;
    const recipients = booking.participants.filter(id => id !== "dinner-4" && !outcome.attendance[id]?.cancelledWithNotice);
    const notices = world.records.filter(r => r.type === "message").map(r => r.msg).filter(m => m.direction === "outbound"
      && m.meta?.type === "cancellation" && m.meta.proposalId === booking.proposalId);
    const missing = recipients.filter(id => !notices.some(m => m.memberId === id && m.status === "delivered"));
    const grade = evaluateExpectations(scenario, world, "stub").find(r => r.expectation.check === "others_notified_of_drop")!;
    actual.push({ seed, noShow, failureRate, drop: outcome.attendance["dinner-4"]!.cancelledWithNotice,
      held: world.metrics.meetings.held, missing: missing.length,
      missingAttendees: missing.filter(id => outcome.attendance[id]?.showed).length, status: grade.status,
      detail: grade.detail });
    expected.push({ seed, noShow, failureRate, drop: true, held: 1,
      missing: failureRate ? 1 : 0, missingAttendees: failureRate ? 1 : 0,
      status: failureRate ? "fail" as const : "pass" as const,
      detail: `${recipients.length - (failureRate ? 1 : 0)}/${recipients.length} notified` });
  }
  expect(actual).toEqual(expected);
});
