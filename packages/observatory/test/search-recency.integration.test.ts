import { expect, test } from "bun:test";
import { SQL } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DAY } from "@thenetwork/core";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import { FileAudit } from "../src/staff.ts";
import type { GameSource } from "../src/sources/game.ts";
import type { SearchHit } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("HTTP search returns the newest eligible matches in game and real histories", async () => {
  const url = await testDb(), sql = new SQL(url);
  const dir = await mkdtemp(join(tmpdir(), "obs-search-recency-"));
  const token = "local-search-recency-test-000000000000";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  let real: ObservatoryServer | undefined;
  const server = await createServer({ port: 0, development: false, token,
    staffRolesUrl: false, peopleUrl: false, audit: new FileAudit(join(dir, "audit")),
    lab: { dir: join(dir, "lab") },
    game: { seed: 1, personas: 80, days: 14, network: "consent", pushMs: 3_600_000, tickMs: 3_600_000 },
    real: { url: undefined, service: false, pollMs: 3_600_000 },
  });
  try {
    const step = await fetch(`${server.url}/api/control`, { method: "POST", headers,
      body: JSON.stringify({ type: "step", ms: 14 * DAY }),
    });
    expect(await step.json()).toMatchObject({ ok: true });
    const source = await server.source("game") as GameSource;
    for (const query of ["you", "request_result", "joined", "meeting", "no-such-search-phrase"]) {
      const all = await source.search(query, Number.MAX_SAFE_INTEGER);
      if (query === "you" || query === "request_result") expect(all.length).toBeGreaterThan(100);
      const response = await fetch(`${server.url}/api/search?q=${encodeURIComponent(query)}`, { headers });
      const hits = await response.json() as SearchHit[];
      expect({ query, status: response.status, hits }).toEqual({ query, status: 200, hits: all.slice(0, 100) });
      if (query === "you") {
        const newest = Math.max(...source.world.channel.all()
          .filter(m => m.direction === "outbound" && !m.system && /you/i.test(m.body)).map(m => m.ts));
        expect(hits[0]!.t).toBe(newest);
      }
    }
    const start = new Date("2026-01-01T12:00:00Z");
    await sql`insert into network.members (app_id, id, name, home_city, age, joined_at) values
      ('ntwrk', 'search-member', 'Synthetic Member', 'nyc', 30, ${start}),
      ('slop', 'search-other', 'Other App', 'nyc', 30, ${start})`;
    await sql`insert into network.messages (app_id, id, member_id, direction, body, ts, system) values
      ('ntwrk', 'visible', 'search-member', 'outbound', 'Needle plain text match', ${start}, false),
      ('ntwrk', 'inbound', 'search-member', 'inbound', 'Needle private member text', ${start}, false),
      ('ntwrk', 'system', 'search-member', 'outbound', 'Needle system text', ${start}, true),
      ('slop', 'other-app', 'search-other', 'outbound', 'Needle other app text', ${start}, false)`;
    await sql`insert into network.messages (app_id, id, member_id, direction, body, ts)
      select 'ntwrk', 'scrubbed-' || i, 'search-member', 'outbound', 'needle' || i || '@example.test',
        ${start}::timestamptz + i * interval '1 second' from generate_series(1, 100) i`;
    await sql`insert into network.messages (app_id, id, member_id, direction, body, ts)
      select 'ntwrk', 'probe-' || i, 'search-member', 'outbound', 'Probe message control',
        ${start}::timestamptz + i * interval '1 second' from generate_series(1, 250) i`;
    await sql`insert into network.events (app_id, at, actor_type, actor_id, type, object_type, object_id, payload) values
      ('ntwrk', ${start}, 'agent', null, 'checkin_sent', 'member', 'search-member', '{}'::jsonb),
      ('ntwrk', ${start}, 'member', 'search-member', 'feedback_given', 'member', 'search-member', '{"text":"Needle private feedback"}'::jsonb)`;
    await sql`insert into network.events (app_id, at, actor_type, actor_id, type, object_type, object_id)
      select 'ntwrk', ${start}::timestamptz + i * interval '1 second', 'agent', null, 'probe_sent', 'member', 'search-member'
      from generate_series(1, 5001) i`;
    real = await createServer({ port: 0, development: false, mode: "real", token,
      staffRolesUrl: false, peopleUrl: false, audit: new FileAudit(join(dir, "real-audit")), lab: { dir: join(dir, "real-lab") },
      real: { url, service: false, pollMs: 3_600_000, pushMs: 3_600_000 } });
    const read = async (q: string) => {
      const r = await fetch(`${real!.url}/api/search?q=${encodeURIComponent(q)}`, { headers });
      if (r.status !== 200) throw new Error(`Search ${q}: ${r.status}`);
      return await r.json() as SearchHit[];
    };
    const needle = await read("needle");
    expect(needle.map(h => [h.memberId, h.kind, h.t, h.snippet])).toEqual([
      ["search-member", "message", start.getTime(), "Needle plain text match"],
    ]);
    const checkin = await read("checkin_sent");
    expect(checkin.map(h => [h.memberId, h.kind, h.t, h.type])).toEqual([
      ["search-member", "event", start.getTime(), "checkin_sent"],
    ]);
    const probes = await read("probe");
    expect(probes.length).toBe(100);
    expect(probes.every((h, i) => h.kind === "event" && h.t === start.getTime() + (5001 - i) * 1000)).toBe(true);
    expect(await read("feedback_given")).toEqual([]);
  } finally {
    await server.stop();
    await real?.stop(); await sql.close(); await dropTestDb();
    const target = resolve(dir), parent = resolve(tmpdir());
    if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith("obs-search-recency-")) throw new Error("Unsafe cleanup path");
    await rm(dir, { recursive: true, force: true });
  }
}, 180_000);
