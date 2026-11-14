// Booked request_result events render as booked (not "Request waiting ()") on timelines and in search.
import { expect, setSystemTime, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR } from "@thenetwork/core";
import { PgStore } from "@thenetwork/network";
import { Mini } from "../../network/test/mini.ts";
import { eventOf } from "../src/events.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { MemberTimeline, SearchHit } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("booked request_result events format with hours and good severity in timeline and search", async () => {
  const url = await testDb(), sql = new SQL(url);
  let server: ObservatoryServer | undefined;
  try {
    const w = new Mini([
      { id: "a", name: "Alex Example", age: 30, interests: ["climbing"], shareable: true },
      { id: "b", name: "Blair Example", age: 32, interests: ["climbing"], shareable: true },
      { id: "c", name: "Casey Example", age: 31, interests: ["pottery"], shareable: true },
    ]);
    await w.onboard("a", "b", "c");
    await w.say("c", "Could you find someone into pottery?");
    await w.say("a", "Could you find someone to go climbing with?");
    await w.answerProbes(["a", "b"]);
    expect(w.meetings.length).toBe(1);

    const bookedLog = w.logs.find(l => l.kind === "request_result" && l.detail.memberId === "a" && l.detail.outcome === "booked");
    expect(bookedLog).toBeDefined();
    const bookedHours = bookedLog!.detail.hours as number;

    const at = w.net.exportState().opps[0]!.meetingAt!;
    await w.runUntil(() => w.clock.now() >= at + 4 * HOUR, 7 * DAY);
    await w.say("a", "We met up and had a great time climbing.");
    await w.say("b", "We met and had a great climb together.");
    await w.run(30 * HOUR);

    const fulfilledLog = w.logs.find(l => l.kind === "request_result" && l.detail.memberId === "a" && l.detail.outcome === "fulfilled");
    expect(fulfilledLog).toBeDefined();
    const fulfilledHours = fulfilledLog!.detail.hours as number;

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

    setSystemTime(new Date(w.clock.now()));
    const token = "booked-request-events-integration-synthetic-token";
    server = await createServer({
      port: 0, development: false, mode: "real", platformEnv: "dev", token,
      staffRolesUrl: false, peopleUrl: false, audit: { url }, real: { url, service: false, pollMs: HOUR, pushMs: HOUR },
    });
    const headers = { authorization: `Bearer ${token}` };

    const tlRes = await fetch(`${server.url}/api/member/a/timeline`, { headers });
    if (!tlRes.ok) throw Error(`HTTP ${tlRes.status}`);
    const tl = (await tlRes.json()) as MemberTimeline;
    const timeline = tl.entries
      .filter((e): e is Extract<typeof e, { kind: "event" }> => e.kind === "event" && e.event.type === "request_result")
      .map(e => ({ text: e.event.text, severity: e.event.severity ?? null, detail: e.event.detail }));

    const waitRes = await fetch(`${server.url}/api/search?q=${encodeURIComponent("Request waiting")}`, { headers });
    if (!waitRes.ok) throw Error(`HTTP ${waitRes.status}`);
    const waitingSearch = ((await waitRes.json()) as SearchHit[]).map(h => [h.memberId, h.snippet]);

    const bookedRes = await fetch(`${server.url}/api/search?q=${encodeURIComponent("Request booked in")}`, { headers });
    if (!bookedRes.ok) throw Error(`HTTP ${bookedRes.status}`);
    const bookedSearch = ((await bookedRes.json()) as SearchHit[]).map(h => [h.memberId, h.snippet]);

    expect({ timeline, waitingSearch, bookedSearch }).toEqual({
      timeline: [
        { text: "Request: checking 1 candidates", severity: null, detail: { outcome: "probing", candidates: 1 } },
        { text: `Request booked in ${bookedHours}h`, severity: "good", detail: { outcome: "booked", hours: bookedHours } },
        { text: `Request fulfilled in ${fulfilledHours}h`, severity: "good", detail: { outcome: "fulfilled", hours: fulfilledHours } },
      ],
      waitingSearch: [["c", "Request waiting (density gap)"]],
      bookedSearch: [["a", `Request booked in ${bookedHours}h`]],
    });
  } finally {
    await server?.stop();
    await sql.close();
    await dropTestDb();
    setSystemTime();
  }
}, 120_000);
