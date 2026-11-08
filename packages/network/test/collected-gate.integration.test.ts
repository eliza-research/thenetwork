// The collected seam (service/decisions.ts collectGate): a reply returned in a signed turn never reaches the
// outbound queue, so it gets the consent, ban and leak answers here. Driven over HTTP with signed requests on a
// real Postgres (dev-pg, :54339). Sends are dry-run; a fake deliver counts anything that would leave.
import {afterAll, beforeAll, expect, test} from "bun:test";
import {randomUUID} from "node:crypto";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {SQL} from "bun";
import {SimClock, MINUTE} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {APPS} from "../../platform/src/apps.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH, type TurnRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";
import {ELIZA_NOTICE} from "../src/copy.ts";

const db = `network_collected_gate_${randomUUID().replaceAll("-", "")}`;
const admin = new SQL({url: `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/postgres`, max: 1});
const url = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/${db}`;
const secret = "synthetic-collected-gate-test-secret-20261107";
const clock = new SimClock(Date.UTC(2026, 10, 7, 16));
const ONBOARDING = ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"];
let service: NetworkService, server: ReturnType<typeof Bun.serve>;
let escaped = 0, seq = 0;

beforeAll(async () => {
  await admin.unsafe(`create database ${db}`);
  console.info(`[owned-db] ${db}`);
  await applySchema(url, {lockTimeout: "5s"});
  service = new NetworkService({url, clock, photoStorage: null, instance: "collected-gate-integration", env: {PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret},
    networks: [{id: "ntwrk:nyc", matchingEnabled: false}, {id: "friends:nyc", matchingEnabled: false}],
    network: {seed: 1}, notify: false, log: () => {},
    adapter: () => { const a = new DryRunAdapter(() => {}); a.direct = async () => { escaped++; return "dry_run"; }; a.deliver = async rows => { escaped += rows.length; return rows.map(r => ({id: r.id, status: "dry_run"})); }; return a; },
  });
  await service.start();
  server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: req => service.fetch(req)});
}, 120_000);
afterAll(async () => { server?.stop(true); await service?.close(); await admin.close(); });

const turn = (from: string, text: string, o: {app?: TurnRequest["app"]; receivedAt?: number; id?: string} = {}): TurnRequest =>
  ({messageId: o.id ?? `SMcg${++seq}`, channel: "blooio", from, to: null, text, transport: "imessage", receivedAt: o.receivedAt ?? clock.now(), ...(o.app ? {app: o.app} : {})});
const post = async (input: TurnRequest) => {
  const body = JSON.stringify(input);
  const headers = await svcSign(secret, {method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000)});
  return fetch(new URL(TURN_PATH, server.url), {method: "POST", headers: {"content-type": "application/json", ...headers}, body});
};
const say = async (from: string, text: string, o: {app?: TurnRequest["app"]; receivedAt?: number} = {}) => {
  const r = await post(turn(from, text, o));
  expect(r.status).toBe(200);
  clock.advance(MINUTE);
  return r.json() as Promise<any>;
};
const joinFriends = async (phone: string, name: string, age: number) => {
  await say(phone, "friends.help", {app: "friends"});
  const joined = await say(phone, `${name}, ${age}`, {app: "friends"});
  expect(joined.reason).toBe("joined");
  for (const text of ONBOARDING) await say(phone, text, {app: "friends"});
  return joined.memberId as string;
};
const ban = async (phone: string) => {
  const person = await service.accounts.personFor(phone);
  await service.people.ban({id: `gate-ban-${phone}`, scope: "phone", personId: person!.id, phoneHash: service.accounts.phoneHash(phone), reason: "fixture", reportId: null, bannedBy: "fixture", at: clock.now()});
};

test("after STOP a stranger's text gets the one hint: no join prompt, and every reply id is unique", async () => {
  const phone = "+12125550301", before = escaped;
  await say(phone, "STOP");
  const r = await say(phone, "hi");
  // The one-time Eliza notice is a separate founder question (it is fixed compliance copy): only the join prompt must go.
  expect(r.replies.filter((b: string) => b !== ELIZA_NOTICE)).toEqual([expect.stringContaining("START")]);
  expect(r.replyKind).toBe("compliance");
  expect(new Set(r.replyIds).size).toBe(r.replyIds.length);
  expect(r.reason).not.toBe("onboarding_asked");
  expect(escaped).toBe(before);
}, 60_000);

test("START opens the join again, and name and age from an opted-out number are a new opt-in", async () => {
  const phone = "+12125550302";
  await say(phone, "STOP");
  const start = await say(phone, "START", {app: "friends"});
  expect(start.consent).toMatchObject({state: "opted_in", app: "friends"});
  expect(start.replies.some((b: string) => b === APPS.friends.brand.help)).toBe(false);
  const other = "+12125550303";
  await say(other, "STOP");
  const joined = await say(other, "Tess, 30", {app: "friends"});
  expect(joined.reason).toBe("joined");
  expect(joined.replies.length).toBeGreaterThan(0);
}, 60_000);

test("a banned member gets no collected reply, and nothing is queued for them", async () => {
  const phone = "+12125550304", before = escaped;
  const memberId = await joinFriends(phone, "Bea", 33);
  await ban(phone);
  const r = await say(phone, "block Sam", {app: "friends"});
  expect(r.replies).toEqual([]);
  expect(r.accountEligible).toBe(false);
  const rows = await service.main.scoped(tx => tx`select status from network.messages where app_id='friends' and member_id=${memberId} and direction='outbound' order by ts desc limit 1`) as any[];
  expect(rows[0]?.status).toBe("refused_opted_out");
  expect(escaped).toBe(before);
}, 60_000);

test("an opted-out member's text gets the one hint and no reply from the Network", async () => {
  const phone = "+12125550305", before = escaped;
  await joinFriends(phone, "Cy", 34);
  await say(phone, "STOP");
  const r = await say(phone, "block Sam", {app: "friends"});
  expect(r.replies).toEqual([expect.stringContaining("START")]);
  expect(r.replyKind).toBe("compliance");
  expect(escaped).toBe(before);
}, 60_000);

test("a late START from a non-member reports no consent change and opens no join", async () => {
  const phone = "+12125550306", stopAt = clock.now();
  await say(phone, "STOP", {receivedAt: stopAt});
  const late = await say(phone, "START", {app: "friends", receivedAt: stopAt - 30_000});
  expect(late.outcome).toBe("handled");
  expect(late.consent).toBeUndefined();
  expect(late.replies).toEqual([]);
  expect(await service.accounts.optedIn("friends", phone)).toBe(false);
}, 60_000);

test("a stored reply does not replay after a later ban", async () => {
  const phone = "+12125550307";
  await joinFriends(phone, "Dee", 35);
  const input = turn(phone, "block Sam", {app: "friends"});
  const first = await post(input);
  expect(first.status).toBe(200);
  expect(((await first.json()) as any).replies.length).toBeGreaterThan(0);
  await ban(phone);
  expect((await post(input)).status).toBe(409);
}, 60_000);

test("a reply to a member from before the ledger still reads the member's own opt-out", async () => {
  const phone = "+12125550308";
  const memberId = await joinFriends(phone, "Eli", 36);
  await service.main.scoped(tx => tx`update network.members set opted_out=true where app_id='friends' and id=${memberId}`);
  const r = await say(phone, "block Sam", {app: "friends"});
  expect(r.replies).toEqual([]);
}, 60_000);

test("a late leave reports the time the person sent it, as every other consent event of a turn does", async () => {
  const phone = "+12125550309";
  await joinFriends(phone, "Flo", 37);
  const sentAt = clock.now() - 30_000;
  const left = await say(phone, `leave ${APPS.friends.domain}`, {receivedAt: sentAt});
  expect(left.reason).toBe("left");
  expect(left.consent).toEqual({state: "opted_out", scope: "app", app: "friends", at: sentAt});
  // The ledger row carries the same time, so a retried leave never sorts after a newer join.
  const sql = new SQL({url, max: 1});
  const [row] = await sql`select (extract(epoch from at) * 1000)::bigint as at from platform.consent_events where e164 = ${phone} and app_id = 'friends' and source = 'leave'`;
  await sql.close();
  expect(Number(row.at)).toBe(sentAt);
}, 60_000);

test("an age stated in a join that asks again for the home city is kept: the lowest age wins", async () => {
  const phone = "+12125550311";
  await say(phone, "friends.help", {app: "friends"});
  expect((await say(phone, "Kim, 15, I live in Boston", {app: "friends"})).reason).not.toBe("joined");
  await say(phone, "Kim, 25, I live in New York", {app: "friends"});
  const person = await service.accounts.personFor(phone);
  expect(await service.accounts.lowestAge(phone, person)).toBe(15);
}, 60_000);

test("the service reads time only from a Clock", () => {
  const dir = join(import.meta.dir, "..", "service");
  const found = readdirSync(dir).filter(f => f.endsWith(".ts")).flatMap(f => (readFileSync(join(dir, f), "utf8").match(/Date\.now\(\)|Math\.random\(\)|new Date\(\)/g) ?? []).map(m => `${f}: ${m}`));
  expect(found).toEqual([]);
});
