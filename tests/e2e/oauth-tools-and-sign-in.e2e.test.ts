// End to end: the MCP tool calls and the sign-in request of an OAuth grant (machines oauth-tool-access,
// oauth-consent and auth-request in docs/research/state-machines/mcp-oauth.md). The whole stack runs as in
// production (harness.ts): sites, router, backend, platform API, MCP server, Postgres.
//   bun test tests/e2e/oauth-tools-and-sign-in.e2e.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { pkceS256, sha256hex } from "../../packages/mcp/src/util.ts";
import { Browser, connectMcp, newPhone, pgAvailable, REDIRECT, rpc, startStack, toolData, VERIFIER, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
if (!pgAvailable && process.env.REQUIRE_PG === "1") throw new Error("tests/e2e needs Postgres (REQUIRE_PG=1)");

let st: Stack;
let sql: SQL;

describe.skipIf(!pgAvailable)("OAuth tool calls and sign-in requests", () => {
  beforeAll(async () => {
    st = await startStack();
    sql = new SQL({ url: st.url, max: 4 });
  }, T);
  afterAll(async () => {
    await sql?.close();
    await st?.close();
  }, T);

  const auditKinds = async (grantId: string) =>
    ((await sql`select kind from oauth.audit where grant_id = ${grantId} order by id`) as { kind: string }[]).map(r => r.kind);
  const grantOf = async (accessToken: string) =>
    ((await sql`select grant_id from oauth.tokens where hash = ${sha256hex(accessToken)}`)[0] as { grant_id: string }).grant_id;

  // SD-394: oauth.audit keeps one row for each revocation (packages/mcp/README.md section 3). Before the fix
  // a tool call that found the grant no longer the person's (here: the number is on hold) revoked the grant
  // and wrote no audit row.
  test("a tool call that ends the grant writes a consent_revoked row", async () => {
    const phone = newPhone(), b = new Browser();
    expect((await webJoin(st, "peon", phone, { age: 30, browser: b })).res.status).toBe(200);
    const c = await connectMcp(st, "peon", phone, { browser: b });
    expect(c.token?.access_token, c.html.slice(0, 300)).toBeString();
    const grantId = await grantOf(c.token!.access_token);

    await st.svc.people.setPhoneHold(phone, "recycled_number", st.clock.now());
    const r = await rpc(st, "peon", "/mcp", "tools/call", { name: "check_status", arguments: {} }, c.token!.access_token);
    expect(r.res.status).toBe(401);
    expect(((await sql`select revoked_at from oauth.grants where id = ${grantId}`)[0] as { revoked_at: Date | null }).revoked_at).not.toBeNull();
    expect(await auditKinds(grantId)).toContain("consent_revoked");
  }, T);

  /** Wait until this many sessions of the test database wait on a lock. */
  const lockWaiters = async (n: number) => {
    for (let i = 0; i < 400; i++) {
      if ((await sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`).length >= n) return;
      await Bun.sleep(25);
    }
    throw new Error(`fewer than ${n} sessions wait on a lock`);
  };

  // SD-397: approve and deny of one sign-in request have one outcome. Before the fix deny deleted the
  // request with no row check: when the approval took the request first, deny still wrote consent_denied
  // and sent the assistant access_denied, while the approval had stored a live grant.
  test("a deny that loses the race with an approve does not answer access_denied", async () => {
    const phone = newPhone(), b = new Browser();
    expect((await webJoin(st, "friends", phone, { age: 30, browser: b })).res.status).toBe(200);
    const client = (await (await st.site("friends", "/oauth/register", { json: { client_name: "E2E Assistant", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" } })).json()) as { client_id: string };
    const q = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", state: "e2e", resource: `${st.sites.friends.origin}/mcp` });
    const rid = /name="rid" value="([^"]+)"/.exec(await (await st.site("friends", `/oauth/authorize?${q}`, { browser: b })).text())![1]!;
    const consent = (decision: string) => st.site("friends", "/oauth/authorize/consent", { browser: b, form: { rid, decision } });

    let approve: Promise<Response> | undefined, deny: Promise<Response> | undefined;
    await sql.begin(async tx => {
      // Hold the request row: the approval waits first, then the denial (it has read the request) waits behind it.
      await tx`select id from oauth.auth_requests where id = ${rid} for update`;
      approve = consent("approve");
      await lockWaiters(1);
      deny = consent("deny");
      await lockWaiters(2);
    });
    const [a, d] = await Promise.all([approve!, deny!]);
    expect(a.status).toBe(303);
    expect(new URL(a.headers.get("location")!).searchParams.get("code")).toBeString();
    expect((await sql`select id from oauth.grants where client_id = ${client.client_id} and revoked_at is null`).length).toBe(1);
    expect(d.headers.get("location") ?? "").not.toContain("access_denied");
    expect((await sql`select 1 from oauth.audit where client_id = ${client.client_id} and kind = 'consent_denied'`).length).toBe(0);
  }, T);

  // SD-428: a staff hold stops everything with the member (docs/admin-console.md 3.7.1), and submit_profile
  // "never reaches a stopped or held one" (packages/mcp/src/tools.ts). Before the fix the hold changed only
  // the Network's trust state, so check_status still said "active" and submit_profile was accepted.
  test("a member on a staff hold reads on_hold and cannot submit a profile", async () => {
    const phone = newPhone(), b = new Browser();
    expect((await webJoin(st, "peon", phone, { age: 30, browser: b })).res.status).toBe(200);
    const c = await connectMcp(st, "peon", phone, { browser: b });
    expect(c.token?.access_token, c.html.slice(0, 300)).toBeString();
    const memberId = ((await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'peon' and ph.e164 = ${phone}`)[0] as { id: string }).id;
    const call = (name: string, args: Record<string, unknown> = {}) => rpc(st, "peon", "/mcp", "tools/call", { name, arguments: args }, c.token!.access_token).then(toolData);
    expect((await call("check_status")).status).toBe("active");

    expect(await (await st.staff("/apps/peon/safety/hold", { memberId, note: "report review" })).json()).toEqual({ ok: true });
    expect((await call("check_status")).status).toBe("on_hold");
    const sent = await call("submit_profile", { about: "I like long walks, chess in the park and Sunday coffee with friends." });
    expect(sent.submitted).toBe(false);
    expect(sent.status).toBe("on_hold");
  }, T);

  // SD-395: "At most 5 accepted profiles per grant a day" (packages/mcp/README.md section 2). Before the fix
  // the quota counted each well-formed call before the tool ran: five profiles refused because the person
  // had not joined yet used up the day, and the first profile after the join got 429.
  test("refused profiles do not use up the daily profile quota", async () => {
    const phone = newPhone(), b = new Browser();
    expect((await webJoin(st, "slop", phone, { age: 30, browser: b })).res.status).toBe(200);
    const c = await connectMcp(st, "peon", phone);
    expect(c.token?.access_token, c.html.slice(0, 300)).toBeString();
    const submit = () => rpc(st, "peon", "/mcp", "tools/call", { name: "submit_profile", arguments: { about: "Product designer, I like to mentor and to pair on side projects after work." } }, c.token!.access_token);
    for (let i = 0; i < 5; i++) {
      const r = await submit();
      expect(r.res.status).toBe(200);
      expect(toolData(r)).toMatchObject({ submitted: false, status: "not_joined" });
    }

    expect((await webJoin(st, "peon", phone, { age: 30, browser: b })).res.status).toBe(200);
    const r = await submit();
    expect(r.res.status).toBe(200);
    expect(toolData(r).submitted).toBe(true);
  }, T);

  // SD-393: "A sign-in request keeps the number only while it is open (at most 10 minutes, then swept)"
  // (packages/mcp/README.md section 3). Before the fix a request lived 15 minutes, and only an OAuth request
  // ran the sweep: with no MCP traffic the number stayed in oauth.auth_requests.
  // This test moves the clock 10 minutes, so it stays last in the file.
  test("a sign-in request with a number is swept 10 minutes after it starts, with no OAuth traffic", async () => {
    const phone = newPhone(), b = new Browser();
    const client = (await (await st.site("friends", "/oauth/register", { json: { client_name: "E2E Assistant", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" } })).json()) as { client_id: string };
    const q = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", state: "e2e", resource: `${st.sites.friends.origin}/mcp` });
    const rid = /name="rid" value="([^"]+)"/.exec(await (await st.site("friends", `/oauth/authorize?${q}`, { browser: b })).text())![1]!;
    expect((await st.site("friends", "/oauth/authorize/phone", { browser: b, form: { rid, phone } })).status).toBe(200);
    const stored = async () => (await sql`select 1 from oauth.auth_requests where id = ${rid} and e164 = ${phone}`).length;
    expect(await stored()).toBe(1);

    st.clock.advance(10 * 60_000 + 1_000);
    // Only the networks tick: no OAuth or MCP request reaches the server.
    for (const rt of st.svc.runtimes.values()) await rt.tick();
    expect(await stored()).toBe(0);
  }, T);
});
