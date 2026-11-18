// A mutually accepted booking still belongs in completion statistics after cancellation.
import { expect, test, setSystemTime } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR } from "@thenetwork/core";
import { PgStore } from "@thenetwork/network";
import { Mini } from "../../network/test/mini.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { ObsState } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("cancelled bookings enter completion statistics when their meeting time arrives", async () => {
  const url = await testDb(), sql = new SQL(url);
  let server: ObservatoryServer | undefined;
  try {
    const w = new Mini([{ id: "a", name: "Alex Example", age: 30, interests: ["climbing"] }, { id: "b", name: "Blair Example", age: 32, interests: ["climbing"] }]);
    await w.onboard("a", "b");
    const id = w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    expect(w.meetings.length).toBe(1);
    const at = w.net.exportState().opps.find(o => o.id === id)!.meetingAt!;
    for (const m of w.members) await sql`insert into network.members (id, name, home_city, age, account_status, joined_at)
      values (${m.id}, ${m.name}, 'nyc', ${m.age}, 'active', ${new Date(m.joinedAt!)})`;
    const saved = new PgStore(sql);
    await saved.save(w.net.exportState());
    setSystemTime(new Date(at - HOUR));
    const token = "cancelled-completion-integration-synthetic-token";
    server = await createServer({ port: 0, development: false, mode: "real", platformEnv: "dev", token,
      staffRolesUrl: false, peopleUrl: false, audit: { url }, real: { url, service: false, pollMs: HOUR, pushMs: HOUR } });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const observations: unknown[] = [], expected: unknown[] = [];
    const snapshot = async (phase: string, now: number, n: number, value: number | null) => {
      setSystemTime(new Date(now));
      const refreshed = await fetch(server!.url + "/api/control", { method: "POST", headers, body: JSON.stringify({ type: "refresh" }) });
      if (!refreshed.ok || !(await refreshed.json() as { ok: boolean }).ok) throw Error("Refresh failed");
      const response = await fetch(server!.url + "/api/state", { headers });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const state = await response.json() as ObsState;
      if (state.env.error) throw Error(state.env.error);
      const metric = state.stats.scorecard!.find(m => m.key === "completion")!;
      observations.push({ phase, n: metric.n, value: metric.value, met: metric.met });
      expected.push({ phase, n, value, met: value === null ? undefined : value >= 0.7 });
    };
    await snapshot("scheduled, not due", at - HOUR, 0, null);
    await w.say("a", "I can't make it anymore");
    const cancelled = w.net.exportState().opps.find(o => o.id === id)!;
    expect([cancelled.stage, cancelled.closedFrom, cancelled.meetingAt]).toEqual(["closed", "scheduled", at]);
    await saved.save(w.net.exportState());
    expect((await sql`select state from network.opportunities where id = ${id}`)[0]!.state).toBe("CANCELLED");
    await snapshot("cancelled, not due", at - HOUR, 0, null);
    await snapshot("cancelled, at meeting time", at, 1, 0);
    await snapshot("cancelled, after meeting time", at + HOUR, 1, 0);
    // Controlled terminal-state rows check the denominator and timing boundary in the real API.
    await sql`insert into network.opportunities (id, kind, state, source, city, objective, meeting_at)
      values ('held', 'intro', 'COMPLETED', 'network', 'nyc', 'Synthetic held control', ${new Date(at - HOUR)})`;
    await sql`update network.opportunities set created_at = ${new Date(at - HOUR)}, updated_at = ${new Date(at - HOUR)} where id = 'held'`;
    await snapshot("one held, one cancelled", at + HOUR, 2, 0.5);
    await sql`insert into network.opportunities (id, kind, state, source, city, objective, meeting_at) values
      ('abandoned', 'intro', 'ABANDONED', 'network', 'nyc', 'Synthetic abandoned control', ${new Date(at)}),
      ('future', 'intro', 'CANCELLED', 'network', 'nyc', 'Synthetic future cancellation', ${new Date(at + DAY)}),
      ('unscheduled', 'intro', 'CANCELLED', 'network', 'nyc', 'Synthetic unscheduled cancellation', null),
      ('unbooked', 'intro', 'MUTUALLY_ACCEPTED', 'network', 'nyc', 'Synthetic unbooked control', null)`;
    // The reader's clock cannot precede stored activity, so fixture timestamps use the simulated date too.
    await sql`update network.opportunities set created_at = ${new Date(at - HOUR)}, updated_at = ${new Date(at - HOUR)} where id <> ${id}`;
    await snapshot("future and unscheduled excluded", at + DAY - HOUR, 3, 0.333);
    await snapshot("later cancelled booking becomes due", at + DAY, 4, 0.25);
    expect(observations).toEqual(expected);
  } finally { await server?.stop(); await sql.close(); await dropTestDb(); setSystemTime(); }
}, 120_000);
