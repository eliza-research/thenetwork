// A long-lived database reader must agree with a fresh reader after stored graph edits.
import { expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR } from "@thenetwork/core";
import { RealSource } from "../src/sources/real.ts";
import type { ObsEdge } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const START = Date.parse("2026-10-05T07:00:00Z");
const sorted = (edges: Iterable<ObsEdge>) => [...edges].sort((a, b) => a.id.localeCompare(b.id));

test.skipIf(!pgAvailable)("database graph refresh replaces stale edge values and emits the changed edges", async () => {
  const url = await testDb(), sql = new SQL(url);
  try {
    for (const app of ["ntwrk", "friends"] as const) {
      const a = `${app}:a`, b = `${app}:b`, c = `${app}:c`;
      await sql`insert into network.members (app_id, id, name, home_city, age, account_status) values
        (${app}, ${a}, 'Alex Example', 'nyc', 30, 'active'), (${app}, ${b}, 'Blair Example', 'nyc', 32, 'active'), (${app}, ${c}, 'Casey Example', 'nyc', 34, 'active')`;
      await sql`insert into network.edges (app_id, from_id, to_id, type, strength, explicit, created_at) values
        (${app}, ${a}, ${b}, 'knows', 0.9, true, ${new Date(START)}), (${app}, ${b}, ${a}, 'knows', 0.4, true, ${new Date(START)}),
        (${app}, ${a}, ${c}, 'met', 0.3, false, ${new Date(START)}),
        (${app}, ${a}, ${b}, 'invited_by', 0.6, true, ${new Date(START)}), (${app}, ${b}, ${a}, 'invited_by', 0.7, true, ${new Date(START)})`;
    }
    for (const app of ["ntwrk", "friends"] as const) {
      const a = `${app}:a`;
      const warm = new RealSource({ url, app, service: false, pollMs: HOUR, pushMs: HOUR });
      try {
        await warm.init(); await warm.control({ type: "refresh" });
        if (warm.state().env.error) throw Error(warm.state().env.error);
        const client = new Map(warm.state().edges.map(e => [e.id, structuredClone(e)]));
        let updates: ObsEdge[] = [];
        warm.subscribe(d => { for (const e of d.edges ?? []) { updates.push(structuredClone(e)); client.set(e.id, structuredClone(e)); } });
        let previous = structuredClone(sorted(warm.state().edges));
        const observations: unknown[] = [], expected: unknown[] = [];
        const snapshot = async (phase: string, strengths: number[]) => {
          updates = [];
          const result = await warm.control({ type: "refresh" });
          if (!result.ok || warm.state().env.error) throw Error(result.error ?? warm.state().env.error);
          const cold = new RealSource({ url, app, service: false, pollMs: HOUR, pushMs: HOUR });
          try {
            await cold.init();
            if (cold.state().env.error) throw Error(cold.state().env.error);
            const fresh = sorted(cold.state().edges);
            expect(fresh.map(e => e.strength)).toEqual(strengths);
            const changed = fresh.filter(e => JSON.stringify(previous.find(p => p.id === e.id)) !== JSON.stringify(e));
            const detail = await warm.member(a);
            observations.push({ phase, state: sorted(warm.state().edges), client: sorted(client.values()), detail: sorted(detail!.edges), updates: sorted(updates) });
            expected.push({ phase, state: fresh, client: fresh, detail: fresh, updates: changed });
            previous = structuredClone(fresh);
          } finally { await cold.dispose(); }
        };
        await snapshot("initial", [0.6, 0.7, 0.9, 0.3]);
        await sql`update network.edges set strength = case when type = 'knows' then 0.2 when type = 'met' then 0.1 else 0.2 end,
          explicit = false, created_at = ${new Date(START + DAY)} where app_id = ${app} and from_id = ${a}`;
        // The reverse knows row now wins the symmetric pair; invited_by stays directed.
        await snapshot("weakened", [0.2, 0.7, 0.4, 0.1]);
        await sql`update network.edges set strength = case when type = 'knows' then 0.8 when type = 'met' then 0.6 else 0.5 end
          where app_id = ${app} and from_id = ${a}`;
        await snapshot("strengthened", [0.5, 0.7, 0.8, 0.6]);
        await sql`update network.edges set explicit = true, created_at = ${new Date(START + 2 * DAY)}
          where app_id = ${app} and from_id = ${a} and type in ('knows', 'met')`;
        await snapshot("metadata only", [0.5, 0.7, 0.8, 0.6]);
        await sql`update network.edges set strength = 0 where app_id = ${app} and from_id = ${a}`;
        await snapshot("zero strength", [0, 0.7, 0.4, 0]);
        await snapshot("unchanged", [0, 0.7, 0.4, 0]);
        expect(observations).toEqual(expected);
      } finally { await warm.dispose(); }
    }
  } finally { await sql.close(); await dropTestDb(); }
}, 120_000);
