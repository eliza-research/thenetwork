import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../packages/core/src/svc/contract.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import type { Outbound } from "../../packages/network/service/channel.ts";
import type { NetworkRuntime } from "../../packages/network/service/runtime.ts";
import { connectMcp, newPhone, pgAvailable, rpc, startStack, toolData, TURN_SECRET, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
let st: Stack;
let sql: SQL;

describe.skipIf(!pgAvailable)("connector updates and grant cleanup", () => {
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
    (await sql`select m.id, m.person_id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id
      where m.app_id = ${app} and ph.e164 = ${e164}`)[0] as { id: string; person_id: string };
  const updates = async (token: string) =>
    toolData(await rpc(st, "peon", "/mcp", "tools/call", { name: "get_updates", arguments: {} }, token));
  const seenAt = async (personId: string, subjectId: string) =>
    (await sql`select seen_at from notify.inbox_items where person_id = ${personId} and subject_id = ${subjectId}`)[0]?.seen_at;

  test("a member whose age drops below 18 reads only their own updates, never one about another member", async () => {
    const phone = newPhone();
    const { b, res } = await webJoin(st, "peon", phone, { age: 30 });
    expect(res.status).toBe(200);
    const m = await member("peon", phone);
    await sql`insert into network.opportunities (id,app_id,kind,state,source,city,objective)
      values ('opp_minor_intro','peon','intro','PROPOSED','network','nyc','A work introduction')`;
    const intro: Outbound = { id: `minor-intro-${st.clock.now()}`, memberId: m.id as any, body: "Dev, a designer in Brooklyn, would like to meet. Interested?",
      kind: "proactive", type: "probe", oppId: "opp_minor_intro", proactive: true, system: false, ts: st.clock.now() };
    await st.svc.delivered(runtime("peon"), [intro]);
    await st.svc.notify!.add({ personId: m.person_id, app: "peon", eventType: "reminder", subjectId: "minor-own-reminder", urgency: "requested",
      summary: "Your resume workshop is on Saturday." }, st.clock.now());
    const c = await connectMcp(st, "peon", phone, { browser: b });
    expect(c.token?.access_token).toBeTypeOf("string");

    await sql`update network.members set age = 16 where person_id = ${m.person_id}::uuid`;
    const read = await updates(c.token!.access_token);
    expect(read.updates.map((u: { summary: string }) => u.summary)).toEqual(["Your resume workshop is on Saturday."]);
    expect(await seenAt(m.person_id, "minor-own-reminder")).not.toBeNull();
    expect((await sql`select seen_at from notify.inbox_items where person_id = ${m.person_id} and delivery_id = ${`net:${intro.id}`}`)[0].seen_at).not.toBeNull();
    expect((await updates(c.token!.access_token)).updates).toEqual([]);
  }, T);

  test("an update that fails the output leak gate is withheld and stays unseen", async () => {
    const phone = newPhone();
    const { b, res } = await webJoin(st, "peon", phone, { age: 30 });
    expect(res.status).toBe(200);
    const m = await member("peon", phone);
    await st.svc.notify!.add({ personId: m.person_id, app: "peon", eventType: "relay", subjectId: "leaky-relay", urgency: "requested",
      summary: "Dev says: text me at 415 555 0102." }, st.clock.now());
    await st.svc.notify!.add({ personId: m.person_id, app: "peon", eventType: "reminder", subjectId: "clean-reminder", urgency: "requested",
      summary: "Your call is tomorrow." }, st.clock.now());
    const c = await connectMcp(st, "peon", phone, { browser: b });
    const read = await updates(c.token!.access_token);
    expect(read.updates.map((u: { summary: string }) => u.summary)).toEqual(["Your call is tomorrow."]);
    expect(await seenAt(m.person_id, "clean-reminder")).not.toBeNull();
    expect(await seenAt(m.person_id, "leaky-relay")).toBeNull();
    expect((await updates(c.token!.access_token)).updates).toEqual([]);
    expect(await seenAt(m.person_id, "leaky-relay")).toBeNull();
  }, T);

  test("a leave whose grant cleanup fails is not completed, and a retry ends the app's grants", async () => {
    const phone = newPhone();
    const { b, res } = await webJoin(st, "peon", phone, { age: 30 });
    expect(res.status).toBe(200);
    const m = await member("peon", phone);
    const c = await connectMcp(st, "peon", phone, { browser: b });
    expect(c.token?.access_token).toBeTypeOf("string");
    const grants = async () => Number((await sql`select count(*)::int as n from oauth.grants where person_id = ${m.person_id} and app_id = 'peon'`)[0].n);
    const membership = async () => (await sql`select state from platform.memberships where person_id = ${m.person_id}::uuid and app_id = 'peon'`)[0]?.state;
    expect(await grants()).toBe(1);

    await sql.unsafe(`create function oauth.e2e_refuse_grant_delete() returns trigger language plpgsql as $$
      begin raise exception 'e2e: grant store unavailable'; end $$`);
    await sql.unsafe(`create trigger e2e_refuse_grant_delete before delete on oauth.grants
      for each row when (old.person_id = '${m.person_id}') execute function oauth.e2e_refuse_grant_delete()`);
    const failed = await st.site("peon", "/api/me/delete", { browser: b, json: { scope: "app" } });
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await grants()).toBe(1);
    expect(await membership()).toBe("active");

    await sql.unsafe(`drop trigger e2e_refuse_grant_delete on oauth.grants`);
    await sql.unsafe(`drop function oauth.e2e_refuse_grant_delete()`);
    const retried = await st.site("peon", "/api/me/delete", { browser: b, json: { scope: "app" } });
    expect(retried.status).toBe(200);
    expect(await grants()).toBe(0);
    expect(await membership()).toBe("removed");
    expect((await rpc(st, "peon", "/mcp", "tools/call", { name: "get_updates", arguments: {} }, c.token!.access_token)).res.status).toBe(401);
  }, T);

  test("a text leave whose grant cleanup fails is not stored as handled, and the gateway's retry of the same message ends the app's grants", async () => {
    const phone = newPhone();
    const { b, res } = await webJoin(st, "peon", phone, { age: 30 });
    expect(res.status).toBe(200);
    const m = await member("peon", phone);
    const c = await connectMcp(st, "peon", phone, { browser: b });
    expect(c.token?.access_token).toBeTypeOf("string");
    const grants = async () => Number((await sql`select count(*)::int as n from oauth.grants where person_id = ${m.person_id} and app_id = 'peon'`)[0].n);
    const membership = async () => (await sql`select state from platform.memberships where person_id = ${m.person_id}::uuid and app_id = 'peon'`)[0]?.state;
    const messageId = `text-leave-${st.clock.now()}`;
    const leave = async () => {
      const raw = JSON.stringify({ messageId, channel: "blooio", from: phone, to: null, text: "leave peon.biz", transport: "imessage", receivedAt: st.clock.now(), app: "peon" } satisfies TurnRequest);
      return st.svc.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", body: raw,
        headers: { "content-type": "application/json", ...await svcSign(TURN_SECRET, { method: "POST", path: TURN_PATH, id: messageId, body: raw, nowS: Math.floor(st.clock.now() / 1000) }) } }));
    };

    await sql.unsafe(`create function oauth.e2e_refuse_text_grant_delete() returns trigger language plpgsql as $$
      begin raise exception 'e2e: grant store unavailable'; end $$`);
    await sql.unsafe(`create trigger e2e_refuse_text_grant_delete before delete on oauth.grants
      for each row when (old.person_id = '${m.person_id}') execute function oauth.e2e_refuse_text_grant_delete()`);
    const failed = await leave();
    expect(failed.status).toBe(409);
    expect(await failed.json()).toEqual({ error: "turn_failed", retryable: true });
    expect(await grants()).toBe(1);
    expect(await membership()).toBe("active");

    await sql.unsafe(`drop trigger e2e_refuse_text_grant_delete on oauth.grants`);
    await sql.unsafe(`drop function oauth.e2e_refuse_text_grant_delete()`);
    const retried = await leave();
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ outcome: "handled" });
    expect(await grants()).toBe(0);
    expect(await membership()).toBe("removed");
    expect((await rpc(st, "peon", "/mcp", "tools/call", { name: "get_updates", arguments: {} }, c.token!.access_token)).res.status).toBe(401);
  }, T);
});
