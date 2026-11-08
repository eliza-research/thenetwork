// End to end: the consent, refresh and assistant-signal steps of an MCP OAuth grant (machines
// oauth-consent, oauth-refresh and oauth-grant in docs/research/state-machines/mcp-oauth.md). The whole
// stack runs as in production (harness.ts): sites, router, backend, platform API, MCP server, Postgres.
//   bun test tests/e2e/oauth-consent-refresh.e2e.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { sha256hex } from "../../packages/mcp/src/util.ts";
import { Browser, connectMcp, newPhone, pgAvailable, startStack, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
if (!pgAvailable && process.env.REQUIRE_PG === "1") throw new Error("tests/e2e needs Postgres (REQUIRE_PG=1)");

let st: Stack;
let sql: SQL;

describe.skipIf(!pgAvailable)("OAuth consent, refresh and assistant signals", () => {
  beforeAll(async () => {
    st = await startStack();
    sql = new SQL({ url: st.url, max: 3 });
  }, T);
  afterAll(async () => {
    await sql?.close();
    await st?.close();
  }, T);

  const auditKinds = async (grantId: string) =>
    ((await sql`select kind from oauth.audit where grant_id = ${grantId} order by id`) as { kind: string }[]).map(r => r.kind);

  // SD-185: a refresh that loses the race with a revocation is not a replay. Before the fix every false
  // result of rotateRefresh was a replay: the handler wrote a refresh_replay security event for a
  // refresh token that nobody used twice.
  test("a refresh that waits on a grant revoked meanwhile writes no refresh_replay row", async () => {
    const phone = newPhone(), b = new Browser();
    expect((await webJoin(st, "friends", phone, { age: 30, browser: b })).res.status).toBe(200);
    const c = await connectMcp(st, "friends", phone, { browser: b });
    expect(c.token?.refresh_token, c.html.slice(0, 300)).toBeString();
    const grantId = ((await sql`select grant_id from oauth.tokens where hash = ${sha256hex(c.token!.refresh_token)}`)[0] as { grant_id: string }).grant_id;

    let refresh: Promise<Response> | undefined;
    await sql.begin(async tx => {
      // The person's revocation holds the grant row while the refresh reaches it.
      await tx`select id from oauth.grants where id = ${grantId} for update`;
      refresh = st.site("friends", "/oauth/token", { form: { grant_type: "refresh_token", client_id: c.client.client_id, refresh_token: c.token!.refresh_token } });
      for (let i = 0; i < 200; i++) {
        const waiting = await sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`;
        if (waiting.length) break;
        await Bun.sleep(25);
      }
      await tx`update oauth.grants set revoked_at = ${new Date(st.clock.now())} where id = ${grantId}`;
      await tx`update oauth.tokens set revoked_at = ${new Date(st.clock.now())} where grant_id = ${grantId} and revoked_at is null`;
    });
    expect((await refresh!).status).toBe(400);
    expect(await auditKinds(grantId)).not.toContain("refresh_replay");
  }, T);

  const personOf = async (e164: string) =>
    ((await sql`select person_id from platform.phone_identities where e164 = ${e164}`)[0] as { person_id: string }).person_id;
  const claudeActive = async (personId: string) =>
    ((await sql`select active from notify.surface_signals where person_id = ${personId} and surface = 'claude'`)[0] as { active: boolean } | undefined)?.active;

  // SD-186: the assistant signal is per person and surface, but a grant is per app. Before the fix the
  // revocation of one Claude grant set the signal to inactive while another Claude grant was still live.
  test("revoking one of two live Claude grants keeps the Claude signal active", async () => {
    const phone = newPhone(), b = new Browser();
    expect((await webJoin(st, "slop", phone, { age: 30, browser: b })).res.status).toBe(200);
    const onSlop = await connectMcp(st, "slop", phone, { browser: b, redirect: CLAUDE });
    const onPeon = await connectMcp(st, "peon", phone, { browser: b, redirect: CLAUDE });
    expect(onSlop.token?.refresh_token, onSlop.html.slice(0, 300)).toBeString();
    expect(onPeon.token?.refresh_token, onPeon.html.slice(0, 300)).toBeString();
    const personId = await personOf(phone);
    expect(await claudeActive(personId)).toBe(true);

    const revoke = (app: "slop" | "peon", c: typeof onSlop) =>
      st.site(app, "/oauth/revoke", { form: { client_id: c.client.client_id, token: c.token!.refresh_token, token_type_hint: "refresh_token" } });
    expect((await revoke("slop", onSlop)).status).toBe(200);
    expect(await claudeActive(personId), "the peon grant is still live").toBe(true);
    expect((await revoke("peon", onPeon)).status).toBe(200);
    expect(await claudeActive(personId)).toBe(false);
  }, T);
});
