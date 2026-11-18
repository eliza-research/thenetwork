// Missing enjoyment is not a zero rating: prove the saved Network state and real HTTP views agree.
import { expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR } from "@thenetwork/core";
import { PgStore } from "@thenetwork/network";
import { Mini } from "../../network/test/mini.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { MemberDetail, ObsState } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("member enjoyment counts only reported ratings, including zero, through the database API", async () => {
  const url = await testDb(), sql = new SQL(url);
  let server: ObservatoryServer | undefined;
  try {
    const w = new Mini([{ id: "a", name: "Alex Example", age: 30, interests: ["climbing"] }, { id: "b", name: "Blair Example", age: 32, interests: ["climbing"] }]);
    await w.onboard("a", "b");
    const opp = w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    expect(w.meetings.length).toBe(1);
    expect(await w.runUntil(() => w.net.exportState().opps.find(o => o.id === opp)?.stage === "done", 10 * DAY)).toBe(true);
    for (const m of w.members) await sql`insert into network.members (id, name, home_city, age, account_status, joined_at)
      values (${m.id}, ${m.name}, 'nyc', ${m.age}, 'active', ${new Date(m.joinedAt!)})`;
    await new PgStore(sql).save(w.net.exportState());
    expect((await sql`select enjoyment from network.participations order by member_id`).map((p: { enjoyment: number | null }) => p.enjoyment)).toEqual([null, null]);

    const token = "enjoyment-integration-synthetic-token";
    server = await createServer({ port: 0, development: false, mode: "real", platformEnv: "dev", token,
      staffRolesUrl: false, peopleUrl: false, audit: { url }, real: { url, service: false, pollMs: HOUR, pushMs: HOUR } });
    const get = async <T>(path: string): Promise<T> => {
      const r = await fetch(server!.url + path, { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) throw Error(`HTTP ${r.status}: ${path}`);
      return r.json() as Promise<T>;
    };
    const observations: unknown[] = [], expected: unknown[] = [];
    const sample = (c: { enjoymentSum: number; enjoymentN: number }) => ({ sum: c.enjoymentSum, n: c.enjoymentN, mean: c.enjoymentN ? c.enjoymentSum / c.enjoymentN : null });
    const snapshot = async (phase: string, samples: [number, number][]) => {
      const r = await fetch(server!.url + "/api/control", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ type: "refresh" }) });
      if (!r.ok || !(await r.json() as { ok: boolean }).ok) throw Error("Refresh failed");
      const state = await get<ObsState>("/api/state");
      if (state.env.error) throw Error(state.env.error);
      const members = ["a", "b"].map(id => sample(state.members.find(m => m.id === id)!.counters));
      const details = await Promise.all(["a", "b"].map(async id => sample((await get<MemberDetail>(`/api/member/${id}`)).member.counters)));
      const values = samples.map(([sum, n]) => sample({ enjoymentSum: sum, enjoymentN: n }));
      const total = sample({ enjoymentSum: samples.reduce((n, s) => n + s[0], 0), enjoymentN: samples.reduce((n, s) => n + s[1], 0) });
      observations.push({ phase, members, details, total: sample(state.stats) });
      expected.push({ phase, members: values, details: values, total });
    };
    await snapshot("native saved state without ratings", [[0, 0], [0, 0]]);
    await sql`update network.participations set enjoyment = 0.75 where opportunity_id = ${opp} and member_id = 'a'`;
    await snapshot("one rating", [[0.75, 1], [0, 0]]);
    // Controlled rows exercise partial feedback and a real zero rating without changing the native writer.
    for (const [id, state] of [["unrated", "COMPLETED"], ["rated", "FEEDBACK_COLLECTED"]]) {
      await sql`insert into network.opportunities (id, kind, state, source, city, objective) values (${id!}, 'intro', ${state!}, 'network', 'nyc', 'A synthetic meeting')`;
      await sql`insert into network.participations (opportunity_id, member_id, status, enjoyment) values
        (${id!}, 'a', 'attended', ${id === "rated" ? 0 : null}), (${id!}, 'b', 'attended', ${id === "rated" ? 0.25 : null})`;
    }
    await snapshot("mixed missing and zero ratings", [[0.75, 2], [0.25, 1]]);
    await sql`update network.participations set enjoyment = case when member_id = 'a' then 0.25 else 0.75 end where opportunity_id = 'unrated'`;
    await sql`update network.participations set enjoyment = 0 where opportunity_id = ${opp} and member_id = 'b'`;
    await snapshot("all ratings present", [[1, 3], [1, 3]]);
    expect(observations).toEqual(expected);
  } finally { await server?.stop(); await sql.close(); await dropTestDb(); }
}, 120_000);
