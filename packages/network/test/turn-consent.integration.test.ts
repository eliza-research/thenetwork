// Integration: the signed turn and the consent ledger (machines signed-turn, consent-ledger,
// gateway-consent-mirror, stop-hint-window; docs/research/quint-findings/turn_consent.md).
// The real service on its own database on the local dev cluster (:54339), signed /internal/turn calls
// over HTTP. Only the OTP and provider boundaries are controlled; every send is dry-run.
import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {createHash, randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock, MINUTE, DAY} from "@thenetwork/core";
import {APPS} from "../../platform/src/apps.ts";
import {applySchema, devPgUp, DEV_PG_PORT} from "../../observatory/db/dev-pg.ts";
import {pgAvailable} from "../../observatory/test/pg.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {SET_STATE_PATH, SIGNALS_PATH, TURN_PATH, type TurnRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";
import {Inbox} from "../service/inbox.ts";

const user = process.env.USER ?? "postgres";
const db = `network_turn_consent_${randomUUID().replaceAll("-", "")}`;
const url = `postgres://${user}@127.0.0.1:${DEV_PG_PORT}/${db}`;
const secret = "synthetic-turn-consent-test-secret-20261108";
const clock = new SimClock(Date.UTC(2026, 10, 8, 16));
let admin: SQL, sql: SQL, service: NetworkService, server: ReturnType<typeof Bun.serve>;

const start = async () => {
  service = new NetworkService({url, clock, photoStorage: null, instance: "turn-consent-integration", tokens: "safety:saf-tok",
    env: {PLATFORM_ENV: "dev", PLATFORM_HASH_KEY: "synthetic-turn-consent-hash-key", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret},
    networks: [{id: "ntwrk:nyc", matchingEnabled: false}, {id: "slop:nyc", matchingEnabled: false}, {id: "friends:nyc", matchingEnabled: false}],
    network: {seed: 1}, publicApi: {minStartMs: 0, minVerifyMs: 0, otp: {name: "fixture", send: async () => ({code: "314159"})}},
    adapter: () => { const a = new DryRunAdapter(() => {}); a.direct = async () => "dry_run"; a.deliver = async rows => rows.map(r => ({id: r.id, status: "dry_run"})); return a; },
    log: () => {},
  });
  await service.start();
  server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: req => service.fetch(req)});
};
const turn = (id: string, from: string, text: string, app?: TurnRequest["app"]): TurnRequest =>
  ({messageId: id, from, text, channel: "blooio", to: null, transport: "imessage", receivedAt: clock.now(), ...(app ? {app} : {})});
const post = async (input: TurnRequest) => {
  const body = JSON.stringify(input);
  return fetch(new URL(TURN_PATH, server.url), {method: "POST", headers: {"content-type": "application/json",
    ...await svcSign(secret, {method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000)})}, body});
};
const phoneKey = (e164: string) => (service as unknown as {phoneKey(e: string): string}).phoneKey(e164);
/** A claim that committed for `input` in a process that then died: the row is "processing" and no worker renews it. */
const deadClaim = async (input: TurnRequest) => {
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  await sql`insert into platform.inbound(id,line,sender,received_at,arrived_at,event,status,request_hash,sender_hash)
    values (${`msg:${input.channel}:${input.messageId}`},null,null,${new Date(input.receivedAt)},${new Date(clock.now())},null,'processing',${digest},${phoneKey(input.from)})`;
};

describe.skipIf(!pgAvailable)("turn and consent", () => {
  beforeAll(async () => {
    await devPgUp();
    admin = new SQL({url: `postgres://${user}@127.0.0.1:${DEV_PG_PORT}/postgres`, max: 1});
    await admin.unsafe(`create database ${db}`);
    await applySchema(url, {lockTimeout: "5s"});
    sql = new SQL({url, max: 2});
    await start();
  }, 120_000);
  afterAll(async () => {
    server?.stop(true);
    await service?.close();
    await sql?.close();
    await admin?.unsafe(`drop database if exists ${db} with (force)`).catch(() => {});
    await admin?.close();
  });

  test("SD-001: a STOP whose worker died after its claim is run again on the gateway's retry, not refused", async () => {
    const phone = "+12125550201";
    const input = turn("sd001-stop", phone, "STOP");
    await deadClaim(input);
    // The gateway's retry inside the lease is told to wait; after the lease it must get the STOP handled.
    expect((await post(input)).status).toBe(409);
    clock.advance(3 * MINUTE);
    const r = await post(input);
    const body = await r.json() as any;
    expect([r.status, body.error]).toEqual([200, undefined]);
    expect(body.consent).toMatchObject({state: "opted_out", scope: "all", app: null});
    expect(body.replies.length).toBe(1);
    expect((await service.people.lastConsent(phone, "slop")).global?.state).toBe("opted_out");
    // The replay returns the same answer.
    expect(await (await post(input)).json()).toEqual(body);
  }, 60_000);

  test("SD-002: a STOP is handled while another turn of the sender is still processing", async () => {
    const phone = "+12125550202";
    // An ordinary turn of the sender holds its claim (running, or dead inside its lease).
    await deadClaim(turn("sd002-chat", phone, "what's new this week"));
    clock.advance(1000);
    const r = await post(turn("sd002-stop", phone, "STOP"));
    const body = await r.json() as any;
    expect([r.status, body.error]).toEqual([200, undefined]);
    expect(body.consent).toMatchObject({state: "opted_out", scope: "all", app: null});
    expect((await service.people.lastConsent(phone, "slop")).global?.state).toBe("opted_out");
    // An ordinary turn still waits for the running one.
    clock.advance(1000);
    expect(await (await post(turn("sd002-chat-2", phone, "hello?"))).json()).toEqual({error: "turn_busy", retryable: true});
  }, 60_000);
  test("SD-004: the 2-day retention purge does not cut the 30-day STOP hint gap", async () => {
    const phone = "+12125550204", hint = APPS.ntwrk.brand.stoppedHint;
    expect((await post(turn("sd004-stop", phone, "STOP"))).status).toBe(200);
    clock.advance(MINUTE);
    const first = await (await post(turn("sd004-hi", phone, "hi there"))).json() as any;
    expect(first.replies).toContain(hint);
    // The retention tick runs every minute in production (serve.ts startTicks).
    clock.advance(3 * DAY);
    await service.purge();
    const second = await (await post(turn("sd004-hi-again", phone, "hello again"))).json() as any;
    expect(second.outcome).toBe("handled");
    expect(second.replies).not.toContain(hint);
  }, 60_000);
  test("SD-023: a text join after STOP reports its opt-in to the gateway fence", async () => {
    const phone = "+12125550223";
    expect((await (await post(turn("sd023-stop", phone, "STOP"))).json() as any).consent).toMatchObject({state: "opted_out", scope: "all"});
    clock.advance(MINUTE);
    const r = await post(turn("sd023-join", phone, "Sam, 29"));
    const body = await r.json() as any;
    expect([r.status, body.reason]).toEqual([200, "joined"]);
    expect(await service.accounts.optedIn("ntwrk", phone)).toBe(true);
    // The gateway mirrors only the turn's consent field: without it, its fence keeps the STOP and blocks the welcome.
    expect(body.consent).toMatchObject({state: "opted_in", scope: "app", app: "ntwrk"});
  }, 60_000);
  test("SD-037: a late START from a non-member, older than a STOP, reports no opt-in", async () => {
    const phone = "+12125550237";
    const sentAt = clock.now();
    clock.advance(MINUTE);
    // The STOP was sent after the START but reaches the service first.
    expect((await (await post(turn("sd037-stop", phone, "STOP"))).json() as any).consent).toMatchObject({state: "opted_out", scope: "all"});
    clock.advance(MINUTE);
    const body = await (await post({...turn("sd037-start", phone, "START"), receivedAt: sentAt})).json() as any;
    expect(body.outcome).toBe("handled");
    expect(await service.accounts.optedIn("ntwrk", phone)).toBe(false);
    // The gateway copies the consent field into its fence: it must not say opted_in while the ledger says opted_out.
    expect(body.consent?.state).not.toBe("opted_in");
  }, 60_000);
  test("SD-104: an older STOP that arrives after a newer START leaves the member as the ledger reads", async () => {
    const phone = "+12125550104";
    expect((await (await post(turn("sd104-join", phone, "Sam, 29"))).json() as any).reason).toBe("joined");
    clock.advance(MINUTE);
    const stopSentAt = clock.now();
    clock.advance(MINUTE);
    expect((await post(turn("sd104-start", phone, "START"))).status).toBe(200);
    clock.advance(MINUTE);
    expect((await post({...turn("sd104-stop", phone, "STOP"), receivedAt: stopSentAt})).status).toBe(200);
    // The ledger orders by send time: the newer START wins for ntwrk.
    expect(await service.accounts.optedIn("ntwrk", phone)).toBe(true);
    const person = (await service.accounts.personFor(phone))!;
    const m = (await service.people.getMembership(person.id, "ntwrk"))!;
    expect(m.state).toBe("active");
    const [row] = await sql`select opted_out from network.members where app_id = 'ntwrk' and id = ${m.memberId}`;
    expect(row.opted_out).toBe(false);
  }, 60_000);
  test("SD-105: an older leave that arrives after a newer START is ordered by its own time", async () => {
    const phone = "+12125550105";
    expect((await (await post(turn("sd105-join", phone, "Sam, 29"))).json() as any).reason).toBe("joined");
    clock.advance(MINUTE);
    const leaveSentAt = clock.now();
    clock.advance(MINUTE);
    expect((await post(turn("sd105-start", phone, "START"))).status).toBe(200);
    clock.advance(MINUTE);
    const body = await (await post({...turn("sd105-leave", phone, "leave ntwrk"), receivedAt: leaveSentAt})).json() as any;
    // The gateway fence orders the leave by the time the person sent it.
    expect(body.consent).toMatchObject({state: "opted_out", scope: "app", app: "ntwrk", at: leaveSentAt});
    // The ledger orders by send time: the newer START wins, and the membership stays as the ledger reads.
    expect(await service.accounts.optedIn("ntwrk", phone)).toBe(true);
    const person = (await service.accounts.personFor(phone))!;
    expect((await service.people.getMembership(person.id, "ntwrk"))?.state).toBe("active");
  }, 60_000);
  test("SD-129: a legacy-webhook STOP is not dropped when the database fails for more than 5 ticks", async () => {
    const from = "+12125550129";
    // The handler fails while the database is down (6 ticks), then works again.
    let down = 6;
    const handled: string[] = [];
    const box = new Inbox({sql, clock, log: () => {}, senderKey: x => `key:${x}`,
      handle: async ev => { if (down > 0) { down--; throw new Error("synthetic database outage"); } handled.push(ev.text); return "handled"; }});
    const ev = {kind: "message", channel: "sim", messageId: "sd129-stop", from, to: "+12125550100", chatId: from, isGroup: false,
      text: "STOP", mediaUrls: [], transport: "imessage", receivedAt: clock.now()} as const;
    expect(await box.receive(ev as never)).toBe("retry_later");
    for (let tick = 0; tick < 6; tick++) { clock.advance(MINUTE); await box.drain(); }
    expect(handled).toEqual(["STOP"]);
    const [row] = await sql`select status from platform.inbound where id = 'msg:sim:sd129-stop'`;
    expect(row.status).toBe("done");
  }, 60_000);
  /** A friends member by text: the join, then the three interview answers. */
  const friendsByText = async (tag: string, phone: string, nameAge: string) => {
    for (const [i, text] of ["friends.help", nameAge, "I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"].entries()) {
      clock.advance(MINUTE);
      expect((await post(turn(`${tag}-setup-${i}`, phone, text, "friends"))).status).toBe(200);
    }
  };
  test("SD-212: a member whose first name is a city code does not silence the other members of that city", async () => {
    await friendsByText("sd212-nyc", "+12125550212", "Nyc, 29");
    const phone = "+12125552120";
    await friendsByText("sd212-bea", phone, "Bea, 31");
    clock.advance(MINUTE);
    const body = await (await post(turn("sd212-open", phone, "Tell me something about the weather", "friends"))).json() as any;
    expect([body.outcome, body.reason]).toEqual(["open", undefined]);
    expect(body.context.city).toBe("nyc");
  }, 60_000);
  test("SD-215: a compound first name that contains another member's first name still gets an open turn", async () => {
    await friendsByText("sd215-ann", "+12125550215", "Ann, 33");
    const phone = "+12125552150";
    const joined = await service.accounts.join(APPS.friends, {e164: phone, personId: null},
      {firstName: "Ann-Marie", age: 30, homeCity: "nyc", consent: {sms: true, version: APPS.friends.consent.version}});
    expect(joined.ok).toBe(true);
    for (const [i, text] of ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"].entries()) {
      clock.advance(MINUTE);
      expect((await post(turn(`sd215-setup-${i}`, phone, text, "friends"))).status).toBe(200);
    }
    clock.advance(MINUTE);
    const body = await (await post(turn("sd215-open", phone, "Tell me something about the weather", "friends"))).json() as any;
    expect([body.outcome, body.reason]).toEqual(["open", undefined]);
    expect(body.context.firstName).toBe("Ann-Marie");
  }, 60_000);
  test("SD-217: \"resume\" after a pause by text ends the pause", async () => {
    const phone = "+12125550217";
    await friendsByText("sd217", phone, "Dee, 29");
    clock.advance(MINUTE);
    const opened = await (await post(turn("sd217-open", phone, "pause for now", "friends"))).json() as any;
    expect(opened.outcome).toBe("open");
    // The agent records the pause the member asked for (no dates).
    const raw = JSON.stringify({channel: "blooio", messageId: "sd217-open", idempotencyKey: "sd217-pause", app: "friends", memberId: opened.memberId, state: "paused", from: null, until: null, note: null});
    const paused = await fetch(new URL(SET_STATE_PATH, server.url), {method: "POST", body: raw, headers: {"content-type": "application/json",
      ...await svcSign(secret, {method: "POST", path: SET_STATE_PATH, id: "sd217-pause", body: raw, nowS: Math.floor(clock.now() / 1000)})}});
    expect(paused.status).toBe(200);
    const state = async () => (await sql`select participation_state, participation_window from network.members where app_id = 'friends' and id = ${opened.memberId}`)[0];
    expect((await state()).participation_state).toBe("paused");
    clock.advance(14 * DAY);
    const resumed = await (await post(turn("sd217-resume", phone, "resume", "friends"))).json() as any;
    expect(resumed.outcome).toBe("handled");
    // The member asked to resume and was told "welcome back": the pause must end.
    expect(await state()).toEqual({participation_state: "normal", participation_window: null});
  }, 60_000);
  test("SD-073: a banned member's text is not stored, handled or answered", async () => {
    const phone = "+12125550073";
    expect((await (await post(turn("sd073-join", phone, "Sam, 29"))).json() as any).reason).toBe("joined");
    const person = (await service.accounts.personFor(phone))!;
    const m = (await service.people.getMembership(person.id, "ntwrk"))!;
    await service.people.ban({id: "ban_sd073", scope: "phone", personId: person.id, phoneHash: phoneKey(phone), reason: "test", reportId: null, bannedBy: "staff", at: clock.now()});
    clock.advance(MINUTE);
    const body = await (await post(turn("sd073-chat", phone, "hey, any plans for this weekend?"))).json() as any;
    expect(body.outcome).toBe("handled");
    expect(body.replies).toEqual([]);
    const stored = await sql`select id from network.messages where app_id = 'ntwrk' and member_id = ${m.memberId} and direction = 'inbound' and body like '%weekend%'`;
    expect(stored.length).toBe(0);
    // HELP is a compliance text and still answers.
    clock.advance(MINUTE);
    const help = await (await post(turn("sd073-help", phone, "HELP"))).json() as any;
    expect(help.replies).toEqual([APPS.ntwrk.brand.help]);
  }, 60_000);
  test("SD-087: a dead turn of a sender who never writes again leaves processing at the retention purge", async () => {
    const input = turn("sd087-chat", "+12125550087", "what's on tonight");
    await deadClaim(input);
    clock.advance(8 * DAY);
    await service.purge();
    const [row] = await sql`select status, sender_hash from platform.inbound where id = ${`msg:${input.channel}:${input.messageId}`}`;
    // The sender's keyed hash is not kept past the retention window; a replay of the turn is still refused.
    expect([row.status, row.sender_hash]).toEqual(["unresolved", null]);
    expect(await (await post(input)).json()).toEqual({error: "turn_unresolved", retryable: false});
  }, 60_000);
  test("SD-036: staff can decide an agent signal, and a decided signal leaves GET /signals", async () => {
    const phone = "+12125550036";
    for (const [i, text] of ["friends.help", "Ari, 29", "I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"].entries()) {
      clock.advance(MINUTE);
      expect((await post(turn(`sd036-setup-${i}`, phone, text, "friends"))).status).toBe(200);
    }
    clock.advance(MINUTE);
    const opened = await (await post(turn("sd036-open", phone, "Tell me something about the weather", "friends"))).json() as any;
    expect(opened.outcome).toBe("open");
    const raw = JSON.stringify({channel: "blooio", messageId: "sd036-open", app: "friends", memberId: opened.memberId, signals: [{kind: "safety_concern", evidence: "they mentioned feeling unsafe"}]});
    const recorded = await fetch(new URL(SIGNALS_PATH, server.url), {method: "POST", body: raw, headers: {"content-type": "application/json",
      ...await svcSign(secret, {method: "POST", path: SIGNALS_PATH, id: "sd036-open:signals", body: raw, nowS: Math.floor(clock.now() / 1000)})}});
    expect(await recorded.json()).toEqual({recorded: 1});
    const staff = (method: string, b?: object) => service.fetch(new Request("http://127.0.0.1/apps/friends/signals", {method,
      headers: {authorization: "Bearer saf-tok", ...(b ? {"content-type": "application/json"} : {})}, ...(b ? {body: JSON.stringify(b)} : {})}));
    const listed = (await (await staff("GET")).json() as any).signals as {id: string; kind: string}[];
    expect(listed.map(x => x.kind)).toEqual(["safety_concern"]);
    // Staff act on it and record the decision: it is no longer new.
    const decided = await staff("POST", {id: listed[0]!.id, decision: "confirmed"});
    expect([decided.status, await decided.json()]).toEqual([200, {ok: true}]);
    expect((await (await staff("GET")).json() as any).signals).toEqual([]);
    // A second decision on the same signal is refused.
    expect((await staff("POST", {id: listed[0]!.id, decision: "rejected"})).status).toBe(409);
  }, 60_000);
  test("SD-314: \"leave slop.date\" from a stranger leaves that app and does not start a join", async () => {
    const phone = "+12125550314";
    const body = await (await post(turn("sd314-leave", phone, "leave slop.date"))).json() as any;
    expect(body.outcome).toBe("handled");
    expect(body.reason).toBe("left");
    // No join ask, no pending join row: the person asked for less contact, not more.
    expect((await sql`select kind from platform.pending_texts where phone_hash = ${phoneKey(phone)}`).length).toBe(0);
    expect(body.consent).toMatchObject({state: "opted_out", scope: "app", app: "slop"});
    expect(await service.accounts.optedIn("slop", phone)).toBe(false);
  }, 60_000);
  test("SD-317: SHARE goes to the app that asked for it, also when another app wrote to the member last", async () => {
    const phone = "+12125550317";
    expect((await (await post(turn("sd317-join", phone, "Sam, 29"))).json() as any).reason).toBe("joined");
    // The member joins friends.help with the same number: friends asks to SHARE (the link notice).
    await friendsByText("sd317-friends", phone, "Sam, 29");
    const person = (await service.accounts.personFor(phone))!;
    expect((await sql`select app_id from platform.pending_texts where phone_hash = ${phoneKey(phone)} and kind = 'share'`).map((r: any) => r.app_id)).toEqual(["friends"]);
    // Then The Network writes to the member (a newer outbound on another app).
    clock.advance(MINUTE);
    const ntwrk = (await service.people.getMembership(person.id, "ntwrk"))!;
    await sql`insert into network.messages (id, app_id, member_id, direction, channel, body, status, proactive, system, ts)
      values ('sd317-out', 'ntwrk', ${ntwrk.memberId}, 'outbound', 'imessage', 'A note from The Network', 'sent', true, true, ${new Date(clock.now())})`;
    clock.advance(MINUTE);
    const body = await (await post(turn("sd317-share", phone, "SHARE"))).json() as any;
    expect(body.app).toBe("friends");
    expect((await sql`select from_app, to_app from platform.share_grants where person_id = ${person.id} and revoked_at is null`).map((r: any) => [r.from_app, r.to_app])).toEqual([["ntwrk", "friends"]]);
  }, 60_000);
  test("SD-318: START after a global STOP resumes the app that the STOP confirmation named", async () => {
    const phone = "+12125550318";
    expect((await (await post(turn("sd318-join", phone, "Sam, 29"))).json() as any).reason).toBe("joined");
    await friendsByText("sd318-friends", phone, "Sam, 29");
    const person = (await service.accounts.personFor(phone))!;
    // An open item on each app: The Network's first, then friends' (newer).
    for (const app of ["ntwrk", "friends"] as const) {
      clock.advance(MINUTE);
      const m = (await service.people.getMembership(person.id, app))!;
      await sql`insert into network.opportunities (app_id, id, kind, state, city, objective) values (${app}, ${`sd318-${app}`}, 'probe', 'proposed', 'nyc', 'sd318')`;
      await sql`insert into network.messages (id, app_id, member_id, direction, channel, body, status, opportunity_id, proactive, system, ts)
        values (${`sd318-out-${app}`}, ${app}, ${m.memberId}, 'outbound', 'imessage', 'An idea for you', 'sent', ${`sd318-${app}`}, true, false, ${new Date(clock.now())})`;
    }
    clock.advance(MINUTE);
    const stop = await (await post(turn("sd318-stop", phone, "STOP"))).json() as any;
    expect(stop.consent).toMatchObject({state: "opted_out", scope: "all"});
    expect(stop.replies).toEqual([APPS.friends.brand.stop]);
    clock.advance(MINUTE);
    const start = await (await post(turn("sd318-start", phone, "START"))).json() as any;
    // The STOP said "Reply START to resume Friends": START resumes that app.
    expect(start.consent).toMatchObject({state: "opted_in", scope: "app", app: "friends"});
    expect(await service.accounts.optedIn("friends", phone)).toBe(true);
  }, 60_000);
  test("SD-313: the replay of an open turn after a context change answers with the current context", async () => {
    const phone = "+12125550313";
    await friendsByText("sd313", phone, "Ivy, 29");
    clock.advance(MINUTE);
    const input = turn("sd313-open", phone, "Tell me something about the weather", "friends");
    const opened = await (await post(input)).json() as any;
    expect([opened.outcome, opened.context.state]).toEqual(["open", "open"]);
    // The gateway lost that answer. Meanwhile the agent records a pause the member asked for in another turn.
    const raw = JSON.stringify({channel: "blooio", messageId: "sd313-open", idempotencyKey: "sd313-pause", app: "friends", memberId: opened.memberId, state: "paused", from: null, until: null, note: null});
    const paused = await fetch(new URL(SET_STATE_PATH, server.url), {method: "POST", body: raw, headers: {"content-type": "application/json",
      ...await svcSign(secret, {method: "POST", path: SET_STATE_PATH, id: "sd313-pause", body: raw, nowS: Math.floor(clock.now() / 1000)})}});
    expect(paused.status).toBe(200);
    clock.advance(1000);
    // The gateway retries the same turn: the person must still get an answer, with the context as it is now.
    const r = await post(input);
    const body = await r.json() as any;
    expect([r.status, body.outcome, body.memberId]).toEqual([200, "open", opened.memberId]);
    expect(body.context.state).toBe("paused");
  }, 60_000);
  test("SD-433: a member's free-chat reply (an open turn) counts as a reply in the thread", async () => {
    const phone = "+12125550433";
    await friendsByText("sd433", phone, "Kai, 29");
    const person = (await service.accounts.personFor(phone))!;
    clock.advance(10 * MINUTE);
    const opened = await (await post(turn("sd433-open", phone, "Tell me something about the weather", "friends"))).json() as any;
    expect(opened.outcome).toBe("open");
    // The thread reply is recorded now: pending notify deliveries count as acted on and the channel is in use.
    const [signal] = await sql`select last_used_at from notify.surface_signals where person_id = ${person.id} and surface = 'imessage'`;
    expect(new Date(signal.last_used_at).getTime()).toBe(clock.now());
  }, 60_000);
  test("SD-490: \"leave slop\" during a pending slop join ends that join, so a later name does not join", async () => {
    const phone = "+12125550490";
    for (const [i, text] of ["slop.date", "29"].entries()) {
      clock.advance(MINUTE);
      expect((await (await post(turn(`sd490-${i}`, phone, text))).json() as any).reason).toBe("onboarding_asked");
    }
    clock.advance(MINUTE);
    const left = await (await post(turn("sd490-leave", phone, "leave slop"))).json() as any;
    expect([left.reason, left.consent?.state]).toEqual(["left", "opted_out"]);
    // The leave confirmation says what the person shared here is deleted: the pending join (with the age) goes too.
    expect((await sql`select kind from platform.pending_texts where phone_hash = ${phoneKey(phone)}`).length).toBe(0);
    clock.advance(MINUTE);
    const after = await (await post(turn("sd490-name", phone, "Sam"))).json() as any;
    expect(after.reason).not.toBe("joined");
    expect(await service.accounts.optedIn("slop", phone)).toBe(false);
  }, 60_000);
  test("SD-493: a signed STOP cancels the sender's older legacy-webhook rows that still wait", async () => {
    const from = "+12125550493";
    // During a cutover a legacy-webhook join answer failed once and waits for the next tick.
    let down = 1;
    const handled: string[] = [];
    const box = new Inbox({sql, clock, log: () => {}, senderKey: x => `key:${x}`,
      handle: async ev => { if (down > 0) { down--; throw new Error("synthetic database outage"); } handled.push(ev.text); return "handled"; }});
    const ev = {kind: "message", channel: "sim", messageId: "sd493-join", from, to: "+12125550100", chatId: from, isGroup: false,
      text: "Sam, 29", mediaUrls: [], transport: "imessage", receivedAt: clock.now()} as const;
    expect(await box.receive(ev as never)).toBe("retry_later");
    clock.advance(MINUTE);
    // Then the person's STOP arrives as a signed turn and is handled.
    const stop = turn("sd493-stop", from, "STOP");
    const r = await box.signed(stop, "sd493-hash", async () => ({outcome: "handled", replies: [], replyIds: [], delivery: "collected", replyKind: "compliance",
      accountEligible: false, app: null, memberId: null, reason: "stopped"}) as never);
    expect(r.status).toBe(200);
    // The next tick must not act on the join answer the person wrote before STOP.
    clock.advance(MINUTE);
    await box.drain();
    expect(handled).toEqual([]);
    const [row] = await sql`select status, outcome from platform.inbound where id = 'msg:sim:sd493-join'`;
    expect([row.status, row.outcome]).toEqual(["done", "cancelled_by_stop"]);
  }, 60_000);
  test("SD-496: a turn that renews its lease keeps its arrival time", async () => {
    const box = new Inbox({sql, clock, log: () => {}, senderKey: x => `key:${x}`, handle: async () => "handled", leaseRenewMs: 10});
    const input = turn("sd496-slow", "+12125550496", "what's on this weekend?");
    const arrival = clock.now();
    // A slow turn (an LLM read, lock waits): 45 s pass on the Clock and the lease is renewed while it runs.
    const r = await box.signed(input, "sd496-hash", async () => {
      clock.advance(45_000);
      await Bun.sleep(100);
      return {outcome: "handled", replies: [], replyIds: [], delivery: "collected", replyKind: "reply", accountEligible: false, app: null, memberId: null, reason: "handled"} as never;
    });
    expect(r.status).toBe(200);
    // Profile collection deadlines read arrived_at as the Network arrival: the lease must not move it.
    const [row] = await sql`select arrived_at from platform.inbound where id = 'msg:blooio:sd496-slow'`;
    expect(new Date(row.arrived_at).getTime()).toBe(arrival);
  }, 60_000);
  test("Q-turn_consent-1: a STOP whose claim staff resolve while it runs still answers its committed consent", async () => {
    const box = new Inbox({sql, clock, log: () => {}, senderKey: x => `key:${x}`, handle: async () => "handled"});
    const input = turn("q1-stop", "+12125559001", "STOP");
    const id = `msg:${input.channel}:${input.messageId}`;
    const at = clock.now();
    const r = await box.signed(input, "q1-hash", async t => {
      // The worker records the STOP in the ledger (as NetworkService.stop does); meanwhile staff resolve the turn.
      t.consent = {state: "opted_out", scope: "all", app: null, at};
      t.confirmation = {id: "sys:q1", body: APPS.ntwrk.brand.stop};
      expect(await box.resolve(id)).toBe(true);
      return {outcome: "handled", replies: [APPS.ntwrk.brand.stop], replyIds: ["sys:q1"], delivery: "collected", replyKind: "compliance",
        accountEligible: false, app: null, memberId: null, reason: "stopped", consent: t.consent} as never;
    });
    // The gateway mirrors only the answer's consent into its send-time fence: the committed STOP must reach it.
    const body = r.body as any;
    expect([r.status, body.error]).toEqual([200, undefined]);
    expect(body.consent).toMatchObject({state: "opted_out", scope: "all", app: null});
    expect(body.replies).toEqual([APPS.ntwrk.brand.stop]);
    // A retry of the same turn gets the same answer.
    expect(await box.signed(input, "q1-hash", async () => { throw new Error("not run again"); })).toEqual(r);
  }, 60_000);
  test("Q-turn_consent-2: a join answer older than a STOP that arrives after it leaves the member as the ledger reads", async () => {
    const phone = "+12125559002";
    const joinSentAt = clock.now();
    clock.advance(MINUTE);
    // The STOP was sent after the join answer but reaches the service first (the gateway retried the join).
    expect((await (await post(turn("q2-stop", phone, "STOP"))).json() as any).consent).toMatchObject({state: "opted_out", scope: "all"});
    clock.advance(MINUTE);
    const body = await (await post({...turn("q2-join", phone, "Sam, 29"), receivedAt: joinSentAt})).json() as any;
    expect(body.outcome).toBe("handled");
    // The ledger orders by send time: the newer STOP wins.
    expect(await service.accounts.optedIn("ntwrk", phone)).toBe(false);
    expect(body.consent?.state).not.toBe("opted_in");
    // The membership and the Network member follow the ledger, as after a STOP: paused and opted out.
    const person = (await service.accounts.personFor(phone))!;
    const m = (await service.people.getMembership(person.id, "ntwrk"))!;
    expect(m.state).toBe("paused");
    const [row] = await sql`select opted_out from network.members where app_id = 'ntwrk' and id = ${m.memberId}`;
    expect(row.opted_out).toBe(true);
  }, 60_000);
});
