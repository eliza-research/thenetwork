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
import {TURN_PATH, type TurnRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";

const user = process.env.USER ?? "postgres";
const db = `network_turn_consent_${randomUUID().replaceAll("-", "")}`;
const url = `postgres://${user}@127.0.0.1:${DEV_PG_PORT}/${db}`;
const secret = "synthetic-turn-consent-test-secret-20261108";
const clock = new SimClock(Date.UTC(2026, 10, 8, 16));
let admin: SQL, sql: SQL, service: NetworkService, server: ReturnType<typeof Bun.serve>;

const start = async () => {
  service = new NetworkService({url, clock, photoStorage: null, instance: "turn-consent-integration",
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
});
