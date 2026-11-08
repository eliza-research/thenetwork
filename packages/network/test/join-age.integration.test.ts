// The join paths and the age policy (machines text-join, web-join, age-floor, member-age-policy,
// minor-single-player, looking-for-enroll; docs/research/quint-findings/join_age.md). The real service
// over HTTP with signed turns and a real Postgres (dev-pg, :54339). Sends are dry-run. Each case is a
// defect of the state-machine register (docs/research/2026-11-07-state-machines.md section 5).
import {afterAll, beforeAll, expect, test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock, DAY, MINUTE} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH, type TurnRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";
import {ELIZA_NOTICE} from "../src/copy.ts";
import {APPS} from "../../platform/src/apps.ts";

const db = `network_join_age_${randomUUID().replaceAll("-", "")}`;
const admin = new SQL({url: `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/postgres`, max: 1});
const url = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/${db}`;
const secret = "synthetic-join-age-test-secret-2026110800";
const clock = new SimClock(Date.UTC(2026, 10, 8, 16));
let sql: SQL, service: NetworkService, server: ReturnType<typeof Bun.serve>, cloud: ReturnType<typeof Bun.serve>;
let seq = 0;

beforeAll(async () => {
  await admin.unsafe(`create database ${db}`);
  await applySchema(url, {lockTimeout: "5s"});
  sql = new SQL({url, max: 2});
  cloud = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ok: false, error: "rejected", retryable: false})});
  service = new NetworkService({url, clock, photoStorage: null, instance: "join-age-integration",
    env: {PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret, NETWORK_CLOUD_DELIVERY_ORIGIN: cloud.url.origin},
    networks: [{id: "ntwrk:nyc", matchingEnabled: false}, {id: "slop:nyc", matchingEnabled: false}, {id: "friends:nyc", matchingEnabled: false}],
    network: {seed: 1}, notify: false, log: () => {},
    adapter: () => new DryRunAdapter(() => {}),
  });
  await service.start();
  server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: req => service.fetch(req)});
}, 120_000);
afterAll(async () => {
  server?.stop(true); cloud?.stop(true); await service?.close(); await sql?.close();
  await admin.unsafe(`drop database if exists ${db} with (force)`).catch(() => {}); await admin.close();
});

const post = async (from: string, text: string, app?: TurnRequest["app"]) => {
  const input: TurnRequest = {messageId: `SMja${++seq}`, channel: "blooio", from, to: null, text, transport: "imessage", receivedAt: clock.now(), ...(app ? {app} : {})};
  const body = JSON.stringify(input);
  const headers = await svcSign(secret, {method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000)});
  const r = await fetch(new URL(TURN_PATH, server.url), {method: "POST", headers: {"content-type": "application/json", ...headers}, body});
  clock.advance(MINUTE);
  return r;
};
const say = async (from: string, text: string, app?: TurnRequest["app"]) => {
  const r = await post(from, text, app);
  expect(r.status).toBe(200);
  return r.json() as Promise<any>;
};
/** Join an app by text with its keyword, then first name and age; returns the member id. */
const join = async (phone: string, keyword: string, app: TurnRequest["app"], answer: string) => {
  await say(phone, keyword, app);
  const joined = await say(phone, answer, app);
  expect(joined.reason).toBe("joined");
  return joined.memberId as string;
};
const matchingAge = async (app: string, memberId: string) =>
  (await sql`select age from platform.matching_ages where app_id = ${app} and member_id = ${memberId}`)[0]?.age as number | undefined;

test("SD-010: an age held in a pending join is not replaced by a later, older age", async () => {
  const phone = "+12125550301";
  await say(phone, "friends.help", "friends");
  const asked = await say(phone, "15", "friends");
  expect(asked.outcome).toBe("handled");
  expect(asked.memberId).toBeNull();
  const joined = await say(phone, "Sam 25", "friends");
  expect(joined.reason).toBe("joined");
  // The lowest stated age wins: the person, the phone's age floor and the network member all keep 15.
  expect(await service.accounts.lowestAge(phone, await service.accounts.personFor(phone))).toBe(15);
}, 60_000);

test("SD-010: an age held in a pending join that expires stays on the phone's age floor", async () => {
  const phone = "+12125550302";
  await say(phone, "friends.help", "friends");
  await say(phone, "15", "friends");
  clock.advance(DAY); // the pending join expires (PENDING_MS)
  expect((await say(phone, "Sam 25", "friends")).reason).toBe("joined");
  expect(await service.accounts.lowestAge(phone, await service.accounts.personFor(phone))).toBe(15);
}, 60_000);

test("SD-011: a minor age stated in chat stays recorded when the step after the unit fails", async () => {
  const phone = "+12125550303";
  await join(phone, "friends.help", "friends", "Sam, 25");
  const slop = await join(phone, "slop.date", "slop", "Sam, 25");
  expect(await matchingAge("slop", slop)).toBe(25);
  // The unit that reads "I'm 15" commits; the person-level write after it fails (a crash at this point loses memory too).
  const recordAge = service.accounts.recordAge;
  service.accounts.recordAge = async () => { throw new Error("synthetic failure after the unit"); };
  try { await post(phone, "I'm 15 actually", "friends"); } finally { service.accounts.recordAge = recordAge; }
  expect(await service.accounts.lowestAge(phone, await service.accounts.personFor(phone))).toBe(15);
  // The other app's member is no longer matchable as an adult.
  expect(await matchingAge("slop", slop)).toBe(15);
}, 60_000);

const webJoin = (app: "friends" | "slop", phone: string, age: number, firstName = "Rae") =>
  service.accounts.join(APPS[app], {e164: phone, personId: null}, {firstName, age, consent: {sms: true, wording: APPS[app].consent.text}});
const liveMemberships = async (phone: string) => {
  const person = await service.accounts.personFor(phone);
  return person ? (await service.people.memberships(person.id)).filter(m => m.state !== "removed").map(m => m.app) : [];
};
const networkMember = async (app: string, memberId: string) =>
  (await sql`select account_status from network.members where app_id = ${app} and id = ${memberId}`)[0]?.account_status as string | undefined;

test("SD-014: an under-13 web join on a new app removes the person's other memberships", async () => {
  const phone = "+12125550304";
  const friends = await webJoin("friends", phone, 25);
  expect(friends.ok).toBe(true);
  expect(await webJoin("slop", phone, 12)).toEqual({ok: false, error: "under_age"});
  expect(await liveMemberships(phone)).toEqual([]);
  expect(await service.accounts.optedIn("friends", phone)).toBe(false);
  expect(await networkMember("friends", (friends as any).membership.memberId)).not.toBe("active");
}, 60_000);

test("SD-014: an under-13 repeated web join removes the memberships", async () => {
  const phone = "+12125550305";
  expect((await webJoin("friends", phone, 25)).ok).toBe(true);
  expect(await webJoin("friends", phone, 12)).toEqual({ok: false, error: "under_age"});
  expect(await liveMemberships(phone)).toEqual([]);
}, 60_000);

test("SD-014: an under-13 text join on a new app removes the person's other memberships", async () => {
  const phone = "+12125550306";
  const friends = await join(phone, "friends.help", "friends", "Sam, 25");
  await say(phone, "slop.date", "slop");
  expect((await say(phone, "Sam, 12", "slop")).reason).toBe("under_age");
  expect(await liveMemberships(phone)).toEqual([]);
  expect(await service.accounts.optedIn("friends", phone)).toBe(false);
  expect(await networkMember("friends", friends)).not.toBe("active");
}, 60_000);

test("SD-015: a web join whose welcome fails leaves no network member and keeps the suppression", async () => {
  const phone = "+12125550307";
  expect((await webJoin("friends", phone, 25)).ok).toBe(true);
  await service.accounts.deleteAll({e164: phone, personId: null});
  expect(await service.people.isSuppressed(service.accounts.phoneHash(phone))).toBe(true);
  // The member row commits (createMember); the welcome unit then fails in the database.
  await sql.unsafe(`create function network.fail_welcome() returns trigger language plpgsql as $$
    begin if exists (select 1 from network.members where id = new.member_id and name = 'Failwelcome') then raise exception 'synthetic welcome failure'; end if; return new; end $$`);
  await sql.unsafe(`create trigger fail_welcome before insert on network.messages for each row execute function network.fail_welcome()`);
  try {
    await expect(webJoin("slop", phone, 25, "Failwelcome")).rejects.toThrow();
  } finally {
    await sql.unsafe(`drop trigger fail_welcome on network.messages; drop function network.fail_welcome()`);
  }
  const live = await sql`select id from network.members where app_id = 'slop' and name = 'Failwelcome' and account_status = 'active'`;
  expect(live.length).toBe(0);
  expect(await liveMemberships(phone)).toEqual([]);
  // No opt-in stands, so the deleted number stays suppressed.
  expect(await service.people.isSuppressed(service.accounts.phoneHash(phone))).toBe(true);
}, 60_000);

test("SD-038: an age stated in the answer to the looking-for question counts before any app is joined", async () => {
  const phone = "+12125550308";
  await say(phone, "hi");
  expect((await say(phone, "Sam, 25")).reason).toBe("joined");
  await say(phone, "dating and friends, I'm 15 actually");
  expect(await service.accounts.lowestAge(phone, await service.accounts.personFor(phone))).toBe(15);
  // Dating (slop.date) is 18+: a 15-year-old is never enrolled in it from this question.
  expect(await liveMemberships(phone)).not.toContain("slop");
}, 60_000);

test("SD-065: a minor's ordinary long text reaches the agent as a single-player open turn", async () => {
  const phone = "+12125550309";
  const memberId = await join(phone, "friends.help", "friends", "Kai, 15");
  for (const text of ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"]) await say(phone, text, "friends");
  const r = await say(phone, "Can you help me plan my science fair project about bridges?", "friends");
  expect(r.outcome).toBe("open");
  expect(r.memberId).toBe(memberId);
  expect(r.context.singlePlayer).toBe(true);
  expect(r.context.activeItems === null || r.context.activeItems.length === 0).toBe(true);
}, 60_000);

test("SD-066: a member the Network holds as a minor from a school sign is single-player in the open context", async () => {
  const phone = "+12125550310";
  const memberId = await join(phone, "friends.help", "friends", "Sam, 25");
  for (const text of ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"]) await say(phone, text, "friends");
  await say(phone, "i have homework tonight", "friends");
  const r = await say(phone, "hey", "friends");
  expect(r.outcome).toBe("open");
  expect(r.memberId).toBe(memberId);
  expect(r.context.singlePlayer).toBe(true);
}, 60_000);

test("SD-125: the answer to the looking-for question is a turn of The Network that carries the enroll confirmation", async () => {
  const phone = "+12125550312";
  await say(phone, "hi");
  const joined = await say(phone, "Sam, 25");
  expect(joined.reason).toBe("joined");
  const r = await say(phone, "friends please");
  expect(r.app).toBe("ntwrk");
  expect(r.memberId).toBe(joined.memberId);
  expect(r.replies.some((t: string) => t.startsWith("Done: you're in friends.help"))).toBe(true);
  expect(await liveMemberships(phone)).toContain("friends");
}, 60_000);

test("SD-179: a reply that names no app closes the looking-for question; a later chance word enrolls nothing", async () => {
  const phone = "+12125550313";
  await say(phone, "hi");
  expect((await say(phone, "Sam, 25")).reason).toBe("joined");
  await say(phone, "not sure yet");
  await say(phone, "going out with friends tonight");
  expect(await liveMemberships(phone)).toEqual(["ntwrk"]);
  expect(await service.accounts.optedIn("friends", phone)).toBe(false);
}, 60_000);

test("SD-127: a text join that waits on a web join of the same phone keeps the web join's member id", async () => {
  const phone = "+12125550314";
  // The text turn finds no member; a web join of the same phone commits before the text takes the join lock.
  const withLock = service.people.withLock;
  let reached!: () => void, release!: () => void;
  const atLock = new Promise<void>(r => { reached = r; }), go = new Promise<void>(r => { release = r; });
  service.people.withLock = (async (key: string, fn: () => Promise<unknown>) => {
    if (key === `join:${phone}`) { service.people.withLock = withLock; reached(); await go; }
    return withLock.call(service.people, key, fn);
  }) as typeof withLock;
  const text = post(phone, "Sam, 25", "friends");
  await atLock;
  const web = await webJoin("friends", phone, 25, "Sam");
  release();
  const turn = await text;
  expect(web.ok).toBe(true);
  const memberId = (web as any).membership.memberId as string;
  const person = await service.accounts.personFor(phone);
  // The live membership keeps the member id of its network member.
  expect((await service.people.getMembership(person!.id, "friends"))?.memberId).toBe(memberId);
  expect(turn.status).toBe(200);
  const active = await sql`select id from network.members where app_id = 'friends' and person_id = ${person!.id} and account_status = 'active'`;
  expect(active.map((r: any) => r.id)).toEqual([memberId]);
}, 60_000);

test("SD-213: a member who becomes a minor during the interview gets no further adult interview question", async () => {
  const phone = "+12125550315";
  await join(phone, "friends.help", "friends", "Sam, 25");
  await say(phone, "i have homework tonight", "friends");
  const r = await say(phone, "hey", "friends");
  const replies: string[] = r.replies ?? [];
  expect(replies.some(t => t.includes("When are you usually free"))).toBe(false);
  expect(replies.some(t => t.includes("one-on-one or small groups"))).toBe(false);
}, 60_000);

test("SD-276: a first contact whose worker stops after the notice row commits still gets the notice on the next text", async () => {
  const phone = "+12125550316";
  // The worker stops after the notice row, its collected reply and the join step committed, before the turn is
  // done (a crash: the in-memory undo never runs, and the turn stays "processing").
  const withLock = service.people.withLock;
  let stuck!: () => void;
  const reached = new Promise<void>(r => { stuck = r; });
  service.people.withLock = (async (key: string, fn: () => Promise<unknown>) => {
    if (key !== `join:${phone}`) return withLock.call(service.people, key, fn);
    service.people.withLock = withLock;
    await fn(); stuck();
    return new Promise(() => {});
  }) as typeof withLock;
  post(phone, "hi").catch(() => {});
  await reached;
  // Past the processing lease and the hold of an unresolved turn: the next text sweeps the stuck turn.
  clock.advance(11 * MINUTE);
  const next = await say(phone, "hi");
  expect(next.outcome).toBe("handled");
  expect(next.replies[0]).toBe(ELIZA_NOTICE);
}, 60_000);

test("SD-315: a number whose age floor is under 13 is declined by text and gets no pending join", async () => {
  const phone = "+12125550317";
  expect(await webJoin("slop", phone, 12)).toEqual({ok: false, error: "under_age"});
  const r = await say(phone, "hi");
  expect(r.reason).toBe("under_age");
  expect(await (service as any).pendingOf(phone, "join")).toBeUndefined();
}, 60_000);

test("SD-383: a web join with age 0 is declined as under age and the age floor keeps it", async () => {
  const phone = "+12125550318";
  expect(await webJoin("friends", phone, 0)).toEqual({ok: false, error: "under_age"});
  expect(await service.accounts.lowestAge(phone)).toBe(0);
  // The lowest stated age wins: a later, older age does not join.
  expect(await webJoin("friends", phone, 25)).toEqual({ok: false, error: "under_age"});
  expect(await liveMemberships(phone)).toEqual([]);
}, 60_000);

test("SD-488: the reply to a staff invite with name and age joins the invited app", async () => {
  const phone = "+12125550319";
  const staff = {id: "staff@example.com", roles: ["admin"], grants: [{role: "admin", app: "*"}], via: "sso"} as any;
  expect(await service.invite(staff, service.runtimeFor("friends")!, phone)).toEqual({ok: true});
  const r = await say(phone, "Sam, 29");
  expect(r.reason).toBe("joined");
  expect(r.app).toBe("friends");
  expect(await liveMemberships(phone)).toEqual(["friends"]);
}, 60_000);

test("Q-join_age-1: the bare answer \"friends\" to the looking-for question enrolls, not a new join", async () => {
  const phone = "+12125550320";
  await say(phone, "hi");
  const joined = await say(phone, "Sam, 25");
  expect(joined.reason).toBe("joined");
  const r = await say(phone, "friends");
  expect(r.app).toBe("ntwrk");
  expect(r.reason).not.toBe("join_asked");
  expect(await (service as any).pendingOf(phone, "join")).toBeUndefined();
  expect((await liveMemberships(phone)).sort()).toEqual(["friends", "ntwrk"]);
}, 60_000);

test("Q-join_age-2: a web join that stops after its membership commits gets its network member on the retry", async () => {
  const phone = "+12125550321";
  // The worker stops after putMembership and the opt-in, before the join hook (the network member) runs.
  const attach = service.people.attachPerson;
  service.people.attachPerson = (async () => { service.people.attachPerson = attach; throw new Error("synthetic worker stop"); }) as typeof attach;
  try {
    await expect(webJoin("friends", phone, 25, "Sam")).rejects.toThrow("synthetic worker stop");
  } finally {
    service.people.attachPerson = attach;
  }
  // The client sends the same join again: the live membership gets its network member.
  const retry = await webJoin("friends", phone, 25, "Sam");
  expect(retry.ok).toBe(true);
  const memberId = (retry as any).membership.memberId as string;
  expect(await liveMemberships(phone)).toEqual(["friends"]);
  expect(await networkMember("friends", memberId)).toBe("active");
  // A second repeat changes nothing: still one network member for the app.
  expect((await webJoin("friends", phone, 25, "Sam")).ok).toBe(true);
  const person = await service.accounts.personFor(phone);
  const rows = await sql`select id from network.members where app_id = 'friends' and person_id = ${person!.id}`;
  expect(rows.map((r: any) => r.id)).toEqual([memberId]);
}, 60_000);
