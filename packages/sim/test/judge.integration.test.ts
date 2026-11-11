// The judge over a run log: rules that the NYC runs, the scenarios and game mode all read. A run that
// breaks a rule cannot come from the Network under test, which keeps it, so each log here is written by hand.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, type RunRecord } from "@thenetwork/core";
import { computeMetrics } from "../src/judge/metrics.ts";

const NOON = Date.UTC(2026, 9, 9, 16); // 12:00 in New York
const persona = (id: string): RunRecord => ({ t: 0, type: "persona", persona: { id, name: `Pat ${id}`, archetype: "regular", homeCity: "nyc", joinDay: 0, trueAge: 30, claimedAge: 30, quietHours: [22, 8], romanceOptIn: false, state: "open" } });
const out = (id: string, to: string, ts: number, meta: Record<string, unknown> = {}): RunRecord =>
  ({ t: ts, type: "message", msg: { id, ts, direction: "outbound", memberId: to, body: `Update ${id}. Reply PAUSE to pause.`, status: "delivered", meta: { proactive: true, ...meta } } });

describe("the judge", () => {
  test("person_cap: a fourth proactive message in 24 hours is a violation, a fourth over more days is not", () => {
    const within = computeMetrics([persona("a"), ...[0, 1, 2, 3].map(i => out(`m${i}`, "a", NOON + i * HOUR))], {});
    expect(within.invariants.byRule.person_cap).toBe(1);
    const spread = computeMetrics([persona("a"), ...[0, 1, 2, 3].map(i => out(`m${i}`, "a", NOON + i * 9 * HOUR))], {});
    expect(spread.invariants.byRule.person_cap ?? 0).toBe(0);
  });

  test("minor_reported: a member staff were told is a minor counts as a minor for the judge", () => {
    const contact = (id: string, ts: number): RunRecord => ({ t: ts, type: "proposal", source: "network", proposal: { id: "p1", participants: [id, "b"], type: "intro" } as never, oracle: {} as never });
    const reported: RunRecord = { t: NOON, type: "network_log", kind: "minor_reported", detail: { memberId: "a", by: "b" } };
    const m = computeMetrics([persona("a"), persona("b"), reported, contact("a", NOON + DAY)], {});
    expect(m.safety.minorContacts).toBeGreaterThan(0);
  });
});
