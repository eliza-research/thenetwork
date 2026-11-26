import { expect, test, vi } from "vitest";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { DAY, HOUR, type InitialInviteReceipt } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { holdEveryItem } from "../../../packages/engine/src/reviewJudge.ts";
import { PgStore } from "@thenetwork/network";
import { probeReplyReceiptKey } from "../../../packages/network/src/network.ts";
import { Mini } from "../../../packages/network/test/mini.ts";
import { eventOf } from "../src/events.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { OpportunityDetail } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const climber = (id: string, name: string) => ({
  id, name, age: 30, area: "Greenpoint",
  interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a climbing partner", category: "hobby" as const }],
});

test.skipIf(!pgAvailable)("an undelivered plan invitation shows in the opportunity History with warn severity and reason", async () => {
  const url = await testDb(), sql = new SQL(url);
  let server: ObservatoryServer | undefined;
  try {
    const ids = ["a", "c", "d"];
    const w = new Mini([
      climber("a", "Anton Example"),
      climber("c", "Carlos Example"),
      climber("d", "Dana Example"),
    ], { inlineJudge: holdEveryItem.inline, plans: false });
    const receipts = new Map<string, InitialInviteReceipt>();
    let heldPlan: { id: string; at: number } | undefined;
    const context = w.ctx();
    w.net.init({
      ...context,
      initialInviteReceipt: id => receipts.get(id),
      send: (id, body, opts) => {
        const delivered = context.send(id, body, opts);
        if (id === "a" && opts?.meta?.type === "plan_probe") heldPlan = { id: delivered.id, at: delivered.ts };
        else if (opts?.meta?.proactive) receipts.set(delivered.id, { kind: "accepted", at: delivered.ts });
        return delivered;
      },
    });
    await w.onboard(...ids);
    const now = w.clock.now();
    const plan: plans.Plan = {
      id: "plan_probe_unavailable_history", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
      window: { start: now + 5 * DAY, end: now + 5 * DAY + HOUR }, invited: ["a", "c", "d"], alternates: [], partner: false,
      size: { min: 3, target: 3, max: 3 }, quorum: 3, probeDeadline: now + 8 * HOUR,
      score: 0.6, u: {}, familiar: {}, createdAt: now, category: "hobby",
    };
    const item = (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): { id: string } }).submitPlan(plan, now);
    await w.net.tick(now);
    expect(w.net.review(item.id, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await w.runUntil(() => heldPlan !== undefined, DAY)).toBe(true);
    receipts.set(heldPlan!.id, { kind: "not_sent" });
    receipts.set(probeReplyReceiptKey(item.id, "a", { at: heldPlan!.at, probeReceiptId: heldPlan!.id }), { kind: "not_sent" });
    await w.run(HOUR);
    expect(w.log("plan_probe_unavailable").map(l => l.detail)).toEqual([{ oppId: item.id, memberId: "a", reason: "not_delivered" }]);
    expect(w.log("probe_answer").filter(l => l.detail.memberId === "a")).toEqual([]);
    expect(w.net.memberList().find(m => m.id === "a")?.unanswered).toBe(0);

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
    const token = "plan-probe-unavailable-history-synthetic-token";
    server = await createServer({
      port: 0, development: false, mode: "real", platformEnv: "dev", token,
      staffRolesUrl: false, peopleUrl: false, audit: { url }, real: { url, service: false, pollMs: HOUR, pushMs: HOUR },
    });
    const res = await fetch(`${server.url}/api/opportunity/${item.id}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    const detail = (await res.json()) as OpportunityDetail;
    const rows = detail.events
      .filter(e => e.type === "plan_probe_unavailable")
      .map(e => ({ text: e.text, severity: e.severity ?? null, detail: e.detail ?? null }));

    expect(rows).toEqual([
      {
        text: "Anton E.: the plan invitation never went out (known not delivered); the seat was released, not a decline or an unanswered invitation",
        severity: "warn",
        detail: { reason: "not_delivered" },
      },
    ]);
  } finally {
    await server?.stop();
    await sql.close();
    await dropTestDb();
    vi.useRealTimers();
  }
}, 300_000);
