import { expect, test, vi } from "vitest";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { DAY, HOUR } from "@thenetwork/core";
import { PgStore } from "@thenetwork/network";
import { Mini } from "../../../packages/network/test/mini.ts";
import { eventOf } from "../src/events.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { OpportunityDetail } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const ids = ["a", "b", "c"];

test.skipIf(!pgAvailable)("plan confirmations show in the opportunity History with the member and how they confirmed", async () => {
  const url = await testDb(), sql = new SQL(url);
  let server: ObservatoryServer | undefined;
  try {
    const w = new Mini([
      { id: "a", name: "Anton Example", age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find climbing partners", category: "hobby" as const }] },
      { id: "b", name: "Bella Example", age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find climbing partners", category: "hobby" as const }] },
      { id: "c", name: "Carlos Example", age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find climbing partners", category: "hobby" as const }] },
    ], { plans: false });
    await w.onboard(...ids);
    const id = w.propose(ids);
    await w.answerProbes(ids);
    expect(w.meetings).toHaveLength(1);
    const opp = () => w.net.exportState().opps.find(o => o.id === id)!;
    expect(opp().stage).toBe("scheduled");
    expect(await w.runUntil(() => (opp().bookedTold ?? []).length === ids.length, 2 * DAY)).toBe(true);

    await w.say("a", "yes, see you there");
    await w.run(49 * HOUR);
    const confirmed = w.log("plan_confirmed").filter(l => l.detail.oppId === id);
    expect(Object.fromEntries(confirmed.map(l => [l.detail.memberId, l.detail.how]))).toEqual({ a: "said", b: "silence", c: "silence" });

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
    const token = "plan-confirmed-history-integration-synthetic-token";
    server = await createServer({
      port: 0, development: false, mode: "real", platformEnv: "dev", token,
      staffRolesUrl: false, peopleUrl: false, audit: { url }, real: { url, service: false, pollMs: HOUR, pushMs: HOUR },
    });
    const headers = { authorization: `Bearer ${token}` };

    const res = await fetch(`${server.url}/api/opportunity/${id}`, { headers });
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    const detail = (await res.json()) as OpportunityDetail;
    const rows = detail.events
      .filter(e => e.type === "plan_confirmed")
      .map(e => ({ text: e.text, severity: e.severity ?? null, detail: e.detail }))
      .sort((x, y) => x.text.localeCompare(y.text));

    expect(rows).toEqual([
      { text: "Anton E. confirmed the booked plan", severity: "good", detail: { how: "said" } },
      { text: "Bella E. confirmed the booked plan (silence: the 48-hour opt-out passed)", severity: "good", detail: { how: "silence" } },
      { text: "Carlos E. confirmed the booked plan (silence: the 48-hour opt-out passed)", severity: "good", detail: { how: "silence" } },
    ]);
  } finally {
    await server?.stop();
    await sql.close();
    await dropTestDb();
    vi.useRealTimers();
  }
}, 120_000);
