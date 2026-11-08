// End to end: the MCP tool calls and the sign-in request of an OAuth grant (machines oauth-tool-access,
// oauth-consent and auth-request in docs/research/state-machines/mcp-oauth.md). The whole stack runs as in
// production (harness.ts): sites, router, backend, platform API, MCP server, Postgres.
//   bun test tests/e2e/oauth-tools-and-sign-in.e2e.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { pkceS256, sha256hex } from "../../packages/mcp/src/util.ts";
import { Browser, connectMcp, newPhone, pgAvailable, REDIRECT, rpc, startStack, VERIFIER, webJoin, type Stack } from "./harness.ts";

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
});
