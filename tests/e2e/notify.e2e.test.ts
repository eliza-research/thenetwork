// The single inbox end to end (packages/notify; entry-flows doc 5): a member-facing send that went
// out is recorded once, the person's assistant reads it through the MCP get_updates tool (their own
// app only, then seen everywhere), the thread and the OAuth grant feed the surface signals, and the
// inbox's own sends go through the Network's consent-checked delivery. Needs the dev Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import type { Outbound } from "../../packages/network/service/channel.ts";
import type { NetworkRuntime } from "../../packages/network/service/runtime.ts";
import { connectMcp, newPhone, pgAvailable, rpc, startStack, toolData, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
let st: Stack;
let sql: SQL;

describe.skipIf(!pgAvailable)("the single inbox end to end", () => {
  beforeAll(async () => {
    st = await startStack();
    sql = new SQL({ url: st.url, max: 2 });
  }, T);
  afterAll(async () => {
    await sql?.close();
    await st?.close();
  }, T);

  const runtime = (app: string) => [...st.svc.runtimes.values()].find(r => r.app.id === app) as NetworkRuntime;
  const member = async (app: string, e164: string) =>
    (await sql`select m.id, m.person_id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`)[0] as { id: string; person_id: string };
  const updates = async (token: string, args: Record<string, unknown> = {}) =>
    toolData(await rpc(st, "peon", "/mcp", "tools/call", { name: "get_updates", arguments: args }, token));

  test("a delivered send is read once by the person's assistant, in its own app only", async () => {
    const phone = newPhone();
    const { b, res } = await webJoin(st, "peon", phone, { age: 30 });
    expect(res.status).toBe(200);
    const m = await member("peon", phone);
    const rt = runtime("peon");
    const sent: Outbound = { id: `e2e-send-${Date.now()}`, memberId: m.id as any, body: "A founder in Brooklyn is hiring a designer. Interested?", kind: "proactive", type: "probe", oppId: "opp_e2e_1", proactive: true, system: false, ts: st.clock.now() };
    await st.svc.delivered(rt, [sent, { ...sent, id: `${sent.id}-sys`, type: "system", system: true }]);
    // Recorded once, already delivered (the scheduler never texts it again).
    const rows = await sql`select i.app_id, i.notified_at, d.delivery_id from notify.inbox_items i join notify.deliveries d on d.delivery_id = i.delivery_id where i.person_id = ${m.person_id}`;
    expect(rows.length).toBe(1);
    expect(rows[0].delivery_id).toBe(`net:${sent.id}`);
    // Another app's item for the same person never shows on a peon grant.
    await st.svc.notify!.add({ personId: m.person_id, app: "slop", eventType: "probe", subjectId: "opp_other_app", urgency: "normal", summary: "Not for peon." }, st.clock.now());

    const c = await connectMcp(st, "peon", phone, { browser: b, redirect: CLAUDE });
    expect(c.token?.access_token).toBeTruthy();
    const signal = await sql`select surface, active from notify.surface_signals where person_id = ${m.person_id} and surface = 'claude'`;
    expect(signal[0]).toMatchObject({ surface: "claude", active: true });

    const first = await updates(c.token!.access_token);
    expect(first.updates.map((u: any) => u.summary)).toEqual(["A founder in Brooklyn is hiring a designer. Interested?"]);
    const again = await updates(c.token!.access_token);
    expect(again.updates).toEqual([]);
    const seen = await sql`select seen_on from notify.inbox_items where person_id = ${m.person_id} and app_id = 'peon'`;
    expect(seen[0].seen_on).toBe("claude");
    const other = await sql`select seen_at from notify.inbox_items where person_id = ${m.person_id} and app_id = 'slop'`;
    expect(other[0].seen_at).toBeNull();
    expect((await updates(c.token!.access_token, { update_token: "T-ZZZZZZ" })).updates).toEqual([]);
  }, T);

  test("a text from the member counts as using the thread; the inbox's own send goes through consent-checked delivery", async () => {
    const phone = newPhone();
    await webJoin(st, "peon", phone, { age: 30 });
    const m = await member("peon", phone);
    await st.text(phone, "hi, anything new?");
    const thread = await sql`select last_used_at from notify.surface_signals where person_id = ${m.person_id} and surface = 'imessage'`;
    expect(thread[0]?.last_used_at).toBeTruthy();

    await st.svc.notify!.add({ personId: m.person_id, app: "peon", eventType: "reminder", subjectId: "rem_e2e", urgency: "requested", summary: "Your call with Sam is at 3pm." }, st.clock.now());
    await st.svc.notifyTick();
    const msg = await sql`select body, type, status from network.messages where app_id = 'peon' and member_id = ${m.id} and type = 'notify'`;
    expect(msg.length).toBe(1);
    expect(msg[0].body).toBe("Your call with Sam is at 3pm.");
    // Recorded once: a second tick (or a second replica) sends nothing more.
    await st.svc.notifyTick();
    expect((await sql`select 1 from network.messages where app_id = 'peon' and member_id = ${m.id} and type = 'notify'`).length).toBe(1);
  }, T);
});
