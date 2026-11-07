// Real seeded channel failures must not start a booked plan's received/opt-out clock.
import { expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR } from "@thenetwork/core";
import { ConsentNetwork, PgStore } from "@thenetwork/network";
import { DEFAULT_START, generatePersonas, World } from "@thenetwork/sim";
import { Projector } from "../src/projector.ts";
import { Store, emptyCounters } from "../src/store.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { ObsOpportunity, ObsState, OpportunityDetail } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("booked-plan receipt times exclude unsuccessful sends in the world and database API", async () => {
  const url = await testDb(), sql = new SQL(url);
  let server: ObservatoryServer | undefined;
  try {
    const seed = 4, start = DEFAULT_START;
    const personas = generatePersonas({ n: 80, seed, joinSpreadDays: 7, cityWeights: { nyc: 1, sf: 0 } });
    const store = new Store({ mode: "game", label: "Synthetic delivery fixture", dataset: "generated", capabilities: { canStep: true, canIntervene: true, hiddenTruth: true, readOnly: false } },
      { now: start, start, end: start + 10 * DAY, day: 1, playing: false, speed: DAY, waitingForPlayer: false });
    for (const p of personas) store.upsertMember({ id: p.id, name: p.name, city: p.homeCity, state: "not_joined", joined: false, minor: p.public.claimedAge < 18, age: p.public.claimedAge, counters: emptyCounters() });
    const projector = new Projector(store), network = new ConsentNetwork({ seed, review: "auto" });
    const world = new World({ seed, personas, days: 10, start, failureRate: 0.25, network, writeLog: false, onRecord: r => projector.apply(r) });
    await world.run();
    const reveals = world.channel.all().filter(m => m.meta?.booked);
    expect(reveals.filter(m => m.status === "failed").length).toBeGreaterThan(0);
    expect(reveals.filter(m => m.status === "delivered").length).toBeGreaterThan(0);
    const receipts = (opps: ObsOpportunity[]) => Object.fromEntries(opps.filter(o => Object.keys(o.booked?.told ?? {}).length).map(o => [o.id, o.booked!.told]));
    const expected: Record<string, Record<string, number>> = {};
    for (const m of reveals) if (m.status === "delivered") {
      const told = expected[m.meta!.booked!.proposalId] ??= {};
      told[m.memberId] = Math.min(told[m.memberId] ?? Infinity, m.ts);
    }
    const observations: unknown[] = [{ phase: "world", told: receipts([...store.opps.values()]) }];
    const wanted: unknown[] = [{ phase: "world", told: structuredClone(expected) }];
    // Persist the real Network state and channel records, without rewriting their delivery statuses.
    for (const p of personas) await sql`insert into network.members (id, name, home_city, age, account_status, joined_at)
      values (${p.id}, ${p.name}, 'nyc', ${p.public.claimedAge}, 'active', ${new Date(start)})`;
    await new PgStore(sql).save(network.exportState(), async tx => {
      for (const m of reveals) await tx`insert into network.messages (id, member_id, direction, channel, body, status, type, opportunity_id, ts)
        values (${m.id}, ${m.memberId}, 'outbound', ${m.channel}, ${m.body}, ${m.status}, 'proposal', ${m.meta!.booked!.proposalId}, ${new Date(m.ts)})`;
    });
    const token = "booked-delivery-integration-synthetic-token";
    server = await createServer({ port: 0, development: false, mode: "real", platformEnv: "dev", token,
      staffRolesUrl: false, peopleUrl: false, audit: { url }, real: { url, service: false, pollMs: HOUR, pushMs: HOUR } });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const get = async <T>(path: string): Promise<T> => {
      const response = await fetch(server!.url + path, { headers });
      if (!response.ok) throw Error(`HTTP ${response.status}: ${path}`);
      return response.json() as Promise<T>;
    };
    const snapshot = async (phase: string, told: typeof expected) => {
      const response = await fetch(server!.url + "/api/control", { method: "POST", headers, body: JSON.stringify({ type: "refresh" }) });
      if (!response.ok || !(await response.json() as { ok: boolean }).ok) throw Error("Refresh failed");
      const state = await get<ObsState>("/api/state");
      if (state.env.error) throw Error(state.env.error);
      const ids = [...new Set(reveals.map(m => m.meta!.booked!.proposalId))];
      const details = await Promise.all(ids.map(id => get<OpportunityDetail>(`/api/opportunity/${id}`)));
      observations.push({ phase, state: receipts(state.opportunities), details: receipts(details.map(d => d.opportunity)) });
      wanted.push({ phase, state: structuredClone(told), details: structuredClone(told) });
    };
    await snapshot("native channel records", expected);
    const failed = reveals.find(m => m.status === "failed")!;
    const opp = failed.meta!.booked!.proposalId, member = failed.memberId, retryAt = failed.ts + HOUR;
    // A later successful attempt must use its own time, not the earlier failed attempt's time.
    await sql`insert into network.messages (id, member_id, direction, body, status, type, opportunity_id, ts)
      values ('retry', ${member}, 'outbound', 'Synthetic booked-plan retry', 'queued', 'proposal', ${opp}, ${new Date(retryAt)})`;
    for (const status of ["queued", "sending", "collected", "unknown", "failed", "refused_opted_out", "expired", "accepted", "sent", "delivered", "read", "dry_run"]) {
      await sql`update network.messages set status = ${status} where id = 'retry'`;
      const current = structuredClone(expected);
      if (["accepted", "sent", "delivered", "read", "dry_run"].includes(status)) (current[opp] ??= {})[member] = retryAt;
      await snapshot(status, current);
    }
    expect(observations).toEqual(wanted);
  } finally { await server?.stop(); await sql.close(); await dropTestDb(); }
}, 120_000);
