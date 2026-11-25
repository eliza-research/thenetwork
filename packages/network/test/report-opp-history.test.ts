// A report filed in the check-in after a date (docs/admin-console.md 3.5 SHOULD: full event
// history per opportunity) names its opportunity, so the opportunity's History shows it. The
// Network logs the report with the opportunity's id; the observatory reads that id from the
// event row (eventOf -> describe -> the opportunity detail) to place the row in the history.
import { describe, expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { describe as describeEvent, eventOf } from "../../../apps/observatory/src/events.ts";
import { copy } from "../src/copy.ts";
import { Mini } from "./mini.ts";

const person = (id: string, name: string) => ({
  id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

async function datedPair() {
  const w = new Mini([person("a", "Ana Diaz"), person("b", "Ben Ito"), person("c", "Cy Moss")], {
    review: "auto", plans: false, hooks: { postDateReports: true },
  });
  await w.onboard("a", "b", "c");
  const oppId = w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  const start = w.meetings.find(m => m.proposalId === oppId)!.at;
  w.clock.set(start + 2 * DAY);
  await w.run(2 * HOUR);
  return { w, oppId };
}

describe("a check-in report names its opportunity in the event log", () => {
  test("report_received carries the opportunity id, so the opportunity History shows it", async () => {
    const { w, oppId } = await datedPair();
    await w.say("a", "It was fine.");
    w.clock.advance(DAY);
    const from = w.mark();
    await w.say("a", "Actually he followed me home after");
    expect(w.to("a", from).map(s => s.body)).toContain(copy.reported(false));
    expect(w.net.safetyReports().filter(r => r.subjectId === "b" && r.source === "check_in")).toHaveLength(1);
    expect(w.net.safetyReports()[0]).toMatchObject({ opportunityId: oppId });

    const logged = w.log("report_received");
    expect(logged).toHaveLength(1);
    expect(logged[0]!.detail).toMatchObject({ kind: "unsafe", memberId: "a", target: "b", source: "check_in", met: true });
    expect(logged[0]!.detail.oppId).toBe(oppId);

    const row = eventOf({ t: logged[0]!.t, type: "network_log", kind: "report_received", detail: logged[0]!.detail });
    expect(row).toBeDefined();
    expect(row!.object_type).toBe("opportunity");
    expect(row!.object_id).toBe(oppId);
    expect(describeEvent(row!).opportunityId).toBe(oppId);
    expect(row!.object_type === "opportunity" ? row!.object_id === oppId : (row!.payload as any)?.oppId === oppId).toBe(true);
  });

  test("a report with no opportunity stays out of every opportunity History", async () => {
    const w = new Mini([person("a", "Ana Diaz"), person("b", "Ben Ito"), person("c", "Cy Moss")], { review: "auto", plans: false });
    await w.onboard("a", "b", "c");
    w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    expect(w.meetings.length).toBe(1);
    await w.say("a", "report Ben, he threatened me");
    const logged = w.log("report_received");
    expect(logged).toHaveLength(1);
    expect(logged[0]!.detail.oppId ?? null).toBeNull();
    const row = eventOf({ t: logged[0]!.t, type: "network_log", kind: "report_received", detail: logged[0]!.detail });
    expect(row!.object_type).toBe("member");
    expect(describeEvent(row!).opportunityId).toBeUndefined();
  });
});
