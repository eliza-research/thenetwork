// End to end: an inbox item about a closed opportunity is not a new update (machine inbox-item in
// docs/research/state-machines/gap-active-member-journey.md, defect SD-430). The whole stack runs as in
// production (harness.ts): sites, router, backend, platform API, MCP server, Postgres.
//   bun test tests/e2e/inbox-expiry.e2e.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import type { Outbound } from "../../packages/network/service/channel.ts";
import type { NetworkRuntime } from "../../packages/network/service/runtime.ts";
import { Browser, connectMcp, newPhone, pgAvailable, rpc, startStack, toolData, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
if (!pgAvailable && process.env.REQUIRE_PG === "1") throw new Error("tests/e2e needs Postgres (REQUIRE_PG=1)");

let st: Stack;
let sql: SQL;

describe.skipIf(!pgAvailable)("inbox items and closed opportunities", () => {
  beforeAll(async () => {
    st = await startStack();
    sql = new SQL({ url: st.url, max: 3 });
  }, T);
  afterAll(async () => {
    await sql?.close();
    await st?.close();
  }, T);

  // SD-430: a probe goes out, the member does not answer and the opportunity closes. Before the fix the
  // probe stayed in the inbox with no expiry: weeks later get_updates returned it as new, with the
  // next step "They answer by replying to the text", and a reply answered nothing.
  test("get_updates does not return a probe whose opportunity closed", async () => {
    const phone = newPhone(), b = new Browser();
    expect((await webJoin(st, "friends", phone, { age: 30, browser: b })).res.status).toBe(200);
    const m = (await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'friends' and ph.e164 = ${phone}`)[0] as { id: string };
    const rt = [...st.svc.runtimes.values()].find(r => r.app.id === "friends") as NetworkRuntime;
    const closed = `opp_e2e_closed_${m.id}`, open = `opp_e2e_open_${m.id}`;
    // The console rows as the network store writes them (packages/network/src/store.ts consoleRows): a
    // probe with no answer that expired is SKIPPED; one that still waits is PROPOSED.
    await sql`insert into network.opportunities (app_id, id, kind, state, city, objective) values
      ('friends', ${closed}, 'friends', 'SKIPPED', 'nyc', 'A walk'), ('friends', ${open}, 'friends', 'PROPOSED', 'nyc', 'A run')`;
    const probe = (id: string, oppId: string, body: string): Outbound =>
      ({ id, memberId: m.id as any, body, kind: "proactive", type: "probe", oppId, proactive: true, system: false, ts: st.clock.now() });
    await st.svc.delivered(rt, [
      probe(`e2e-probe-closed-${m.id}`, closed, "Quick check, no names yet: up for a walk this week?"),
      probe(`e2e-probe-open-${m.id}`, open, "Quick check, no names yet: up for a run this week?"),
    ]);
    const c = await connectMcp(st, "friends", phone, { browser: b });
    expect(c.token?.access_token, c.html.slice(0, 300)).toBeString();

    const r = toolData(await rpc(st, "friends", "/mcp", "tools/call", { name: "get_updates", arguments: {} }, c.token!.access_token));
    expect((r.updates as { summary: string }[]).map(u => u.summary)).toEqual(["Quick check, no names yet: up for a run this week?"]);
  }, T);
});
