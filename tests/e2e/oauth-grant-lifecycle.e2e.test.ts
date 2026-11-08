// End to end: the life of an MCP OAuth grant after account events (machines oauth-grant,
// oauth-forget-revoke and oauth-code in docs/research/state-machines/mcp-oauth.md). The whole stack
// runs as in production (harness.ts): sites, router, backend, platform API, MCP server, Postgres.
//   bun test tests/e2e/oauth-grant-lifecycle.e2e.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { Browser, connectMcp, newPhone, pgAvailable, rpc, startStack, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
if (!pgAvailable && process.env.REQUIRE_PG === "1") throw new Error("tests/e2e needs Postgres (REQUIRE_PG=1)");

let st: Stack;
let sql: SQL;

describe.skipIf(!pgAvailable)("OAuth grants after account events", () => {
  beforeAll(async () => {
    st = await startStack();
    sql = new SQL({ url: st.url, max: 2 });
  }, T);
  afterAll(async () => {
    await sql?.close();
    await st?.close();
  }, T);

  const memberId = async (app: string, e164: string) =>
    ((await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`)[0] as { id: string }).id;

  // SD-019: a ban must end the person's OAuth access. Before the fix the banned person's agent still
  // read get_updates (200) and the refresh token minted a new pair.
  test("a staff ban ends get_updates and refresh on an existing grant", async () => {
    const phone = newPhone(), b = new Browser();
    expect((await webJoin(st, "friends", phone, { age: 30, browser: b })).res.status).toBe(200);
    const c = await connectMcp(st, "friends", phone, { browser: b });
    expect(c.token?.access_token, c.html.slice(0, 300)).toBeString();
    expect((await rpc(st, "friends", "/mcp", "tools/call", { name: "get_updates", arguments: {} }, c.token!.access_token)).res.status).toBe(200);

    const ban = await st.staff("/apps/friends/safety/ban", { memberId: await memberId("friends", phone), by: "person", note: "confirmed by staff" });
    expect(await ban.json()).toEqual({ ok: true });

    expect((await rpc(st, "friends", "/mcp", "tools/call", { name: "get_updates", arguments: {} }, c.token!.access_token)).res.status).toBe(401);
    const refresh = await st.site("friends", "/oauth/token", { form: { grant_type: "refresh_token", client_id: c.client.client_id, refresh_token: c.token!.refresh_token } });
    expect(refresh.status).toBe(400);
  }, T);

  const grantRows = async (e164: string) =>
    ((await sql`select app_id from oauth.grants where phone_key = ${st.svc.publicApi.accounts.phoneHash(e164)} order by app_id`) as { app_id: string }[]).map(r => r.app_id);

  // SD-089: "delete everything" must delete the grants of every app, also of an app the person never
  // joined. Before the fix the forget hook ran only for live memberships, so the peon grant stayed.
  test("delete everything deletes the grant of an app with no membership", async () => {
    const phone = newPhone(), b = new Browser();
    expect((await webJoin(st, "slop", phone, { age: 30, browser: b })).res.status).toBe(200);
    expect((await connectMcp(st, "peon", phone)).token?.access_token).toBeString();
    expect((await connectMcp(st, "slop", phone, { browser: b })).token?.access_token).toBeString();
    expect(await grantRows(phone)).toEqual(["peon", "slop"]);
    expect((await st.site("slop", "/api/me/delete", { browser: b, json: { scope: "all" } })).status).toBe(200);
    expect(await grantRows(phone)).toEqual([]);
  }, T);

  // SD-089: an explicit under-13 age from a member whose record does not say adult is declined, and every
  // membership goes; the grants must go too (under 13: nothing stored). Before the fix the decline did
  // not run the forget listeners.
  test("an under-13 decline deletes the person's grants on every app", async () => {
    const phone = newPhone();
    expect(await st.text(phone, "friends")).toBe("join_asked");
    expect(await st.text(phone, "Lu 15")).toBe("joined");
    const c = await connectMcp(st, "friends", phone);
    expect(c.token?.access_token, c.html.slice(0, 300)).toBeString();
    expect((await connectMcp(st, "peon", phone)).token?.access_token).toBeString();
    expect(await grantRows(phone)).toEqual(["friends", "peon"]);
    await st.text(phone, "I am 12 years old");
    expect((await sql`select state from platform.memberships m join platform.phone_identities ph on ph.person_id = m.person_id where ph.e164 = ${phone} and m.state <> 'removed'`).length).toBe(0);
    expect(await grantRows(phone)).toEqual([]);
  }, T);

  // SD-089: a forget listener that fails must not let the membership go, or no later pass finds the
  // grant again. Before the fix the service logged the error and the leave answered 200.
  test("a failed forget listener stops the leave, and a retry deletes the grant", async () => {
    let fail = true;
    st.svc.onForget(() => { if (fail) throw new Error("listener down"); });
    const phone = newPhone(), b = new Browser();
    expect((await webJoin(st, "peon", phone, { age: 30, browser: b })).res.status).toBe(200);
    expect((await connectMcp(st, "peon", phone, { browser: b })).token?.access_token).toBeString();
    const live = async () => (await sql`select 1 from platform.memberships m join platform.phone_identities ph on ph.person_id = m.person_id where ph.e164 = ${phone} and m.app_id = 'peon' and m.state <> 'removed'`).length;
    expect((await st.site("peon", "/api/me/delete", { browser: b, json: { scope: "app" } })).status).toBe(500);
    expect(await live()).toBe(1);
    fail = false;
    expect((await st.site("peon", "/api/me/delete", { browser: b, json: { scope: "app" } })).status).toBe(200);
    expect(await live()).toBe(0);
    expect(await grantRows(phone)).toEqual([]);
  }, T);
});
