// spec/opsAlertDispatch.md, "Each unconfirmed turn condition becomes overdue after its threshold"; spec/opsAlertDispatch.md, "Each condition is one alert, and a possible STOP makes it bad and first"
import { afterAll, beforeAll, expect, test } from "vitest";
import { MINUTE, SimClock } from "../../packages/core/src/index.ts";
import { serveHttp, type HttpServer } from "../../packages/core/src/runtime/http.ts";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { TURN_PATH, TURN_RECEIPT_PATH, type TurnReceiptRequest, type TurnRequest } from "../../packages/core/src/svc/contract.ts";
import { DryRunAdapter } from "../../packages/network/service/channel.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { dropTestDb, testDb } from "../../apps/observatory/test/pg.ts";
import { turnWatchMetrics } from "../../packages/network/service/turn-watch.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { createOps, opsConfigFromEnv, PgAlertStore, type Notice } from "./ops.ts";

const secret = "synthetic-ops-turn-watch-secret-20261118";
const clock = new SimClock(Date.UTC(2026, 10, 18, 16));
const t0 = clock.now();
let sql: SQL, service: NetworkService, server: HttpServer;

const turn = (id: string, from: string, text: string): TurnRequest => ({ messageId: id, from, text, channel: "blooio", to: null, transport: "imessage", receivedAt: clock.now() });
const signed = async (path: string, id: string, body: string) =>
  fetch(new URL(path, server.url), { method: "POST", headers: { "content-type": "application/json", ...await svcSign(secret, { method: "POST", path, id, body, nowS: Math.floor(clock.now() / 1000) }) }, body });
const post = (input: TurnRequest) => signed(TURN_PATH, input.messageId, JSON.stringify(input));
const receipt = (input: TurnReceiptRequest) => signed(TURN_RECEIPT_PATH, `${input.messageId}:receipt`, JSON.stringify(input));

beforeAll(async () => {
  const url = await testDb();
  sql = new SQL({ url, max: 2 });
  service = new NetworkService({
    url, clock, photoStorage: null, instance: "ops-turn-watch",
    env: { PLATFORM_ENV: "dev", PLATFORM_HASH_KEY: "synthetic-ops-turn-watch-hash-key", SERVICE_TURN_SECRET: secret },
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "friends:nyc", matchingEnabled: false }], network: { seed: 1 },
    adapter: () => new DryRunAdapter(() => {}), log: () => {},
  });
  await service.start();
  server = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: req => service.fetch(req) });
}, 120_000);
afterAll(async () => {
  await server?.stop(true); await service?.close(); await sql?.close();
  await dropTestDb();
});

test("unconfirmed replies, unresolved turns and unknown deliveries alert once each, a possible STOP first and bad, with counts only", async () => {
  const stopPhone = "+12125550141", helloPhone = "+12125550142", faultPhone = "+12125550143";
  const stop = turn("watch-stop", stopPhone, "STOP");
  const stopResponse = await post(stop);
  expect(stopResponse.status).toBe(200);
  const stopBody = await stopResponse.json() as { outcome: string; replies: string[]; replyIds: string[] };
  expect(stopBody.outcome).toBe("handled");
  expect(stopBody.replies.length).toBeGreaterThan(0);
  const [stored] = await sql`select replies from platform.inbound where id = 'msg:blooio:watch-stop'`;
  expect((stored!.replies as { kind: string }[]).some(r => r.kind === "compliance")).toBe(true);
  const first = turn("watch-first", helloPhone, "hi");
  const firstResponse = await post(first);
  expect(firstResponse.status).toBe(200);
  const firstBody = await firstResponse.json() as { replyIds: string[] };
  expect((await receipt({ channel: "blooio", messageId: first.messageId, replyIds: firstBody.replyIds, outcome: "accepted", providerMessageIds: ["watch-first-sent"], historyRecorded: true })).status).toBe(200);
  const hello = turn("watch-hello", helloPhone, "hello there");
  const helloResponse = await post(hello);
  expect(helloResponse.status).toBe(200);
  const helloBody = await helloResponse.json() as { outcome: string; replies: string[]; replyIds: string[] };
  expect(helloBody.outcome).toBe("handled");
  expect(helloBody.replies.length).toBeGreaterThan(0);
  const [helloStored] = await sql`select replies from platform.inbound where id = 'msg:blooio:watch-hello'`;
  expect((helloStored!.replies as { kind: string }[]).map(r => r.kind)).not.toContain("compliance");
  const original = service.inbound.bind(service);
  service.inbound = async (...args) => { await original(...args); throw new Error("synthetic after-effect fault"); };
  try { expect((await post(turn("watch-fault", faultPhone, "hello again"))).status).toBe(409); } finally { service.inbound = original; }
  expect((await sql`select status from platform.inbound where id = 'msg:blooio:watch-fault'`)[0]!.status).toBe("unresolved");
  await sql`insert into platform.outbound (id, app_id, line, to_address, kind, body, fingerprint, time_zone, status, next_attempt_at, created_at, updated_at)
    values ('watch-unknown', 'friends', '+12125550100', '+12125550144', 'reply', 'synthetic unknown text', 'watch-unknown', 'America/New_York',
      'unknown_acceptance', ${new Date(t0)}, ${new Date(t0)}, ${new Date(t0)})`;

  const posts: { alerts: Notice[]; text: string }[] = [];
  const ops = createOps({
    config: opsConfigFromEnv({}, { env: "test", build: "test", deployed: false, warn: line => { throw new Error(line); } }), probes: () => [],
    turns: now => turnWatchMetrics(sql, now), store: new PgAlertStore(sql), now: () => clock.now(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    post: async body => { posts.push(body as { alerts: Notice[]; text: string }); return true; },
  });
  const round = async () => {
    const before = posts.length;
    clock.advance(MINUTE);
    await ops.tick();
    return posts.slice(before).flatMap(p => p.alerts).map(a => `${a.key}=${a.level}:${a.count}:${a.state}`);
  };

  expect(await round()).toEqual([]);
  expect((await receipt({ channel: "blooio", messageId: stop.messageId, replyIds: stopBody.replyIds, outcome: "unknown", providerMessageIds: [], historyRecorded: false })).status).toBe(200);
  expect(await round()).toEqual(["turn_unconfirmed=bad:1:firing", "turn_unresolved=bad:1:firing"]);
  const firstPost = JSON.stringify(posts.at(-1));
  for (const value of [stopPhone, faultPhone, helloPhone, ...stopBody.replies, ...helloBody.replies, "msg:blooio:"]) expect(firstPost).not.toContain(value);

  clock.advance(12 * MINUTE);
  expect(await round()).toEqual(["deliver_unknown=warn:1:firing"]);
  expect((await turnWatchMetrics(sql, clock.now())).conditions).toEqual([
    { condition: "RepliesUnconfirmed", overdue: 2, compliance: 1 },
    { condition: "TurnUnresolved", overdue: 1, compliance: 1 },
    { condition: "DeliveryUnknown", overdue: 1, compliance: 0 },
  ]);

  expect((await receipt({ channel: "blooio", messageId: stop.messageId, replyIds: stopBody.replyIds, outcome: "accepted", providerMessageIds: ["watch-stop-sent"], historyRecorded: true })).status).toBe(200);
  expect((await receipt({ channel: "blooio", messageId: hello.messageId, replyIds: helloBody.replyIds, outcome: "rejected", providerMessageIds: [], historyRecorded: false })).status).toBe(200);
  expect(await service.inbox.resolve("msg:blooio:watch-fault")).toBe(true);
  await sql`update platform.outbound set status = 'failed_unknown' where id = 'watch-unknown'`;
  expect((await round()).sort()).toEqual(["deliver_unknown=warn:1:resolved", "turn_unconfirmed=bad:2:resolved", "turn_unresolved=bad:1:resolved"]);
  expect(await round()).toEqual([]);

  const lostStop = turn("watch-stop-rejected", "+12125550145", "STOP");
  const lostResponse = await post(lostStop);
  expect(lostResponse.status).toBe(200);
  const lostBody = await lostResponse.json() as { replyIds: string[] };
  expect((await receipt({ channel: "blooio", messageId: lostStop.messageId, replyIds: lostBody.replyIds, outcome: "rejected", providerMessageIds: [], historyRecorded: false })).status).toBe(200);
  expect(await round()).toEqual([]);
  expect(await round()).toEqual(["turn_unconfirmed=bad:1:firing"]);
  expect((await turnWatchMetrics(sql, clock.now())).conditions[0]).toEqual({ condition: "RepliesUnconfirmed", overdue: 1, compliance: 1 });
}, 120_000);

test("an erased turn that was handled first raises no unresolved-turn alert", async () => {
  const consent = { sms: true as const, wording: APPS.friends.consent.text };
  const inviterPhone = "+12125550146", inviteePhone = "+12125550147";
  const inviter = await service.accounts.join(APPS.friends, { e164: inviterPhone, personId: null }, { firstName: "Ari", age: 31, homeCity: "nyc", consent });
  const invitee = await service.accounts.join(APPS.friends, { e164: inviteePhone, personId: null }, { firstName: "Daria", age: 29, homeCity: "nyc", consent });
  if (!inviter.ok || !invitee.ok) throw new Error("The fixture's joins failed");
  const own = turn("watch-erased", inviterPhone, "HELP");
  const ownResponse = await post({ ...own, app: "friends" });
  expect(ownResponse.status).toBe(200);
  const ownBody = await ownResponse.json() as { outcome: string; replyIds: string[] };
  expect(ownBody.outcome).toBe("handled");
  expect((await receipt({ channel: "blooio", messageId: own.messageId, replyIds: ownBody.replyIds, outcome: "accepted", providerMessageIds: ["watch-erased-sent"], historyRecorded: true })).status).toBe(200);
  const [handled] = await sql`select app_id, status, handled_at from platform.inbound where id = 'msg:blooio:watch-erased'`;
  expect(handled).toMatchObject({ app_id: "friends", status: "done", handled_at: expect.any(Date) });
  await sql`insert into network.messages (id, app_id, member_id, direction, body, ts, inbound_id, invite_join_members)
    values ('invite-notice:watch-erased', 'friends', ${inviter.membership.memberId}, 'outbound', 'Daria just joined.', ${new Date(clock.now())},
      'msg:blooio:watch-erased', ${sql.array([invitee.membership.memberId], "TEXT")})`;
  clock.advance(MINUTE);
  const leave = await post({ ...turn("watch-leave", inviteePhone, "leave friends.help"), app: "friends" });
  expect(leave.status).toBe(200);
  const [erased] = await sql`select status, sender_hash is not null as kept, handled_at from platform.inbound where id = 'msg:blooio:watch-erased'`;
  expect(erased).toMatchObject({ status: "unresolved", kept: true, handled_at: expect.any(Date) });

  const posts: Notice[] = [];
  const ops = createOps({
    config: opsConfigFromEnv({}, { env: "test", build: "test", deployed: false, warn: line => { throw new Error(line); } }), probes: () => [],
    turns: now => turnWatchMetrics(sql, now), store: new PgAlertStore(sql), now: () => clock.now(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    post: async body => { posts.push(...(body as { alerts: Notice[] }).alerts); return true; },
  });
  clock.advance(20 * MINUTE);
  await ops.tick();
  expect((await turnWatchMetrics(sql, clock.now())).conditions[1]).toEqual({ condition: "TurnUnresolved", overdue: 0, compliance: 0 });
  expect(posts.filter(a => a.key === "turn_unresolved" && a.state === "firing")).toEqual([]);
}, 120_000);
