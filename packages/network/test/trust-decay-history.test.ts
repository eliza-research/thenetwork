// Trust decay is part of the trust history (upstream PR #472; PRD 32.14 safety cases). Before the fix,
// clean time lowered the score with no event: a member at score 2 still had only a +3 event, and the
// open staff case missed the drop. Now each drop is a negative "decay" event on the real ConsentNetwork
// (inbound abuse, daily ticks, a staff case close, a restart from exported state). Decay alone never
// opens a case or adds to a closed one, and a hold never decays.
// The production path (Postgres, staff API, store restarts) is trust-decay-history.integration.test.ts.
// spec/trustLevel.md, "Clean time lowers the score through a recorded decay event"; spec/safetyCase.md, "An event opens a case or adds to its current record"
import { describe, expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { Mini, START } from "./mini.ts";

const adult = (id: string, name: string) => ({ id, name, age: 34, area: "Greenpoint", interests: ["climbing"], wants: [{ objective: "find a climbing partner", category: "hobby" as const }] });
const SPAM = "Buy my course at https://example.test/offer";

describe("trust decay history", () => {
  test("each score drop is a recorded decay event; closed cases stay closed; holds keep their score", async () => {
    const w = new Mini([adult("a", "Ari Lee"), adult("b", "Bea Ng"), adult("c", "Cy Moss"), adult("d", "Dee Park")]);
    await w.onboard("a", "b", "c", "d");
    for (const id of ["a", "b", "c"]) await w.say(id, SPAM);
    await w.say("c", SPAM);
    const trust = (id: string) => w.net.exportState().trust.find(t => t.id === id);
    const cases = (id: string) => w.net.exportState().cases.filter(c => c.memberId === id);
    const points = (id: string) => trust(id)?.events.map(e => e.points);
    expect(["a", "b", "c", "d"].map(id => trust(id)?.score ?? 0)).toEqual([3, 3, 6, 0]);
    const held = structuredClone(trust("c")!);

    // Staff close b's case before any decay.
    const closed = cases("b")[0]!;
    expect(w.net.closeCase(closed.id, "staff", "review complete")).toEqual({ ok: true });
    const closedEvents = structuredClone(closed.events);

    await w.run(START + 13 * DAY - w.clock.now());
    expect(points("a")).toEqual([3]);

    w.restart();
    await w.run(START + 16 * DAY - w.clock.now());
    expect(trust("a")!.score).toBe(2);
    expect(trust("a")!.events.map(e => [e.kind, e.points])).toEqual([["sales_spam", 3], ["decay", -1]]);
    expect(cases("a")[0]!.events.map(e => e.points)).toEqual([3, -1]);

    w.restart();
    await w.run(START + 60 * DAY - w.clock.now());
    for (const id of ["a", "b"]) {
      expect([trust(id)!.score, trust(id)!.level]).toEqual([0, "ok"]);
      expect(points(id)).toEqual([3, -1, -1, -1]);
      expect(points(id)!.reduce((sum, p) => sum + p, 0)).toBe(trust(id)!.score);
    }
    expect(cases("a")[0]!.events.map(e => e.points)).toEqual([3, -1, -1, -1]);
    // Decay never reopens or adds to a closed case, and never opens a new one.
    expect(cases("b")).toHaveLength(1);
    expect(cases("b")[0]).toMatchObject({ id: closed.id, status: "closed", events: closedEvents });
    expect(cases("d")).toEqual([]);
    // A hold is lifted by a person, never by time.
    expect(trust("c")).toMatchObject({ score: 6, level: "hold", events: held.events });

    // At zero there is nothing left to decay: no further event.
    const settled = structuredClone(trust("a")!.events);
    await w.run(START + 90 * DAY - w.clock.now());
    expect(trust("a")!.events).toEqual(settled);
  }, 120_000);
});
