// End to end: the MCP tool calls and the sign-in request of an OAuth grant (machines oauth-tool-access,
// oauth-consent and auth-request in docs/research/state-machines/mcp-oauth.md). The whole stack runs as in
// production (harness.ts): sites, router, backend, platform API, MCP server, Postgres.
//   bun test tests/e2e/oauth-tools-and-sign-in.e2e.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { sha256hex } from "../../packages/mcp/src/util.ts";
import { Browser, connectMcp, newPhone, pgAvailable, rpc, startStack, webJoin, type Stack } from "./harness.ts";

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
});
