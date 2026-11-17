// The single inbox end to end (packages/notify; entry-flows doc 5): a member-facing send that went
// out is recorded once, the person's assistant reads it through the MCP get_updates tool (their own
// app only, then seen everywhere), the thread and the OAuth grant feed the surface signals, and the
// inbox's own sends go through the Network's consent-checked delivery. Needs the dev Postgres.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest, type TurnResponse } from "../../packages/core/src/svc/contract.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import type { Outbound } from "../../packages/network/service/channel.ts";
import type { NetworkRuntime } from "../../packages/network/service/runtime.ts";
import { buttonPageLink } from "../../packages/notify/src/links.ts";
import { connectMcp, newPhone, pgAvailable, rpc, startStack, toolData, TURN_SECRET, webJoin, type Stack } from "./harness.ts";

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
    await sql`insert into network.opportunities (id,app_id,kind,state,source,city,objective) values
      ('opp_e2e_1','peon','intro','PROPOSED','network','nyc','A work introduction'),
      ('opp_e2e_closed','peon','intro','CANCELLED','network','nyc','A cancelled work introduction')`;
    const sent: Outbound = { id: `e2e-send-${Date.now()}`, memberId: m.id as any, body: "A founder in Brooklyn is hiring a designer. Interested?", kind: "proactive", type: "probe", oppId: "opp_e2e_1", proactive: true, system: false, ts: st.clock.now() };
    const second = { ...sent, id: `${sent.id}-second`, body: "The call is tomorrow.", acceptedAt: sent.ts + 1 };
    const closed = { ...sent, id: `${sent.id}-closed`, oppId: "opp_e2e_closed", body: "A cancelled work introduction." };
    await st.svc.delivered(rt, [sent, second, closed, { ...sent, id: `${sent.id}-sys`, type: "system", system: true }]);
    // Recorded once, already delivered (the scheduler never texts it again).
    const rows = await sql`select i.app_id, i.notified_at, d.delivery_id from notify.inbox_items i join notify.deliveries d on d.delivery_id = i.delivery_id where i.person_id = ${m.person_id}`;
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.delivery_id)).toEqual(expect.arrayContaining([`net:${sent.id}`, `net:${second.id}`, `net:${closed.id}`]));
    // Another app's item for the same person never shows on a peon grant.
    await st.svc.notify!.add({ personId: m.person_id, app: "slop", eventType: "probe", subjectId: "opp_other_app", urgency: "normal", summary: "Not for peon." }, st.clock.now());

    const c = await connectMcp(st, "peon", phone, { browser: b, redirect: CLAUDE });
    expect(c.token?.access_token).toBeTruthy();
    const signal = await sql`select surface, active from notify.surface_signals where person_id = ${m.person_id} and surface = 'claude'`;
    expect(signal[0]).toMatchObject({ surface: "claude", active: true });

    const tool = (await rpc(st, "peon", "/mcp", "tools/list")).body!.result.tools.find((t: any) => t.name === "get_updates");
    const unseen = await sql`select seen_at from notify.inbox_items where person_id = ${m.person_id} and app_id = 'peon'`;
    expect(unseen.map(row => row.seen_at)).toEqual([null, null, null]);
    const concurrent = await Promise.all([updates(c.token!.access_token), updates(c.token!.access_token)]);
    expect(concurrent.flatMap(result => result.updates.map((u: any) => u.summary))).toEqual([sent.body, second.body]);
    const firstUse = (await sql`select last_used_at from notify.surface_signals where person_id=${m.person_id} and surface='claude'`)[0].last_used_at;
    st.clock.advance(1000);
    const again = await updates(c.token!.access_token);
    expect(again.updates).toEqual([]);
    const secondUse = (await sql`select last_used_at from notify.surface_signals where person_id=${m.person_id} and surface='claude'`)[0].last_used_at;
    expect(new Date(secondUse).getTime()).toBeGreaterThan(new Date(firstUse).getTime());
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    const seen = await sql`select seen_on from notify.inbox_items where person_id = ${m.person_id} and app_id = 'peon'`;
    expect(seen.map(row => row.seen_on)).toEqual(["claude", "claude", "claude"]);
    const other = await sql`select seen_at from notify.inbox_items where person_id = ${m.person_id} and app_id = 'slop'`;
    expect(other[0].seen_at).toBeNull();
    expect((await updates(c.token!.access_token, { update_token: "T-ZZZZZZ" })).updates).toEqual([]);
  }, T);

  test("an assistant remains active until the person's last app grant for it ends", async () => {
    // spec/notificationDelivery.md, "One app's removal keeps an assistant active while another grant remains"
    const phone = newPhone();
    const peon = await webJoin(st, "peon", phone, { age: 30 });
    const friends = await webJoin(st, "friends", phone, { age: 30, browser: peon.b });
    expect(peon.res.status).toBe(200);
    expect(friends.res.status).toBe(200);
    const m = await member("friends", phone);
    const connect = (app: "peon" | "friends") => connectMcp(st, app, phone, { browser: peon.b, redirect: CLAUDE });
    const peonLink = await connect("peon");
    const friendsLink = await connect("friends");
    const active = async () => (await sql`select active from notify.surface_signals where person_id=${m.person_id} and surface='claude'`)[0]?.active;
    const revoke = (app: "peon" | "friends", connection: typeof peonLink) => st.site(app, "/oauth/revoke", {
      form: { token: connection.token?.refresh_token, client_id: connection.client.client_id },
    });
    const read = (app: "peon" | "friends", connection: typeof peonLink) =>
      rpc(st, app, "/mcp", "tools/call", { name: "get_updates", arguments: {} }, connection.token?.access_token);
    expect(peonLink.token?.access_token).toBeTypeOf("string");
    expect(friendsLink.token?.access_token).toBeTypeOf("string");
    expect(await active()).toBe(true);

    expect((await revoke("peon", peonLink)).status).toBe(200);
    expect((await read("peon", peonLink)).res.status).toBe(401);
    expect(await active()).toBe(true);
    expect((await read("friends", friendsLink)).res.status).toBe(200);

    await st.svc.notify!.add({ personId: m.person_id, app: "friends", eventType: "reminder", subjectId: "friend-app-signal", urgency: "requested", summary: "Your meetup is tomorrow." }, st.clock.now());
    const { sends } = await st.svc.notify!.plan(st.clock.now());
    expect(sends.find(send => send.personId === m.person_id)?.delivery).toMatchObject({ mode: "deeplink", assistant: "claude" });

    const newPeonLink = await connect("peon");
    expect(newPeonLink.token?.access_token).toBeTypeOf("string");
    expect((await st.site("friends", "/api/me/delete", { browser: friends.b, json: { scope: "app" } })).status).toBe(200);
    expect((await read("friends", friendsLink)).res.status).toBe(401);
    expect(await active()).toBe(true);
    expect((await read("peon", newPeonLink)).res.status).toBe(200);

    await st.svc.notify!.add({ personId: m.person_id, app: "peon", eventType: "reminder", subjectId: "peon-app-signal", urgency: "requested", summary: "Your call is tomorrow." }, st.clock.now());
    expect((await revoke("peon", newPeonLink)).status).toBe(200);
    expect(await active()).toBe(false);
    expect((await st.svc.notify!.plan(st.clock.now())).sends.find(send => send.personId === m.person_id)?.delivery.mode).toBe("thread");

    const expiring = await connect("peon");
    expect(expiring.token?.access_token).toBeTypeOf("string");
    expect(await active()).toBe(true);
    await sql`update oauth.grants set expires_at=${new Date(st.clock.now())} where client_id=${expiring.client.client_id}`;
    expect(await st.mcp.forgetPerson(m.person_id, "peon")).toBe(0);
    expect(await active()).toBe(false);
  }, T);

  test("assistant links require the digest's one app and a grant that can read it", async () => {
    // spec/notificationDelivery.md, "The text thread carries a digest one connector cannot read"
    // spec/notificationAcknowledgement.md, "Only a live update token of this member can resolve items"
    const phone = newPhone();
    const peon = await webJoin(st, "peon", phone, { age: 30 });
    const friends = await webJoin(st, "friends", phone, { age: 30, browser: peon.b });
    expect(peon.res.status).toBe(200);
    expect(friends.res.status).toBe(200);
    const { person_id: personId } = await member("friends", phone);
    const claude = await connectMcp(st, "peon", phone, { browser: peon.b, redirect: CLAUDE });
    expect(claude.token?.access_token).toBeTypeOf("string");
    const read = (app: "peon" | "friends", bearer: string, token?: string) => rpc(st, app, "/mcp", "tools/call", {
      name: "get_updates", arguments: token ? { update_token: token } : {},
    }, bearer);
    expect((await read("peon", claude.token!.access_token)).res.status).toBe(200);
    const now = () => st.clock.now();
    const add = (app: "peon" | "friends", subjectId: string, summary: string) =>
      st.svc.notify!.add({ personId, app, subjectId, eventType: "reminder", urgency: "requested", summary }, now());
    const selected = async () => (await st.svc.notify!.plan(now())).sends.find(send => send.personId === personId);

    const friendSummary = "Your hike leaves at ten.";
    await add("friends", "friend-only", friendSummary);
    expect(await selected()).toMatchObject({ delivery: { mode: "thread" }, text: friendSummary });

    const workSummary = "Your work call is tomorrow.";
    await add("peon", "mixed-work", workSummary);
    const mixed = await selected();
    if (!mixed) throw new Error("missing mixed digest");
    expect(mixed).toMatchObject({ delivery: { mode: "thread" } });
    expect(mixed?.token).toBeUndefined();
    expect(mixed?.text).toContain(friendSummary);
    expect(mixed?.text).toContain(workSummary);
    expect(mixed?.itemIds).toHaveLength(2);
    await st.svc.notifyTick();
    const delivered = await sql`select delivery_id, item_ids from notify.deliveries where person_id=${personId} and delivery_id=${mixed.deliveryId}`;
    expect(delivered).toHaveLength(1);

    const friendsClaude = await connectMcp(st, "friends", phone, { browser: friends.b, redirect: CLAUDE });
    expect(friendsClaude.token?.access_token).toBeTypeOf("string");
    const referenced = "Your interview moved to noon.";
    await add("peon", "peon-link", referenced);
    const own = await selected();
    if (!own) throw new Error("missing app digest");
    expect(own).toMatchObject({ delivery: { mode: "deeplink", assistant: "claude" }, token: expect.any(String) });
    await st.svc.notifyTick();
    const [text] = await sql`select body from network.messages where id=${own.deliveryId}`;
    const token = /T-[2-9A-HJKMNP-TV-Z]{6}/.exec(text?.body ?? "")?.[0];
    if (!token) throw new Error("missing update reference");
    expect(toolData(await read("friends", friendsClaude.token!.access_token, token)).updates).toEqual([]);
    expect((await sql`select redeemed_at from notify.task_tokens where token=${token}`)[0]?.redeemed_at).toBeNull();
    expect((await sql`select outcome from notify.deliveries where delivery_id=${own.deliveryId}`)[0]?.outcome).toBeNull();
    expect(toolData(await read("peon", claude.token!.access_token, token)).updates).toEqual([
      { summary: referenced, kind: "reminder", at: expect.any(String) },
    ]);
    expect((await sql`select redeemed_at from notify.task_tokens where token=${token}`)[0]?.redeemed_at).not.toBeNull();
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

  test("the public SMS handoff fills an assistant prompt without opening or revealing the update", async () => {
    // spec/sitePages.md, "The update handoff accepts only a canonical reference on the hub"
    const phone = newPhone();
    const { b, res } = await webJoin(st, "peon", phone, { age: 30 });
    expect(res.status).toBe(200);
    const { person_id: personId } = await member("peon", phone);
    const summary = "Your interview is at the Greenpoint library.";
    const notify = st.svc.notify!;
    const now = st.clock.now();
    const { item } = await notify.add({ personId, app: "peon", eventType: "reminder", subjectId: "sms-handoff", urgency: "requested", summary }, now);
    const reference = "T-7F3K9Q";
    expect(await notify.store.insertToken({ token: reference, personId, itemIds: [item.id], issuedAt: now, expiresAt: now + 60_000 })).toBe(true);
    const { pathname } = new URL(buttonPageLink(reference));

    const page = await st.site("ntwrk", `${pathname}?redirect=https://outside.invalid`);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(page.headers.has("set-cookie")).toBe(false);
    expect(page.headers.has("location")).toBe(false);
    const html = await page.text();
    expect(html).not.toMatch(/<script|outside\.invalid|T-ZZZZZZ/i);
    expect(html).not.toContain(summary);
    expect(html).not.toContain(personId);
    const prompt = encodeURIComponent(`Ask The Network for update ${reference}`);
    for (const href of [`https://chatgpt.com/?prompt=${prompt}`, `https://claude.ai/new?q=${prompt}`, `https://grok.com/?q=${prompt}`]) {
      expect(html).toContain(`href="${href}"`);
    }
    const unknown = "T-AAAAAA";
    expect(await (await st.site("ntwrk", `/t/${unknown}`)).text()).toBe(html.replaceAll(reference, unknown));
    const head = await st.site("ntwrk", pathname, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const post = await st.site("ntwrk", pathname, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    expect((await st.site("peon", pathname)).status).toBe(404);
    for (const bad of ["/t", "/t/", "/t/t-7f3k9q", `${pathname}/`, `${pathname}%3C`, "/_update-handoff.html", "/%5Fupdate-handoff.html"]) {
      expect((await st.site("ntwrk", bad)).status, bad).toBe(404);
    }
    expect((await sql`select redeemed_at from notify.task_tokens where token=${reference}`)[0]?.redeemed_at).toBeNull();

    const connected = await connectMcp(st, "peon", phone, { browser: b, redirect: CLAUDE });
    const bearer = connected.token?.access_token;
    if (!bearer) throw new Error("missing authorized connector");
    expect((await updates(bearer, { update_token: reference })).updates).toEqual([
      { summary, kind: "reminder", at: expect.any(String) },
    ]);
  }, T);

  test("signed shared texts page the member's current inbox and stop stale private replies from replaying", async () => {
    const from = newPhone();
    const peon = await webJoin(st, "peon", from, { age: 30 });
    expect(peon.res.status).toBe(200);
    expect((await webJoin(st, "friends", from, { age: 30, browser: peon.b })).res.status).toBe(200);
    const { person_id: personId } = await member("peon", from);
    const first = "Your hike starts at noon.";
    const second = "Your work call moved to Wednesday.";
    const third = "Your picnic is in Fort Greene.";
    const fourth = "Your interview has a new room.";
    const scoped = "A new update about your hike is ready.";
    const notify = st.svc.notify!;
    const now = st.clock.now();
    const add = (app: "peon" | "friends", subjectId: string, summary: string, expiresAt?: number) =>
      notify.add({personId, app, eventType: "reminder", subjectId, summary, urgency: "requested", expiresAt}, now);
    await add("friends", "thread-first", first);
    await add("peon", "thread-second", second);
    await add("friends", "thread-third", third);
    const { item: rest } = await add("peon", "thread-fourth", fourth);
    await add("peon", "thread-expired", "An expired update.", now);
    await sql`insert into network.opportunities (id,app_id,kind,state,source,city,objective) values
      ('thread-closed','peon','intro','CANCELLED','network','nyc','A cancelled work introduction')`;
    await add("peon", "thread-closed", "A closed opportunity.");

    const turn = (messageId: string, text = "updates", app?: "peon" | "friends"): TurnRequest => ({
      channel: "twilio", transport: "sms", messageId, from, to: null, text, receivedAt: st.clock.now(), ...(app ? {app} : {}),
    });
    const post = async (input: TurnRequest) => {
      const body = JSON.stringify(input);
      const headers = await svcSign(TURN_SECRET, {method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(st.clock.now()/1000)});
      const res = await fetch(new URL(TURN_PATH, st.backendOrigin), {method: "POST", headers: {...headers, "content-type": "application/json"}, body});
      return {status: res.status, body: await res.json() as TurnResponse | {error: string}};
    };
    const original = turn("thread-updates-1", "  UpDaTeS  ");
    const firstPage = await post(original);
    expect(firstPage).toMatchObject({status: 200, body: {outcome: "handled", reason: "inbox_updates", replies: [
      `${first}\n${second}\n${third}\n+1 more. Reply "updates" to see them.`,
    ]}});
    const unseen = () => notify.store.unseen(personId, now);
    expect((await unseen()).map(item => item.id)).toEqual([rest.id]);
    expect(await sql`select 1 from notify.inbox_items where person_id=${personId} and seen_on='sms'`).toHaveLength(4);
    const history = await sql`select body from network.messages where type='inbox_updates' and inbound_id='msg:twilio:thread-updates-1'`;
    expect([...history]).toEqual([{body: "Private inbox updates reply."}]);

    await add("friends", "thread-scoped", scoped);
    expect(await post(original)).toEqual(firstPage);
    expect(await post(turn("thread-updates-dedicated", "updates", "peon"))).toMatchObject({status: 200, body: {replies: [fourth]}});
    expect((await unseen()).map(item => item.summary)).toEqual([scoped]);
    expect(await post(turn("thread-updates-2"))).toMatchObject({status: 200, body: {replies: [scoped]}});
    expect(await post(turn("thread-updates-empty"))).toMatchObject({status: 200, body: {replies: ["You have no new updates from The Network."]}});
    expect(await post({...turn("thread-updates-unknown"), from: newPhone()})).toMatchObject({status: 200, body: {reason: "inbox_updates", replies: []}});

    const { id: friendsMember } = await member("friends", from);
    await sql`update network.members set opted_out=true where app_id='friends' and id=${friendsMember}`;
    await sql`update platform.memberships set state='paused' where app_id='friends' and person_id=${personId}`;
    await sql`insert into network.messages (id,app_id,member_id,direction,channel,body,status,ts)
      values ('newest-paused-thread','friends',${friendsMember},'outbound','imessage','An earlier Friends message.','dry_run',${new Date(now + 1)})`;
    const eligible = "Your work call has a new time.";
    await add("peon", "active-other-thread", eligible);
    expect(await post(turn("thread-updates-paused", "updates", "friends"))).toMatchObject({status: 200, body: {replies: []}});
    expect(await post(turn("thread-updates-active-elsewhere"))).toMatchObject({status: 200, body: {app: "peon", replies: [eligible]}});
    await sql`update platform.memberships set state='active' where app_id='friends' and person_id=${personId}`;
    await sql`update network.members set opted_out=false where app_id='friends' and id=${friendsMember}`;

    const preview = ["Your first digest summary.", "Your second digest summary.", "Your third digest summary.", "Your remaining digest summary."];
    for (const [index, summary] of preview.entries()) await add("peon", `thread-preview-${index}`, summary);
    const digest = (await notify.plan(now)).sends.find(send => send.personId === personId);
    if (!digest) throw new Error("missing queued digest");
    await st.svc.notifyTick();
    const [message] = await sql`select body,app_id,member_id from network.messages where id=${digest.deliveryId}`;
    expect(message?.body).toEqual(`${preview.slice(0, 3).join("\n")}\n+1 more. Reply "updates" to see them.`);
    const acceptedAt = new Date(now);
    await sql`insert into platform.outbound (id,app_id,member_id,line,to_address,kind,body,fingerprint,time_zone,status,
        next_attempt_at,created_at,updated_at,sent_at)
      values (${digest.deliveryId},${message.app_id},${message.member_id},'+12125550388',${from},'transactional',${message.body},
        ${digest.deliveryId},'America/New_York','sent',${acceptedAt},${acceptedAt},${acceptedAt},${acceptedAt})`;
    expect(await post(turn("thread-updates-overflow"))).toMatchObject({status: 200, body: {replies: [preview[3]]}});
    expect((await unseen()).map(item => item.summary)).toEqual(preview.slice(0, 3));

    if (!("outcome" in firstPage.body) || firstPage.body.outcome !== "handled") throw new Error("missing shared thread app");
    const otherApp = firstPage.body.app === "peon" ? "friends.help" : "peon.biz";
    expect(await post(turn("thread-updates-leave", `leave ${otherApp}`))).toMatchObject({status: 200, body: {consent: {state: "opted_out", scope: "app"}}});
    expect(await post(original)).toMatchObject({status: 409, body: {error: "turn_inbox_updates_changed"}});

    const current = turn("thread-updates-current");
    expect(await post(current)).toMatchObject({status: 200, body: {reason: "inbox_updates", replies: ["You have no new updates from The Network."]}});
    expect(await post(turn("thread-updates-stop", "STOP"))).toMatchObject({status: 200, body: {consent: {state: "opted_out", scope: "all"}}});
    expect(await post(current)).toMatchObject({status: 409, body: {error: "turn_inbox_updates_changed"}});
  }, T);
});
