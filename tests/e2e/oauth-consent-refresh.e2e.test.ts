// End to end: the consent, refresh and assistant-signal steps of an MCP OAuth grant (machines
// oauth-consent, oauth-refresh and oauth-grant in docs/research/state-machines/mcp-oauth.md). The whole
// stack runs as in production (harness.ts): sites, router, backend, platform API, MCP server, Postgres.
//   bun test tests/e2e/oauth-consent-refresh.e2e.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import type { Outbound } from "../../packages/network/service/channel.ts";
import type { NetworkRuntime } from "../../packages/network/service/runtime.ts";
import { pkceS256, sha256hex } from "../../packages/mcp/src/util.ts";
import { Browser, connectMcp, newPhone, pgAvailable, REDIRECT, rpc, signIn, startStack, toolData, VERIFIER, webJoin, type Stack } from "./harness.ts";

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

  // SD-214: a member who states an age under 18 is never connected to anyone (founder decision 1). Before
  // the fix an inbox item from their adult time, which names another person and a venue, stayed readable:
  // get_updates returned it after the member said they are 16.
  test("a member who becomes a minor does not read an earlier item that names an adult", async () => {
    const phone = newPhone(), b = new Browser();
    expect((await webJoin(st, "peon", phone, { age: 30, browser: b })).res.status).toBe(200);
    const m = (await sql`select m.id, m.person_id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'peon' and ph.e164 = ${phone}`)[0] as { id: string; person_id: string };
    const rt = [...st.svc.runtimes.values()].find(r => r.app.id === "peon") as NetworkRuntime;
    const sent: Outbound = { id: `e2e-reminder-${m.id}`, memberId: m.id as any, body: "Reminder: coffee with Sam at Blue Bottle on Bedford, 10am tomorrow.", kind: "proactive", type: "reminder", oppId: "opp_e2e_minor", proactive: true, system: false, ts: st.clock.now() };
    await st.svc.delivered(rt, [sent]);
    const c = await connectMcp(st, "peon", phone, { browser: b });
    expect(c.token?.access_token, c.html.slice(0, 300)).toBeString();

    await st.text(phone, "I am 16 years old");
    expect(((await sql`select lowest_age from platform.people where id = ${m.person_id}::uuid`)[0] as { lowest_age: number }).lowest_age).toBe(16);
    const r = toolData(await rpc(st, "peon", "/mcp", "tools/call", { name: "get_updates", arguments: {} }, c.token!.access_token));
    expect(r.updates).toEqual([]);
  }, T);

  // SD-384: a number change moves the person's grants to the new number's key. Before the fix the
  // grant's signup draft kept the old key, so the person could not open it on the new number.
  test("a signup draft follows its grant to the new number", async () => {
    const phone = newPhone(), next = newPhone(), b = new Browser();
    expect((await webJoin(st, "slop", phone, { age: 30, browser: b })).res.status).toBe(200);
    const c = await connectMcp(st, "friends", phone);
    expect(c.token?.access_token, c.html.slice(0, 300)).toBeString();
    const prepared = toolData(await rpc(st, "friends", "/mcp", "tools/call", { name: "prepare_signup", arguments: { firstName: "Rae" } }, c.token!.access_token));
    expect(prepared.prepared).toBe(true);

    st.clock.advance(31_000);
    expect((await st.site("slop", "/api/me/phone/start", { browser: b, json: { phone: next } })).status).toBe(200);
    expect((await st.site("slop", "/api/me/phone/confirm", { browser: b, json: { code: st.otp.last(next) } })).status).toBe(200);

    const onFriends = new Browser();
    await signIn(st, "friends", next, onFriends);
    const claim = await st.site("friends", "/oauth/signup-draft", { browser: onFriends, json: {} });
    expect(claim.status).toBe(200);
    expect(((await claim.json()) as { draft: unknown }).draft).toEqual({ firstName: "Rae" });
  }, T);

  // SD-389: an approval stores the grant, its code and the audit rows in one transaction. Before the fix
  // they were separate statements: when the code insert failed, a live grant stayed with no code and no
  // consent_granted row, and the approval was used up.
  test("a failed code insert stores no grant, and the person can approve again", async () => {
    const phone = newPhone(), b = new Browser();
    expect((await webJoin(st, "friends", phone, { age: 30, browser: b })).res.status).toBe(200);
    const client = (await (await st.site("friends", "/oauth/register", { json: { client_name: "E2E Assistant", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" } })).json()) as { client_id: string };
    const q = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", state: "e2e", resource: `${st.sites.friends.origin}/mcp` });
    const rid = /name="rid" value="([^"]+)"/.exec(await (await st.site("friends", `/oauth/authorize?${q}`, { browser: b })).text())![1]!;
    const approve = () => st.site("friends", "/oauth/authorize/consent", { browser: b, form: { rid, decision: "approve" } });
    const grants = async () => (await sql`select id from oauth.grants where client_id = ${client.client_id}`).length;

    await sql.unsafe(`create function oauth.e2e_code_fault() returns trigger language plpgsql as $$
      begin if NEW.client_id = '${client.client_id}' then raise exception 'synthetic code failure'; end if; return NEW; end $$;
      create trigger e2e_code_fault before insert on oauth.codes for each row execute function oauth.e2e_code_fault();`);
    try {
      expect((await approve()).status).toBe(500);
    } finally {
      await sql.unsafe("drop trigger e2e_code_fault on oauth.codes; drop function oauth.e2e_code_fault();");
    }
    expect(await grants()).toBe(0);

    const again = await approve();
    expect(again.status).toBe(303);
    expect(new URL(again.headers.get("location")!).searchParams.get("code")).toBeString();
    expect(await grants()).toBe(1);
  }, T);
});
