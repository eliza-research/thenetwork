import { expect, test, vi } from "vitest";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { DAY, HOUR } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { holdEveryItem } from "../../../packages/engine/src/reviewJudge.ts";
import { PgStore } from "@thenetwork/network";
import { Mini } from "../../../packages/network/test/mini.ts";
import { eventOf } from "../src/events.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { OpportunityDetail } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const climber = (id: string, name: string) => ({
  id, name, age: 30, area: "Greenpoint",
  interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

test.skipIf(!pgAvailable)("a booking-conflict drop shows in the opportunity History with the member and reason", async () => {
  const url = await testDb(), sql = new SQL(url);
  let server: ObservatoryServer | undefined;
  try {
    const w = new Mini([
      climber("a", "Anton Example"),
      climber("b", "Bella Example"),
      climber("c", "Carlos Example"),
      climber("d", "Dana Example"),
      climber("x", "Xavier Example"),
    ], { inlineJudge: holdEveryItem.inline });
    await w.onboard("a", "b", "c", "d", "x");
    const now = w.clock.now();
    const plan: plans.Plan = {
      id: "plan_group_conflict_history", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
      window: { start: now + 5 * DAY, end: now + 5 * DAY + 2 * HOUR }, invited: ["a", "b", "c", "d"], alternates: [],
      partner: false, size: { min: 3, target: 4, max: 4 }, quorum: 4, probeDeadline: now + 4 * DAY, score: 0.6, u: {}, familiar: {},
      createdAt: now, category: "hobby",
    };
    (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
    await w.net.tick(now);
    const group = w.net.reviewQueue()[0]!.oppId;
    expect(w.net.review(group, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await w.runUntil(() => ["a", "b", "c", "d"].every(id => w.probed(id)), 2 * DAY)).toBe(true);
    for (const id of ["a", "b", "c"]) await w.say(id, "yes");
    const competing = w.propose(["c", "x"]);
    expect(await w.runUntil(() => w.net.reviewQueue().some(item => item.oppId === competing), DAY)).toBe(true);
    expect(w.net.review(competing, "approve", { reviewer: "sim_staff" })).toBe(true);
    await w.answerProbes(["c", "x"], () => "yes", 8 * HOUR);
    expect(w.meetings).toMatchObject([{ proposalId: competing, participants: ["c", "x"] }]);
    expect(Math.abs(w.meetings[0]!.at - plan.window.start)).toBeLessThan(4 * HOUR);
    await w.say("d", "no");
    expect(w.log("plan_conflict").map(l => l.detail)).toEqual([{ oppId: group, memberId: "c" }]);

    for (const m of w.members) {
      await sql`insert into network.members (id, name, home_city, age, account_status, joined_at)
        values (${m.id}, ${m.name}, 'nyc', ${m.age}, 'active', ${new Date(m.joinedAt!)})`;
    }
    const saved = new PgStore(sql);
    await saved.save(w.net.exportState());

    for (const l of w.logs) {
      const row = eventOf({ t: l.t, type: "network_log", kind: l.kind, detail: l.detail });
      if (!row) continue;
      await sql`insert into network.events (at, actor_type, actor_id, type, object_type, object_id, payload)
        values (${new Date(row.at)}, ${row.actor_type}, ${row.actor_id}, ${row.type}, ${row.object_type}, ${row.object_id}, ${row.payload}::jsonb)`;
    }

    vi.setSystemTime(new Date(w.clock.now()));
    const token = "plan-conflict-history-integration-synthetic-token";
    server = await createServer({
      port: 0, development: false, mode: "real", platformEnv: "dev", token,
      staffRolesUrl: false, peopleUrl: false, audit: { url }, real: { url, service: false, pollMs: HOUR, pushMs: HOUR },
    });
    const headers = { authorization: `Bearer ${token}` };

    const res = await fetch(`${server.url}/api/opportunity/${group}`, { headers });
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    const detail = (await res.json()) as OpportunityDetail;
    const rows = detail.events
      .filter(e => e.type === "plan_conflict")
      .map(e => ({ text: e.text, severity: e.severity ?? null, detail: e.detail ?? null }));

    expect(rows).toEqual([
      {
        text: "Carlos E. was left out at booking: already booked near the start or a calendar conflict; they hear only that the plan did not come together",
        severity: "warn",
        detail: null,
      },
    ]);
  } finally {
    await server?.stop();
    await sql.close();
    await dropTestDb();
    vi.useRealTimers();
  }
}, 300_000);
