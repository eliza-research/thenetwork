// Real PostgreSQL and HTTP: Member 360 and its timeline retain the whole history across reveal changes.
import { expect, test } from "bun:test";
import { SQL } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import { HIDDEN_MESSAGE } from "../src/sources/real.ts";
import type { MemberDetail, MemberTimeline } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("member history stays complete and ordered before, during and after a PII reveal", async () => {
  const url = await testDb(), sql = new SQL(url);
  const dir = await mkdtemp(join(tmpdir(), "obs-member-history-"));
  const token = "synthetic-history-admin".padEnd(40, "x");
  const start = new Date("2026-01-01T12:00:00.000Z");
  let obs: ObservatoryServer | undefined;
  try {
    await sql`insert into network.members (app_id, id, name, home_city, age, joined_at) values
      ('ntwrk', 'history', 'Synthetic Member', 'nyc', 30, ${start}),
      ('ntwrk', 'other', 'Other Member', 'nyc', 30, ${start}),
      ('slop', 'other-app', 'Other App', 'nyc', 30, ${start})`;
    // Reverse insertion order and tied timestamps exercise the chronological ordering contract.
    await sql`insert into network.messages (app_id, id, member_id, direction, body, ts)
      select 'ntwrk', 'history-' || lpad(i::text, 6, '0'), 'history',
        case when i % 2 = 1 then 'inbound' else 'outbound' end,
        'Synthetic history ' || i, ${start}::timestamptz + (i / 2) * interval '1 second'
      from generate_series(1, 2001) i order by i desc`;
    await sql`insert into network.events (app_id, at, actor_type, actor_id, type, object_type, object_id)
      select 'ntwrk', ${start}::timestamptz + (i / 2) * interval '1 second', 'agent', 'history', 'checkin_sent', 'member', 'history'
      from generate_series(1, 5001) i order by i desc`;
    await sql`insert into network.messages (app_id, id, member_id, direction, body, ts) values
      ('ntwrk', 'other-message', 'other', 'inbound', 'Other private history', ${start}),
      ('slop', 'other-app-message', 'other-app', 'inbound', 'Other app private history', ${start})`;
    await sql`insert into network.events (app_id, at, actor_type, actor_id, type, object_type, object_id) values
      ('ntwrk', ${start}, 'member', 'other', 'member_joined', 'member', 'other'),
      ('slop', ${start}, 'member', 'other-app', 'member_joined', 'member', 'other-app')`;
    obs = await createServer({ port: 0, development: false, mode: "real", token,
      staffRolesUrl: false, peopleUrl: false, audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
      real: { url, service: false, pollMs: 3_600_000, pushMs: 3_600_000 } });
    const request = async (path: string, method = "GET", body?: object) => {
      const r = await fetch(new URL(path, obs!.server.url), { method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if (r.status !== 200) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
      return r.json();
    };
    const ids = Array.from({ length: 2001 }, (_, i) => `history-${String(i + 1).padStart(6, "0")}`);
    for (const phase of ["hidden", "revealed", "revoked"]) {
      if (phase === "revealed") await request("/api/reveal", "POST", { memberId: "history", reason: "Synthetic history verification" });
      if (phase === "revoked") await request("/api/reveal?memberId=history", "DELETE");
      const member = await request("/api/member/history") as MemberDetail;
      const timeline = await request("/api/member/history/timeline") as MemberTimeline;
      const messages = timeline.entries.flatMap(e => e.kind === "message" ? [e.message] : []);
      const events = timeline.entries.flatMap(e => e.kind === "event" ? [e.event] : []);
      expect([member.messages.length, messages.length, events.length]).toEqual([2001, 2001, 5001]);
      expect(member.messages.map(m => m.id)).toEqual(ids);
      expect(messages).toEqual(member.messages);
      expect(events.every(e => e.memberId === "history" && e.type === "checkin_sent")).toBe(true);
      expect(timeline.entries.every((e, i, all) => !i || all[i - 1]!.t < e.t ||
        (all[i - 1]!.t === e.t && !(all[i - 1]!.kind === "message" && e.kind === "event")))).toBe(true);
      expect(messages.every((m, i) => m.body === (phase !== "revealed" && m.direction === "inbound"
        ? HIDDEN_MESSAGE : `Synthetic history ${i + 1}`))).toBe(true);
      expect(messages.filter(m => m.direction === "inbound").every(m => phase === "revealed"
        ? m.hiddenLength === undefined : m.hiddenLength === `Synthetic history ${Number(m.id.slice(-6))}`.length)).toBe(true);
      const other = await request("/api/member/other") as MemberDetail;
      const otherApp = await request("/api/member/other-app?app=slop") as MemberDetail;
      expect([other.messages[0]?.body, otherApp.messages[0]?.body]).toEqual([HIDDEN_MESSAGE, HIDDEN_MESSAGE]);
    }
  } finally {
    await obs?.stop();
    await sql.close();
    await dropTestDb();
    const target = resolve(dir), parent = resolve(tmpdir());
    if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith("obs-member-history-")) throw new Error("Unsafe cleanup path");
    await rm(target, { recursive: true, force: true });
  }
}, 180_000);
