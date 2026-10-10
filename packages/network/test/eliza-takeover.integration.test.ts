// The Eliza seam from the service side: the cases of the upstream gateway test
// (elizaOS/eliza spike/network-plugin, packages/cloud/services/gateway-webhook/__tests__/network-takeover.test.ts),
// driven against the real service over HTTP with signed requests and a real Postgres (dev-pg, :54339).
// Sends are dry-run; a fake Cloud deliver endpoint records anything that would leave, and must stay empty.
import {afterAll, beforeAll, expect, test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock, MINUTE} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {APPS} from "../../platform/src/apps.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH, DELIVER_PATH, RELAY_PATH, type RelaySendRequest, type RelaySendResponse, type TurnRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";
import {ELIZA_NOTICE, ELIZA_NOTICE_STATUS} from "../src/copy.ts";

const db = `network_eliza_takeover_${randomUUID().replaceAll("-", "")}`;
const admin = new SQL({url: `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/postgres`, max: 1});
const url = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/${db}`;
const secret = "synthetic-eliza-takeover-test-secret-20261009";
const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
const ONBOARDING = ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"];
let sql: SQL, service: NetworkService, server: ReturnType<typeof Bun.serve>, cloud: ReturnType<typeof Bun.serve>;
let escaped = 0;
const cloudCalls: string[] = [];
let seq = 0;

const env = (extra: Record<string, string> = {}) => ({PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret, NETWORK_CLOUD_DELIVERY_ORIGIN: cloud.url.origin, ...extra});
beforeAll(async () => {
  await admin.unsafe(`create database ${db}`);
  console.info(`[owned-db] ${db}`);
  await applySchema(url, {lockTimeout: "5s"});
  sql = new SQL({url, max: 2});
  cloud = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: req => { cloudCalls.push(new URL(req.url).pathname); return Response.json({ok: false, error: "rejected", retryable: false}); }});
  service = new NetworkService({url, clock, photoStorage: null, instance: "eliza-takeover-integration", env: env(),
    networks: [{id: "ntwrk:nyc", matchingEnabled: false}, {id: "slop:nyc", matchingEnabled: false}, {id: "friends:nyc", matchingEnabled: false}],
    network: {seed: 1}, notify: false, log: () => {},
    adapter: () => { const a = new DryRunAdapter(() => {}); a.direct = async () => { escaped++; return "dry_run"; }; a.deliver = async rows => { escaped += rows.length; return rows.map(r => ({id: r.id, status: "dry_run"})); }; return a; },
  });
  await service.start();
  server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: req => service.fetch(req)});
}, 120_000);
afterAll(async () => { server?.stop(true); cloud?.stop(true); await service?.close(); await sql?.close(); await admin.close(); });

const turn = (from: string, text: string, o: {app?: TurnRequest["app"]; receivedAt?: number; id?: string} = {}): TurnRequest =>
  ({messageId: o.id ?? `SMtk${++seq}`, channel: "blooio", from, to: null, text, transport: "imessage", receivedAt: o.receivedAt ?? clock.now(), ...(o.app ? {app: o.app} : {})});
const post = async (input: TurnRequest, o: {key?: string; body?: string} = {}) => {
  const body = o.body ?? JSON.stringify(input);
  const headers = await svcSign(o.key ?? secret, {method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000)});
  return fetch(new URL(TURN_PATH, server.url), {method: "POST", headers: {"content-type": "application/json", ...headers}, body});
};
const say = async (from: string, text: string, o: {app?: TurnRequest["app"]; receivedAt?: number} = {}) => {
  const r = await post(turn(from, text, o));
  expect(r.status).toBe(200);
  clock.advance(MINUTE);
  return r.json() as Promise<any>;
};
/** Join friends by text and answer its first questions; returns the member id. */
const joinFriends = async (phone: string, name: string, age: number) => {
  expect((await say(phone, "friends.help", {app: "friends"})).reason).toBe("onboarding_asked");
  const joined = await say(phone, `${name}, ${age}`, {app: "friends"});
  expect(joined.reason).toBe("joined");
  for (const text of ONBOARDING) await say(phone, text, {app: "friends"});
  return joined.memberId as string;
};
const noticeRows = async () => (await sql`select phone_hash from platform.eliza_notices`).map((r: any) => r.phone_hash as string);

test("the notice copy is a draft until the founder approves it", () => {
  expect(ELIZA_NOTICE_STATUS).toBe("DRAFT");
  expect(ELIZA_NOTICE).toContain("STOP");
  expect(ELIZA_NOTICE.length).toBeLessThanOrEqual(360);
});

test("a non-member gets the one-time notice, then the join flow; the number is stored only as a keyed hash", async () => {
  const phone = "+12125550201", before = escaped;
  const first = await say(phone, "hi");
  expect(first.outcome).toBe("handled");
  expect(first.reason).toBe("onboarding_asked");
  expect(first.replies[0]).toBe(ELIZA_NOTICE);
  expect(first.replies.length).toBe(2);
  expect(first.replyIds.length).toBe(2);
  expect(first.accountEligible).toBe(false);
  expect(first.replyKind).toBe("reply");
  expect(first.memberId).toBeNull();
  // The trusted join prompt can be accepted without making an Eliza account.
  const receiptBody = JSON.stringify({channel: "blooio", messageId: `SMtk${seq}`, replyIds: first.replyIds,
    outcome: "accepted", providerMessageIds: ["synthetic-onboarding-receipt"], historyRecorded: false});
  const receiptHeaders = await svcSign(secret, {method: "POST", path: "/internal/turn-receipt", id: `SMtk${seq}:receipt`, body: receiptBody, nowS: Math.floor(clock.now() / 1000)});
  const accepted = await fetch(new URL("/internal/turn-receipt", server.url), {method: "POST", headers: {"content-type": "application/json", ...receiptHeaders}, body: receiptBody});
  expect(accepted.status).toBe(200);
  expect((await sql`select receipt->>'historyRecorded' as history from platform.inbound where id=${`msg:blooio:SMtk${seq}`}`)[0].history).toBe("false");
  const rows = await noticeRows();
  expect(rows.length).toBe(1);
  expect(rows[0]).not.toContain(phone.slice(1));
  // Once per number: the next message gets the join flow only.
  const secondInput = turn(phone, "hello?");
  const second = await (await post(secondInput)).json() as any;
  expect(second.replies).not.toContain(ELIZA_NOTICE);
  expect((await noticeRows()).length).toBe(1);
  // Nothing is enrolled by the notice.
  expect((await sql`select 1 from platform.phone_identities where e164 = ${phone}`).length).toBe(0);
  expect(escaped).toBe(before);
  // An unsent cached prompt loses admission after a canonical under-13 floor.
  await service.accounts.recordAge(phone, undefined, 12);
  expect((await post(secondInput)).status).toBe(409);
  expect((await sql`select 1 from platform.phone_identities where e164 = ${phone}`).length).toBe(0);
}, 60_000);

test("an under-13 first contact gets only the kind decline, and nothing is stored", async () => {
  const phone = "+12125550202";
  const r = await say(phone, "Sam, 12");
  expect(r.reason).toBe("under_age");
  expect(r.replies).toEqual([APPS.ntwrk.brand.underAge]);
  expect(r.accountEligible).toBe(false);
  const again = await say(phone, "hi");
  expect(again.reason).not.toBe("onboarding_asked");
  expect(again.accountEligible).toBe(false);
  expect((await noticeRows()).length).toBe(1);
  expect((await sql`select 1 from platform.phone_identities where e164 = ${phone}`).length).toBe(0);
}, 60_000);

test("join keyword, onboarding answer, then an open turn for the member with strict context", async () => {
  const phone = "+12125550203";
  const keyword = await say(phone, "friends.help", {app: "friends"});
  expect(keyword.reason).toBe("onboarding_asked");
  expect(keyword.replies[0]).toBe(ELIZA_NOTICE);
  const answer = await say(phone, "Noa, 29", {app: "friends"});
  expect(answer.outcome).toBe("handled");
  expect(answer.reason).toBe("joined");
  expect(answer.replies).not.toContain(ELIZA_NOTICE);
  // A member welcome cannot use the account-free prompt's no-history receipt.
  const noHistory = JSON.stringify({channel: "blooio", messageId: `SMtk${seq}`, replyIds: answer.replyIds,
    outcome: "accepted", providerMessageIds: ["synthetic-normal-receipt"], historyRecorded: false});
  const noHistoryHeaders = await svcSign(secret, {method: "POST", path: "/internal/turn-receipt", id: `SMtk${seq}:receipt`, body: noHistory, nowS: Math.floor(clock.now() / 1000)});
  expect((await fetch(new URL("/internal/turn-receipt", server.url), {method: "POST", headers: {"content-type": "application/json", ...noHistoryHeaders}, body: noHistory})).status).toBe(400);
  for (const text of ONBOARDING) await say(phone, text, {app: "friends"});
  const open = await say(phone, "Tell me something about the weather", {app: "friends"});
  expect(open.outcome).toBe("open");
  expect(open.app).toBe("friends");
  expect(open.memberId).toBe(answer.memberId);
  expect(open.context.singlePlayer).toBe(false);
  expect(open.context.facets.length).toBeLessThanOrEqual(50);
  for (const f of open.context.facets) expect(f.length).toBeLessThanOrEqual(300);
  expect(open.context.activeItems === null || open.context.activeItems.length <= 20).toBe(true);
}, 60_000);

test("RELAY (upstream RelaySendRequest) on an open turn: no match, an unknown item and no request send nothing", async () => {
  const phone = "+12125550219";
  expect((await say(phone, "friends.help", {app: "friends"})).reason).toBe("onboarding_asked");
  const joined = await say(phone, "Ira, 33", {app: "friends"});
  for (const text of ONBOARDING) await say(phone, text, {app: "friends"});
  // The relay text is the open turn's own message (the service binds it); the response, or the status when refused.
  const post = async (text: string, itemId: string | null = null) => {
    const open = await say(phone, text, {app: "friends"});
    expect(open.outcome).toBe("open");expect(open.memberId).toBe(joined.memberId);
    const req: RelaySendRequest = {channel: "blooio", messageId: `SMtk${seq}`, app: open.app, memberId: open.memberId, itemId, text};
    const body = JSON.stringify(req);
    const headers = await svcSign(secret, {method: "POST", path: RELAY_PATH, id: `${req.messageId}:relay`, body, nowS: Math.floor(clock.now() / 1000)});
    return fetch(new URL(RELAY_PATH, server.url), {method: "POST", headers: {"content-type": "application/json", ...headers}, body});
  };
  const relay = async (text: string) => { const r = await post(text); expect(r.status).toBe(200); return r.json() as Promise<RelaySendResponse>; };
  const noMatch = await relay("tell them I'm running late");
  expect(noMatch).toMatchObject({decision: "block", delivered: false, replayed: false});
  expect(noMatch.senderNotice).not.toContain("running late");
  // An item the open turn did not offer is refused before anything runs.
  expect((await post("tell them I'm running late", "an-item-nobody-listed")).status).toBe(403);
  expect(await relay("what a nice day")).toEqual({decision: "none", senderNotice: "", delivered: false, replayed: false});
}, 60_000);

test("HELP, STOP with scope all, an older START that loses, START, and leave <app> with scope app", async () => {
  const phone = "+12125550204", before = escaped;
  await joinFriends(phone, "Ari", 31);
  const help = await say(phone, "HELP", {app: "friends"});
  expect(help.outcome).toBe("handled");
  expect(help.replies).toEqual([APPS.friends.brand.help]);
  expect(help.consent).toBeUndefined();

  const stopAt = clock.now();
  const stop = await say(phone, "STOP", {receivedAt: stopAt});
  expect(stop.outcome).toBe("handled");
  expect(stop.replies.length).toBe(1);
  expect(stop.consent).toEqual({state: "opted_out", scope: "all", app: null, at: stopAt});
  expect(await service.accounts.optedIn("friends", phone)).toBe(false);

  // A START the person sent before the STOP arrives late (a gateway retry): it never undoes the newer STOP.
  const late = await say(phone, "START", {app: "friends", receivedAt: stopAt - 30_000});
  expect(late.outcome).toBe("handled");
  expect(late.consent).toBeUndefined();
  expect(await service.accounts.optedIn("friends", phone)).toBe(false);

  const startAt = clock.now();
  const start = await say(phone, "START", {app: "friends", receivedAt: startAt});
  expect(start.consent).toEqual({state: "opted_in", scope: "app", app: "friends", at: startAt});
  expect(await service.accounts.optedIn("friends", phone)).toBe(true);

  const leave = await say(phone, `leave ${APPS.friends.domain}`);
  expect(leave.reason).toBe("left");
  expect(leave.consent).toMatchObject({state: "opted_out", scope: "app", app: "friends"});
  expect(leave.memberId).toBeNull();
  expect(escaped).toBe(before);
}, 60_000);

test("START is refused for a banned number and for a number on the recycled-number hold", async () => {
  const banned = "+12125550205", recycled = "+12125550206";
  await joinFriends(banned, "Bea", 33);
  await say(banned, "STOP");
  const person = await service.accounts.personFor(banned);
  await service.people.ban({id: "eliza-takeover-ban", scope: "phone", personId: person!.id, phoneHash: service.accounts.phoneHash(banned), reason: "fixture", reportId: null, bannedBy: "fixture", at: clock.now()});
  const b = await say(banned, "START", {app: "friends"});
  expect(b.consent).toBeUndefined();
  expect(await service.accounts.optedIn("friends", banned)).toBe(false);

  await joinFriends(recycled, "Cy", 34);
  await say(recycled, "STOP");
  await service.people.setPhoneHold(recycled, "recycled_number", clock.now());
  const r = await say(recycled, "START", {app: "friends"});
  expect(r.reason).toBe("held");
  expect(r.consent).toBeUndefined();
  expect(await service.accounts.optedIn("friends", recycled)).toBe(false);
}, 60_000);

test("a minor joins but is single-player only and never in an introduction", async () => {
  const phone = "+12125550207";
  const memberId = await joinFriends(phone, "Kai", 15);
  // A minor's turns are single-player: the Network answers with public places itself, or an open turn says singlePlayer.
  for (let i = 0; i < 3; i++) {
    const r = await say(phone, "Tell me something about the weather", {app: "friends"});
    if (r.outcome === "open") {
      expect(r.context.singlePlayer).toBe(true);
      expect(r.context.activeItems === null || r.context.activeItems.length === 0).toBe(true);
    } else expect(r.outcome).toBe("handled");
  }
  expect((await sql`select 1 from network.participations where app_id = 'friends' and member_id = ${memberId}`).length).toBe(0);
}, 60_000);

test("ignored, idempotent replay by messageId, a changed body, a bad signature and an over-size body", async () => {
  const ignored = await say("+12125550208", APPS.peon.domain);
  expect(ignored).toEqual({outcome: "ignored", reason: "no_network"});

  const input = turn("+12125550209", "HELP");
  const first = await post(input);
  expect(first.status).toBe(200);
  const body = await first.json();
  expect(await (await post(input)).json()).toEqual(body);
  expect((await post({...input, text: "STOP"})).status).toBe(409);

  expect((await post(turn("+12125550210", "HELP"), {key: "a-different-secret-of-enough-length-000"})).status).toBe(401);
  const unsigned = await fetch(new URL(TURN_PATH, server.url), {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(turn("+12125550210", "HELP"))});
  expect(unsigned.status).toBe(401);
  const big = turn("+12125550211", "HELP");
  expect((await post(big, {body: JSON.stringify({...big, text: "x".repeat(300 * 1024)})})).status).toBe(413);
}, 60_000);

test("the service refuses to start with a turn secret shorter than 32 characters", () => {
  expect(() => new NetworkService({url, clock, photoStorage: null, env: env({SERVICE_TURN_SECRET: "short"}), log: () => {}})).toThrow(/SERVICE_TURN_SECRET/);
});

test("nothing reached the provider or the Cloud deliver endpoint", () => {
  expect(escaped).toBe(0);
  expect(cloudCalls.filter(p => p === DELIVER_PATH)).toEqual([]);
});
