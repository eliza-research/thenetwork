// Real service, HTTP and PostgreSQL. Only OTP/provider delivery boundaries are controlled.
import { fetchWithHost } from "../../core/src/runtime/fetch.ts";
import { serveHttp, type HttpServer } from "../../core/src/runtime/http.ts";
import { setTimeout as sleep } from "node:timers/promises";
import {afterAll, beforeAll, expect, test, vi} from "vitest";
import {createHash, randomUUID} from "node:crypto";
import {SQL} from "../../core/src/runtime/postgres.ts";
import type { CapitalEvent } from "../../capital/src/index.ts";
import {SimClock, MINUTE, DAY} from "@thenetwork/core";
import {applySchema, DEV_PG_PORT} from "../../db/dev-pg.ts";
import {APPS, type AppInfo} from "../../platform/src/apps.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH, TURN_RECEIPT_PATH, type TurnRequest, type TurnReceiptRequest} from "../../core/src/svc/contract.ts";
import {BlooioAdapter, DryRunAdapter} from "../service/channel.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import {CONTEXT_UNAVAILABLE_REPLY, lookingForAsk, NetworkService} from "../service/service.ts";
import {inboxKeepMs} from "../../core/src/generated/platformRetention.ts";
import {turnTombstoneKeepMs} from "../../core/src/generated/signedInbox.ts";
import { slopOnboarding } from "../service/packs.ts";
import type { NetworkState } from "../src/network.ts";
import {networkRoutePolicy, routeEnvelopeAllowed} from "../service/route-authority.ts";
import { importPublicEvents } from "../service/import-public-events.ts";
import { applyBaseProfileGrants } from "../service/base-profile-share.ts";
import { brandOf, copyFor } from "../src/copy.ts";

const db = `network_signed_turn_${randomUUID().replaceAll("-", "")}`;
const admin = new SQL({url:`postgres://${process.env.USER ?? "postgres"}@127.0.0.1:${DEV_PG_PORT}/postgres`, max:1});
const url = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:${DEV_PG_PORT}/${db}`;
const secret = "synthetic-shared-agent-test-secret-20261009";
const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
let sql: SQL, service: NetworkService, server: HttpServer;
let escaped = 0, code = "";
const lineSends: SendRequest[] = [];
const start = async (routePolicy?: Record<string, unknown>, collectedQueue = false) => {
  // Only this test's newly created database changes realm markers. The service's
  // normal staging/database mismatch guard stays intact.
  const [realm] = await sql`select current_database() as database,value from platform.settings where key='environment'`;
  if (realm?.database !== db || !["dev","staging"].includes(realm.value)) throw new Error("Owned test realm required");
  await sql`update platform.settings set value=${routePolicy ? "staging" : "dev"} where key='environment'`;
  service = new NetworkService({url, clock, photoStorage:null, instance:"signed-turn-integration",
    env:{PLATFORM_ENV:routePolicy ? "staging" : "dev", PLATFORM_HASH_KEY:"synthetic-route-test-hash-key", SERVICE_TURN_SECRET:secret, ...(routePolicy ? {NETWORK_ROUTE_AUTHORITY_POLICY:JSON.stringify(routePolicy)} : {})}, networks:[{id:"ntwrk:nyc",matchingEnabled:false},{id:"slop:nyc",matchingEnabled:false},{id:"friends:nyc",matchingEnabled:false}],
    network:{seed:1}, publicApi:{minStartMs:0,minVerifyMs:0,otp:{name:"fixture",send:async () => {code="314159";return {code};}}},
    adapter:(_net, rt) => {
      if (collectedQueue) return new BlooioAdapter({ app: rt.app.id, city: rt.city, from: "+12125550160", clock, env: {}, log: () => {},
        provider: { kind: "sim", send: async request => {
          if (request.context?.kind === "reply") { escaped++; throw new Error("The signed reply left its collector"); }
          lineSends.push(request);
          return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
        } } });
      const a = new DryRunAdapter(() => {});
      a.direct = async () => { escaped++; return "dry_run"; };
      a.deliver = async rows => { escaped += rows.length; return rows.map(r => ({ id: r.id, status: "dry_run" })); };
      return a;
    },log:()=>{},
  });
  await service.start();
  server=await serveHttp({hostname:"127.0.0.1",port:0,fetch:req=>new URL(req.url).pathname.startsWith("/api/")?service.publicFetch(req):service.fetch(req)});
};
const turn = (id:string, from:string, text:string, app?:TurnRequest["app"]):TurnRequest => ({messageId:id,from,text,channel:"blooio",to:null,transport:"imessage",receivedAt:clock.now(),...(app?{app}:{})});
const post = async (input:TurnRequest, signedPath=TURN_PATH) => {
  const body=JSON.stringify(input);
  return fetch(new URL(TURN_PATH,server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:signedPath,id:input.messageId,body,nowS:Math.floor(clock.now()/1000)})},body});
};
const receipt = async (input:TurnReceiptRequest) => {
  const body=JSON.stringify(input);
  return fetch(new URL(TURN_RECEIPT_PATH,server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:TURN_RECEIPT_PATH,id:`${input.messageId}:receipt`,body,nowS:Math.floor(clock.now()/1000)})},body});
};
beforeAll(async()=>{await admin.unsafe(`create database ${db}`);console.info(`[owned-db] ${db}`);await applySchema(url,{lockTimeout:"5s"});sql=new SQL({url,max:2});await start();},120_000);
afterAll(async()=>{await server?.stop(true);await service?.close();await sql?.close();await admin.close();}); // Keep this owned database for the source receipt.

test("signed turns collect direct replies, replay immutable JSON and isolate concurrent users/channels",async()=>{
  const input=turn("help-one","+12125550111","HELP");
  const r=await post(input);expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toContain("no-store");
  const initial=await r.json() as any;
  expect(initial.outcome).toBe("handled");expect(initial.delivery).toBe("collected");expect(initial.replyKind).toBe("compliance");expect(initial.replies.length).toBe(1);expect(initial.replyIds.length).toBe(1);
  expect(await (await post(input)).json()).toEqual(initial);
  expect((await post({...input,text:"STOP"})).status).toBe(409);
  expect((await post(turn("bad-path","+12125550112","HELP"),"/wrong/internal/turn")).status).toBe(401);
  const two=await Promise.all([post(turn("parallel","+12125550113","HELP")),post(turn("parallel-other","+12125550114","HELP"))]);
  expect(two.map(r=>r.status)).toEqual([200,200]);
  const cross={...input,channel:"twilio" as const};expect((await post(cross)).status).toBe(200);
  const [row]=await sql`select sender,event,jsonb_typeof(response) as type,replies from platform.inbound where id='msg:blooio:help-one'`;
  expect(row.sender).toBeNull();expect(row.event).toBeNull();expect(row.type).toBe("object");expect(row.replies.length).toBe(1);
  expect(escaped).toBe(0);
},60_000);

test("signed answers to the enrollment question require a positive app choice", async () => {
  // spec/textEnrollment.md, "A current Network member's answer controls other-app enrollment"
  const cases = [
    { text: "I'm not interested at all", apps: [] },
    { text: "Friends, that's all", apps: ["friends"] },
    { text: "Not everything", apps: [] },
    { text: "All apps except dating", apps: ["friends"] },
    { text: "All three, please", apps: ["friends", "slop"] }, // The fixture runs both child apps.
  ];
  const actual = [];
  for (const [i, { text, apps }] of cases.entries()) {
    const phone = `+1212555019${i}`;
    const send = async (step: string, input: string) => {
      clock.advance(MINUTE);
      expect((await post(turn(`looking-for-${i}-${step}`, phone, input))).status).toBe(200);
    };
    const pending = () => service.people.getPending(service.accounts.phoneHash(phone), "looking_for");
    await send("hello", "Hello!");
    await send("join", "Ria, 30");
    expect(await pending()).toMatchObject({ app: "ntwrk" });
    await send("answer", text);
    const person = await service.accounts.personFor(phone);
    const memberships = (await service.people.memberships(person!.id)).map(membership => membership.app).filter(app => app !== "ntwrk").sort();
    const consent = await sql`select app_id from platform.consent_events where e164 = ${phone} and source = 'looking_for' order by app_id`;
    actual.push({ text, memberships, consent: consent.map(row => row.app_id), pending: !!await pending() });
  }
  expect(actual).toEqual(cases.map(({ text, apps }) => ({
    text, memberships: apps, consent: apps, pending: apps.length === 0,
  })));
}, 60_000);

// spec/memberAge.md, "Commit a stated age before projecting it across apps"
test("a sports score or height leaves a verified adult's age intact across signed app turns", async () => {
  const phone = "+12125550198";
  for (const app of [APPS.friends, APPS.slop]) {
    await service.accounts.invite(app, phone);
    const person = (await service.accounts.personFor(phone))!;
    const joined = await service.accounts.join(app, { e164: phone, personId: person.id }, {
      firstName: "Ari", age: 29, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
    });
    expect(joined.ok).toBe(true);
  }
  const person = (await service.accounts.personFor(phone))!;
  const controls = ["I am 3 and I am undefeated.", "I am 3 and my record is 3-1.", "I'm 5 and also my team won.", "I'm 5.5"];
  for (const [i, text] of controls.entries()) {
    expect((await post(turn(`ambiguous-number-keeps-adult-${i}`, phone, text, "friends"))).status).toBe(200);
    expect(await service.accounts.lowestAge(phone, person)).toBe(29);
  }
  const age = turn("sports-real-age", phone, "I am 17 years old and my team won.", "friends");
  expect((await post(age)).status).toBe(200);
  expect(await service.accounts.lowestAge(phone, person)).toBe(17);

  const fractionalBirthday = turn("fractional-birthday-adult-hold", phone, "I just turned 7.5.", "friends");
  expect((await post(fractionalBirthday)).status).toBe(200);
  expect(await service.accounts.lowestAge(phone, person)).toBe(13);
  expect((await service.people.memberships(person.id)).map(member => member.state)).toEqual(["active", "active"]);

  const birthday = turn("sports-birthday-age", phone, "I just turned 12 and I am undefeated.", "friends");
  expect((await post(birthday)).status).toBe(200);
  expect(await service.accounts.lowestAge(phone, person)).toBe(13);
}, 60_000);

// spec/memberAge.md, "Quoted age evidence does not change the sender"
test("a signed quoted youth cue does not restrict the adult sender", async () => {
  const app = APPS.friends;
  const phone = "+12125550179";
  await service.accounts.invite(app, phone);
  const person = (await service.accounts.personFor(phone))!;
  const joined = await service.accounts.join(app, { e164: phone, personId: person.id }, {
    firstName: "Ari", age: 29, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
  });
  if (!joined.ok) throw new Error(`Age fixture signup failed: ${joined.error}`);
  const rt = service.runtimeFor(app.id)!;
  const ageState = async () => {
    const member = (await rt.pg.load())?.members.find(row => row.id === joined.membership.memberId);
    return { floor: await service.accounts.lowestAge(phone, person), minor: member?.minor, signal: member?.minorSignal };
  };
  for (const [i, text] of [
    "She said “I’m underage.”",
    'He said "She said ‘I’m in seventh grade.’"',
    "I overheard a conversation: she is 15.",
    'Can we adapt what she said: "after school tomorrow"?',
    "She said 'I’m underage.'",
    'I heard her say, "I’m underage."',
    'Can you check the dialogue: "I’m underage."',
    'The character whispered, "I’m underage."',
    'The copy reads, "After school tomorrow."',
    'I told her "Mara said ‘I’m underage.’"',
    'I said “I’m 17.”',
    'Yesterday she told me “I’m underage.”',
    'Yesterday I told her she said “I’m underage.”',
    'Yesterday I read a draft: “I’m underage.”',
  ].entries()) {
    clock.advance(MINUTE);
    expect((await post(turn(`quoted-youth-${i}`, phone, text, app.id))).status).toBe(200);
    expect(await ageState(), text).toEqual({ floor: 29, minor: false, signal: false });
  }
  clock.advance(MINUTE);
  expect((await post(turn("own-quoted-youth-cue", phone, 'Yesterday I told her “I’m underage.”', app.id))).status).toBe(200);
  expect(await ageState()).toEqual({ floor: 29, minor: true, signal: true });
  clock.advance(MINUTE);
  expect((await post(turn("own-youth-cue", phone, "I'm underage.", app.id))).status).toBe(200);
  expect(await ageState()).toEqual({ floor: 17, minor: true, signal: true });
}, 60_000);

// spec/memberAge.md, "Quoted age evidence does not change the sender"
test("a signed unfinished draft does not set the adult sender's exact age", async () => {
  const phone = "+12125550176";
  const app = APPS.friends;
  await service.accounts.invite(app, phone);
  const person = (await service.accounts.personFor(phone))!;
  const joined = await service.accounts.join(app, { e164: phone, personId: person.id }, {
    firstName: "Ari", age: 29, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
  });
  if (!joined.ok) throw new Error(`Age fixture signup failed: ${joined.error}`);
  clock.advance(MINUTE);
  expect((await post(turn("unclosed-quoted-draft-age", phone, 'Can you proofread this draft: "Hello. Age: 15', app.id))).status).toBe(200);
  expect(await service.accounts.lowestAge(phone, person)).toBe(29);
  const member = (await service.runtimeFor(app.id)!.pg.load())?.members.find(row => row.id === joined.membership.memberId);
  expect(member).toMatchObject({ minor: false, minorSignal: false, age: 29 });
}, 60_000);

// spec/memberAge.md, "Quoted age evidence does not change the sender"
test("fresh Slop onboarding preserves the member's age and matching tags across a quoted age", () => {
  const now = clock.now();
  const fresh = slopOnboarding.read(undefined, "I'm a woman looking for men.", [], { now, age: 29 });
  expect(fresh.state).toMatchObject({ age: { value: 29 }, minor: false, declined: false });
  expect(fresh.tags.some(tag => tag.tag.startsWith("romance:"))).toBe(true);

  for (const text of [
    'She said "Hello. Age: 12."',
    'Can you proofread this draft: "Hello. Age: 15',
    'The character whispered, "I’m in 7th grade."',
    'Can you check the dialogue: "I’m underage."',
    'One example: "I’m in middle school.',
    'I told her "Mara said ‘I’m underage.’"',
    'I said “I’m 17.”',
    'Yesterday she told me “I’m underage.”',
    'Yesterday I told her “I’m 17.”',
    'Yesterday I read a draft: “I’m underage.”',
    'She said "For a meme: ‘I’m underage.’"',
    'Translate this: “I’m underage.”',
    'Caption for the photo: "Hello. Age: 15',
    '“I’m in seventh grade.”',
    "He said 'my parents' place is too far. I'm 12 years old.'",
    'He said ‘my parents’ place is too far. I’m 12 years old.’',
    "She said 'cause I'm underage'",
  ]) {
    const quoted = slopOnboarding.read(fresh.state, text, [], { now, age: 29 });
    expect(quoted.state, text).toMatchObject({ age: { value: 29 }, minor: false, declined: false });
    expect(quoted.tags, text).toEqual(fresh.tags);
  }

  for (const text of [
    'Yesterday, I told her “I’m underage.”',
    'I’ve literally said “I’m underage.”',
    'Yesterday I told her “I’m in 7th grade.”',
    "I replied late 'cause I'm underage.",
    'I replied late ’cause I’m underage.',
    'I replied late, ’cause I’m underage.',
    "She said 'we are friends' and I'm underage.",
  ]) {
    const restricted = slopOnboarding.read(fresh.state, text, [], { now, age: 29 });
    expect(restricted.state, text).toMatchObject({ age: { value: 29 }, minor: true, declined: false });
    expect(restricted.tags).toEqual([]);
  }

  const own = slopOnboarding.read(fresh.state, "I'm in 7th grade.", [], { now, age: 29 });
  expect(own.state).toMatchObject({ age: { value: 12 }, minor: true, declined: false });
  expect(own.tags).toEqual([]);
}, 60_000);

test.each([
  ["third-party nested quote", "+17185550182", 'She said "For a meme: ‘I’m underage.’"', 29, false],
  ["translation of quoted dialogue", "+17185550183", 'Translate this: “I’m underage.”', 29, false],
  ["unfinished caption with an exact age", "+17185550184", 'Caption for the photo: "Hello. Age: 15', 29, false],
  ["a possessive in reported speech", "+17185550185", "He said 'my parents' place is too far. I'm 12 years old.'", 29, false],
  ["a direct disclosure after an elision", "+17185550186", "I replied late 'cause I'm underage.", 17, true],
  ["a direct disclosure after a closing quote", "+17185550187", "She said 'we are friends' and I'm underage.", 17, true],
  ["reported speech beginning with an elision", "+17185550188", "She said 'cause I'm underage'", 29, false],
  ["a direct disclosure after a comma and elision", "+17185550189", "I replied late, ’cause I’m underage.", 17, true],
])("a signed review attributes age evidence for %s", async (scenario, phone, text, floor, minor) => {
  const app = APPS.friends;
  await service.accounts.invite(app, phone);
  const person = (await service.accounts.personFor(phone))!;
  const joined = await service.accounts.join(app, { e164: phone, personId: person.id }, {
    firstName: "Ari", age: 29, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
  });
  if (!joined.ok) throw new Error(joined.error);
  clock.advance(MINUTE);
  expect((await post(turn(scenario, phone, text, app.id))).status).toBe(200);
  const stored = (await service.runtimeFor(app.id)!.pg.load())?.members.find(row => row.id === joined.membership.memberId);
  const state = { floor: await service.accounts.lowestAge(phone, person), minor: stored?.minor, signal: stored?.minorSignal };
  expect(state, text).toEqual({ floor, minor, signal: minor });
}, 60_000);

// spec/travelPresence.md, "Tell the Network my travel dates"
test("signed travel stores one coarse trip in the routed app and never guesses missing dates", async () => {
  const phone = "+12125550155";
  for (const app of [APPS.friends, APPS.slop]) {
    await service.accounts.invite(app, phone);
    const person = (await service.accounts.personFor(phone))!;
    const joined = await service.accounts.join(app, { e164: phone, personId: person.id }, {
      firstName: "Ari", age: 29, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
    });
    expect(joined.ok).toBe(true);
  }
  const trips = () => sql`select p.app_id, p.city, p.from_at, p.to_at, p.areas, m.home_city from network.presence p
    join network.members m on m.app_id=p.app_id and m.id=p.member_id
    join platform.phone_identities ph on ph.person_id=m.person_id
    where ph.e164=${phone} and p.type='temporary'`;
  const declare = (id: string, text: string) => post(turn(id, phone, text, "friends"));
  const before = escaped;
  const unclear = await declare("travel-unclear", "I'll be in SF the 10th to the 14th.");
  expect(unclear.status).toBe(200);
  expect((await unclear.json()).replies[0]).toContain("YYYY-MM-DD");
  expect(await trips()).toHaveLength(0);
  const statement = "I will be in San Francisco from 2026-10-31 until 2026-11-02.";
  const stranger = await post(turn("travel-not-member", "+12125550156", statement, "friends"));
  expect(stranger.status).toBe(200);
  expect(await stranger.json()).toMatchObject({ memberId: null, reason: "travel_presence", replies: [] });
  expect(await service.accounts.personFor("+12125550156")).toBeUndefined();
  const request = turn("travel-valid", phone, statement, "friends");
  const first = await post(request);
  expect(first.status).toBe(200);
  const accepted = await first.json();
  expect(accepted).toMatchObject({ app: "friends", reason: "travel_presence", replyKind: "reply", replies: [expect.stringContaining("Saved in friends.help")] });
  expect(await (await post(request)).json()).toEqual(accepted);
  expect((await (await declare("travel-duplicate", statement)).json()).replies[0]).toContain("Already saved");
  expect((await (await declare("travel-conflict", "I will be in Los Angeles from 2026-11-01 until 2026-11-03.")).json()).replies[0]).toContain("overlap");
  expect(await trips()).toEqual([expect.objectContaining({
    app_id: "friends", city: "sf", home_city: "nyc", areas: [],
    from_at: new Date("2026-10-31T07:00:00Z"), to_at: new Date("2026-11-02T08:00:00Z"),
  })]);
  expect(escaped).toBe(before);
  expect((await declare("travel-stop", "STOP")).status).toBe(200);
  const lockedReplay = await post(request);
  expect(lockedReplay.status).toBe(409);
  expect(await lockedReplay.json()).toEqual({ error: "turn_travel_account_changed", retryable: false });
}, 60_000);

test("a saved travel window keeps its exact signed reply after the runtime stops", async () => {
  const phone = "+12125550173", app = APPS.friends;
  const joined = await service.accounts.join(app, { e164: phone, personId: null }, {
    firstName: "Remy", age: 31, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
  });
  if (!joined.ok) throw new Error(`Travel fixture signup failed: ${joined.error}`);
  const rt = service.runtimeFor(app.id)!;
  const original = rt.unitOfWork.bind(rt);
  const request = turn("travel-committed-before-runtime-stop", phone,
    "I will be in San Francisco from 2026-11-29 until 2026-12-02.", app.id);
  let stopped = false;
  rt.unitOfWork = async (fn, scheduling) => {
    const result = await original(fn, scheduling);
    if (result === "travel_presence") {
      stopped = true;
      throw new Error("Fixture runtime stopped after its save");
    }
    return result;
  };
  let response: Response;
  try {
    response = await post(request);
  } finally {
    rt.unitOfWork = original;
  }
  expect(stopped).toBe(true);
  const saved = await sql`select city from network.presence where app_id=${app.id}
    and member_id=${joined.membership.memberId} and type='temporary'`;
  expect(saved).toEqual([{ city: "sf" }]);
  expect(response.status).toBe(200);
  const reply = await response.json();
  expect(reply).toMatchObject({ app: "friends", reason: "travel_presence", replies: [expect.stringContaining("Saved in friends.help")] });
  const replay = await post(request);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(reply);
  expect(await sql`select city from network.presence where app_id=${app.id}
    and member_id=${joined.membership.memberId} and type='temporary'`).toEqual(saved);
}, 15_000);

// spec/standingIntentManagement.md, "Reconcile older saved controls during the first normal save"
test("reconciles legacy intent controls for the current app and owner once and preserves timestamps", async () => {
  const phone = "+12125550165", inactivePhone = "+12125550166";
  async function join(app: AppInfo, e164: string) {
    await service.accounts.invite(app, e164);
    const person = (await service.accounts.personFor(e164))!;
    const joined = await service.accounts.join(app, { e164, personId: person.id }, {
      firstName: "Ari", age: 29, consent: { sms: true, wording: app.consent.text },
    });
    if (!joined.ok) throw new Error("Intent reconciliation fixture join failed");
    return joined.membership.memberId;
  }
  const owner = await join(APPS.friends, phone);
  const inactive = await join(APPS.friends, inactivePhone);
  const otherApp = await join(APPS.slop, phone);
  const now = clock.now();
  const old = new Date(now - DAY), expired = new Date(now - 60 * DAY), newer = new Date(now + MINUTE);
  const raw = [
    { id: "legacy-pause", app: "friends", member: owner, status: "active", at: old },
    { id: "legacy-close", app: "friends", member: owner, status: "paused", at: old },
    { id: "legacy-done", app: "friends", member: owner, status: "closed", at: old },
    { id: "legacy-expired", app: "friends", member: owner, status: "active", at: expired },
    { id: "legacy-newer", app: "friends", member: owner, status: "active", at: newer },
    { id: "legacy-job", app: "friends", member: owner, status: "active", at: old, details: "peon:job legacy fixture" },
    { id: "legacy-inactive", app: "friends", member: inactive, status: "active", at: old },
    { id: "legacy-other-app", app: "slop", member: otherApp, status: "active", at: old },
    { id: "legacy-unselected", app: "friends", member: owner, status: "active", at: old },
  ];
  await sql`insert into network.intents ${sql(raw.map(row => ({
    id: row.id, app_id: row.app, member_id: row.member, objective: "Looking for something", category: "hobby", status: row.status,
    created_at: row.at, horizon_days: 60, details: row.details ?? null,
  })))}`;
  await sql`update platform.memberships set state = 'paused' where app_id = 'friends' and member_id = ${inactive}`;
  const [prior] = await sql<{ state: NetworkState }[]>`select state from network.network_state where id = 'friends:nyc'`;
  const state = prior!.state;
  state.savedAt = now;
  delete state.legacyIntentRowsReconciled;
  state.members.find(m => m.id === owner)!.intentControls = {
    "stored:legacy-pause": "PauseControl", "stored:legacy-close": "CloseControl", "stored:legacy-done": "PauseControl",
    "stored:legacy-expired": "PauseControl", "stored:legacy-newer": "CloseControl", "stored:legacy-job": "CloseControl",
    "stored:legacy-other-app": "PauseControl", "stored:missing-legacy-row": "CloseControl", "learned:climb-partner": "PauseControl",
  };
  state.members.find(m => m.id === inactive)!.intentControls = {
    "stored:legacy-inactive": "PauseControl", "stored:legacy-unselected": "CloseControl",
  };
  await sql`update network.network_state set state = ${state}::jsonb where id = 'friends:nyc'`;

  const snapshot = () => sql<{ id: string; status: string; created_at: Date; horizon_days: number }[]>`select id, status, created_at, horizon_days
    from network.intents where id like 'legacy-%' order by id`;
  const before = escaped;
  const result = await post(turn("legacy-intents-show", phone, "list my intents", "friends"));
  expect(result.status).toBe(200);
  const listed: string = (await result.json()).replies[0];
  expect(listed.split("\n")[0]).toBe("What you're looking for in friends (1/1)");
  expect(listed.split("\n").at(-1)).toBe("Reply PAUSE 1, RESUME 1 or CLOSE 1.");
  const rows = await snapshot();
  expect([...rows]).toEqual(raw.map(row => ({
    id: row.id, status: row.id === "legacy-pause" ? "paused" : row.id === "legacy-close" ? "closed" : row.status,
    created_at: row.at, horizon_days: 60,
  })).sort((a, b) => a.id.localeCompare(b.id)));
  const [saved] = await sql<{ state: NetworkState }[]>`select state from network.network_state where id = 'friends:nyc'`;
  expect(saved?.state.legacyIntentRowsReconciled).toBe(true);
  expect(saved?.state.members.find(m => m.id === owner)?.intentControls?.["learned:climb-partner"]).toBe("PauseControl");

  await server.stop(true);
  await service.close();
  await start();
  expect((await post(turn("legacy-intents-again", phone, "list my intents", "friends"))).status).toBe(200);
  expect([...await snapshot()]).toEqual([...rows]);
  expect(escaped).toBe(before);
}, 60_000);

// spec/soloConcierge.md, "Get ideas for my own time"
test("signed solo concierge offers current public listings without recruiting another member", async () => {
  await server.stop(true);
  await service.close();
  await start(undefined, true);
  lineSends.length = 0;
  try {
    const adult = "+12125550157", teen = "+12125550158";
    for (const [phone, age] of [[adult, 20], [teen, 16]] as const) {
      await service.accounts.invite(APPS.friends, phone);
      const person = (await service.accounts.personFor(phone))!;
      const joined = await service.accounts.join(APPS.friends, { e164: phone, personId: person.id }, {
        firstName: "Ari", age, homeCity: "nyc", neighborhood: "Greenpoint", interests: ["nature"],
        consent: { sms: true, wording: APPS.friends.consent.text },
      });
      if (!joined.ok) throw new Error("Concierge fixture join failed");
      const member = joined.membership.memberId;
      await sql`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, status, valid_from)
        values ('friends', ${`${member}:available`}, ${member}, 'availability_pattern', 'Saturday afternoon', '{afternoon:Sat}', 'matchable', 'said', 'confirmed', ${new Date(clock.now())})`;
    }

    const listing = (guid: string, title: string, categories: string, from: string, to: string, location = "McCarren Park", coordinates = "40.7206,-73.9518") => ({
      guid, title, categories, location, coordinates, starttime: from, endtime: to,
      link: { url: `https://www.nycgovparks.org/events/2026/10/10/one-solo-event-${guid}` },
    });
    const event = (id: string, title: string, tags: string, start = "14", end = "15") => listing(id, title, tags, `2026-10-10T${start}:00:00`, `2026-10-10T${end}:00:00`);
    const allAges = event("110", "Nature sketch walk", "Nature | All ages");
    expect(await importPublicEvents(sql, clock, async () => Response.json([
      allAges, event("111", "Public art tour", "Arts"), event("112", "Garden history tour", "History"), event("113", "Public chess group", "Chess"),
      event("114", "Evening music 21+", "Music | All ages"), event("115", "Early garden tour", "Nature | All ages", "09", "10"),
      listing("116", "Weekday walk", "Nature | All ages", "2026-10-12T14:00:00", "2026-10-12T15:00:00"),
      listing("117", "Chelsea garden sketching", "Arts | All ages", "2026-10-10T14:00:00", "2026-10-10T15:00:00", "Chelsea Market", "40.7479,-74.0014"),
    ]))).toEqual({ published: true, events: 8 });

    await service.runtimeFor("friends")!.deliver();
    const welcomes = new Map(lineSends.map(sent => [sent.to, sent.text]));
    expect(lineSends).toHaveLength(2);
    expect(welcomes).toEqual(new Map([
      [adult, "Hi Ari, I'm friends.help's planner (an AI). Now and then I'll suggest a person or plan that seems worth your time, and you can always ask me for something. Reply STOP anytime to opt out. To start: what would you like more of in your life right now?"],
      [teen, "Hi Ari, I'm friends.help's planner (an AI). Since you're under 18, I won't introduce you to other members, but I can suggest public places and events. If you tell me your birthday (month, day and year), I can look for friends close to your age. Reply STOP anytime to opt out. What are you into?"],
    ]));
    const before = escaped;
    const request = (id: string, phone: string) => turn(id, phone, "Anything fun this weekend?", "friends");
    const asked = request("adults-solo-events", adult);
    const response = await post(asked);
    expect(response.status).toBe(200);
    const accepted = await response.json();
    expect(accepted).toMatchObject({ outcome: "handled", app: "friends", reason: "solo_events", replyKind: "reply" });
    const picks = accepted.replies[0].split("\n");
    expect(picks).toHaveLength(3);
    expect(picks[0]).toContain("Nature sketch walk");
    expect(picks[0]).toContain("Fits one of your interests");
    expect(picks[0]).toContain(allAges.link.url);
    const [queued] = await sql`select status from platform.outbound where id = ${accepted.replyIds[0]}`;
    expect(queued?.status).toBe("collected");
    expect(picks.join(" ")).not.toMatch(/21\+|Early garden tour|Weekday walk/);
    expect(await (await post(asked)).json()).toEqual(accepted);

    const teenResponse = await post(request("all-ages-solo-events", teen));
    expect(teenResponse.status).toBe(200);
    const teenAnswer = (await teenResponse.json()).replies[0];
    expect(teenAnswer.split("\n")).toHaveLength(2);
    expect(teenAnswer).toContain("Nature sketch walk");
    const named = turn("area-solo-events", adult, "Anything fun near chelsea market this weekend?", "friends");
    const namedResponse = await post(named);
    expect(namedResponse.status).toBe(200);
    const namedAnswer = await namedResponse.json();
    expect(namedAnswer).toMatchObject({ outcome: "handled", app: "friends", reason: "solo_events" });
    expect(namedAnswer.replies[0].split("\n")).toHaveLength(1);
    expect(namedAnswer.replies[0]).toContain("Chelsea garden sketching");
    expect(await (await post(named)).json()).toEqual(namedAnswer);
    const clarification = turn("unknown-solo-events", adult, "Find events near Moon Harbor this weekend?", "friends");
    const unknownResponse = await post(clarification);
    expect(unknownResponse.status).toBe(200);
    const unknown = await unknownResponse.json();
    expect(unknown).toMatchObject({ outcome: "handled", app: "friends", reason: "solo_events" });
    expect(unknown.replies[0]).toContain("Which NYC neighborhood should I use?");
    expect(unknown.replies[0]).not.toContain("Moon Harbor");
    expect(await sql`select id from network.requests where app_id='friends'`).toHaveLength(0);
    expect(await sql`select id from network.opportunities where app_id='friends'`).toHaveLength(0);

    clock.advance(MINUTE);
    expect(await importPublicEvents(sql, clock, async () => Response.json([]))).toEqual({ published: true, events: 0 });
    const previous = await post(asked);
    expect(previous.status).toBe(409);
    expect(await previous.json()).toEqual({ error: "turn_concierge_changed", retryable: false });
    const empty = await post(request("no-current-solo-events", adult));
    expect((await empty.json()).replies[0]).toContain("couldn't find any current NYC Parks listings");
    const compound = await post(turn("compound-solo-events", teen, "Anything fun near Chelsea Market but I'm 16.", "friends"));
    expect(compound.status).toBe(200);
    expect((await compound.json()).reason).not.toBe("solo_events");
    expect(escaped).toBe(before);
    expect(lineSends).toHaveLength(2);
  } finally {
    await server.stop(true);
    await service.close();
    await start();
  }
}, 60_000);

// spec/soloConcierge.md, "Get ideas for my own time": a trip away takes precedence over home city.
test("signed solo concierge uses the trip city while the member is away", async () => {
  await server.stop(true);
  await service.close();
  await start(undefined, true);
  try {
    const visitor = "+12125550161", away = "+12125550162";
    const join = async (phone: string, homeCity: "nyc" | "chicago") => {
      await service.accounts.invite(APPS.friends, phone);
      const person = (await service.accounts.personFor(phone))!;
      const joined = await service.accounts.join(APPS.friends, { e164: phone, personId: person.id }, {
        firstName: "Ari", age: 20, homeCity, interests: ["nature"],
        consent: { sms: true, wording: APPS.friends.consent.text },
      });
      if (!joined.ok) throw new Error("Concierge trip fixture join failed");
      return joined.membership.memberId;
    };
    const visitorId = await join(visitor, "chicago");
    const awayId = await join(away, "nyc");
    const trip = (member: string, city: string) => sql`insert into network.presence (app_id, member_id, city, type, from_at, to_at)
      values ('friends', ${member}, ${city}, 'temporary', ${new Date("2026-10-09T04:00:00Z")}, ${new Date("2026-10-12T04:00:00Z")})`;
    await trip(visitorId, "nyc");
    await trip(awayId, "chicago");
    clock.advance(2 * MINUTE);
    expect(await importPublicEvents(sql, clock, async () => Response.json([{
      guid: "210", title: "Harbor nature walk", categories: "Nature | All ages", location: "McCarren Park", coordinates: "40.7206,-73.9518",
      starttime: "2026-10-10T14:00:00", endtime: "2026-10-10T15:00:00",
      link: { url: "https://www.nycgovparks.org/events/2026/10/10/harbor-nature-walk-210" },
    }]))).toEqual({ published: true, events: 1 });
    const visiting = await (await post(turn("visiting-solo-events", visitor, "Anything fun this weekend?", "friends"))).json();
    expect(visiting).toMatchObject({ outcome: "handled", app: "friends", reason: "solo_events" });
    expect(visiting.replies[0]).toContain("Harbor nature walk");
    const awayAnswer = await (await post(turn("away-solo-events", away, "Anything fun this weekend?", "friends"))).json();
    expect(awayAnswer).toMatchObject({ outcome: "handled", app: "friends", reason: "solo_events" });
    expect(awayAnswer.replies[0]).not.toContain("Harbor nature walk");
    expect(awayAnswer.replies[0]).not.toContain("NYC Parks");
  } finally {
    await server.stop(true);
    await service.close();
    await start();
  }
}, 60_000);

// spec/contributionHistory.md, "Show verified acts a page at a time"
test("signed contribution history scopes verified acts to the current adult and app", async () => {
  await server.stop(true);
  await service.close();
  await start(undefined, true);
  try {
    const adult = "+12125550167", teen = "+12125550168", stranger = "+12125550169";
    const join = async (app: AppInfo, phone: string, age: number) => {
      await service.accounts.invite(app, phone);
      const person = (await service.accounts.personFor(phone))!;
      const joined = await service.accounts.join(app, { e164: phone, personId: person.id }, {
        firstName: "Ari", age, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
      });
      if (!joined.ok) throw new Error("Contribution history fixture join failed");
      return joined.membership.memberId;
    };
    const owner = await join(APPS.friends, adult, 30);
    await join(APPS.slop, adult, 30);
    const minor = await join(APPS.friends, teen, 17);
    const other = "contribution-other-member", invitee = "contribution-invitee", provider = "contribution-provider";
    const planId = "contribution-private-plan", privateLabel = "private venue call 212-555-0101";
    const t = clock.now() - DAY;
    const seed = async (...events: CapitalEvent[]) => {
      const rows = events.map(event => ({
        app_id: "friends", id: event.id, type: event.type, member_id: "member" in event ? event.member : null, t: new Date(event.t), event,
      }));
      await sql`insert into network.capital_events ${sql(rows)}`;
    };
    await seed(
      ...[owner, minor, other, invitee, provider].map((member): CapitalEvent => ({
        id: `contribution-joined:${member}`, type: "member_joined", member, age: 30, t,
        ...(member === invitee ? { vouchedBy: owner } : {}),
      })),
      { id: "contribution-active", type: "member_activated", member: invitee, t: t + 1 },
      { id: "contribution-value", type: "value_received", member: invitee, with: [provider], confirmedBy: [provider], t: t + 1 },
      { id: "contribution-accepted", type: "plan_accepted", member: owner, planId, kind: "plan", startsAt: t + 4, t: t + 2 },
      { id: "contribution-feedback", type: "feedback_given", member: owner, planId, t: t + 2 },
      { id: "contribution-attended", type: "plan_attended", member: owner, planId, counterparts: [provider], verifiedBy: ["counterpart"], origin: "engine", publicVenue: true, t: t + 2 },
      { id: "contribution-help", type: "help_given", helper: owner, recipient: other, helpId: "contribution-help-private", t: t + 3 },
      { id: "contribution-useful", type: "help_confirmed", recipient: other, helpId: "contribution-help-private", useful: true, t: t + 3 },
      { id: "contribution-organized", type: "organized", organizer: owner, planId, publicVenue: true, recurring: false, attendees: [invitee, provider], label: privateLabel, t: t + 4 },
      { id: "contribution-need", type: "need_answered", member: owner, needId: "contribution-private-need", confirmedBy: "staff", t: t + 5 },
      { id: "contribution-other", type: "review_completed", member: other, items: 1, t: t + 6 },
      { id: "contribution-minor-history", type: "review_completed", member: minor, items: 1, t: t + 6 },
    );

    // Old exports can store a serialized event inside the JSONB column.
    await sql`update network.capital_events set event = to_jsonb(event::text)
      where app_id = 'friends' and id = 'contribution-attended'`;

    const text = "Show my contribution history";
    const before = escaped;
    const initial = turn("history-adult", adult, text, "friends");
    const first = await post(initial);
    expect(first.status).toBe(200);
    const firstPage = await first.json();
    expect(firstPage).toMatchObject({ app: "friends", memberId: owner, reason: "contribution_history", replyKind: "reply" });
    const body = firstPage.replies[0];
    expect(body.split("\n").filter((line: string) => line.startsWith("•"))).toHaveLength(5);
    expect(body).toContain("Gave feedback");
    expect(body).toContain("Organized a public plan");
    expect(body).toContain("Helped a member");
    expect(body).not.toContain("Helped review");
    for (const hidden of [privateLabel, other, planId, invitee, provider]) expect(body).not.toContain(hidden);
    expect(await (await post(initial)).json()).toEqual(firstPage);
    const [queued] = await sql`select status from platform.outbound where id = ${firstPage.replyIds[0]}`;
    expect(queued?.status).toBe("collected");
    const second = await post(turn("history-page-two", adult, `${text} page 2`, "friends"));
    expect((await second.json()).replies[0]).toContain("Vouched for someone who became active");

    const otherApp = await post(turn("history-other-app", adult, text, "slop"));
    expect(await otherApp.json()).toMatchObject({ app: "slop", replies: [expect.stringContaining("No confirmed contributions")] });
    for (const [id, phone] of [["history-minor", teen], ["history-nonmember", stranger]]) {
      const denied = await post(turn(id!, phone!, text, "friends"));
      expect(denied.status).toBe(200);
      expect(await denied.json()).toMatchObject({ reason: "contribution_history", replies: [] });
    }
    expect(await service.accounts.personFor(stranger)).toBeUndefined();

    await seed({ id: "contribution-correction", type: "fraud_confirmed", members: [owner, other], t: t + 7 });
    const stale = await post(initial);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "turn_contribution_history_changed", retryable: false });
    const refreshed = turn("history-refreshed", adult, text, "friends");
    const current = await post(refreshed);
    expect(current.status).toBe(200);
    expect((await current.json()).replies[0]).not.toContain("Helped a member");

    expect((await post(turn("history-leave", adult, "leave friends", "friends"))).status).toBe(200);
    expect((await post(refreshed)).status).toBe(409);
    expect(await service.accounts.activeMembership(APPS.slop, { e164: adult, personId: null })).toBeDefined();
    expect(escaped).toBe(before);
  } finally {
    await server.stop(true);
    await service.close();
    await start();
  }
}, 60_000);

test("canonical membership STOP is collected atomically and cannot drain to a provider on restart",async()=>{
  const phone="+12125550121";
  const call=async(path:string,body:unknown,cookie?:string)=>fetchWithHost(new URL(path,server.url),{method:"POST",headers:{host:"localhost:5102","content-type":"application/json",...(cookie?{cookie}:{})},body:JSON.stringify(body)});
  expect((await call("/api/auth/otp/start",{phone})).status).toBe(200);
  const login=await call("/api/auth/otp/verify",{phone,code});expect(login.status).toBe(200);
  const cookie=login.headers.get("set-cookie")!.split(";")[0]!;
  expect((await call("/api/join",{firstName:"Ari",age:29,consent:{sms:true,wording:APPS.slop.consent.text}},cookie)).status).toBe(200);
  const [member]=await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id=m.person_id where m.app_id='slop' and ph.e164=${phone}`;
  expect(member?.id).toBeDefined();
  const other=turn("other-app-help",phone,"HELP","friends");
  expect((await post(other)).status).toBe(200);
  const before=escaped;
  const input=turn("member-stop",phone,"STOP","slop"), response=await post(input);expect(response.status).toBe(200);
  const body=await response.json() as any;expect(body.replies.length).toBe(1);expect(body.accountEligible).toBe(false);expect(body.consent.scope).toBe("all");expect(body.consent.app).toBeNull();
  expect(await service.accounts.optedIn("slop",phone)).toBe(false);
  const rows=await sql`select status,inbound_id from network.messages where app_id='slop' and inbound_id='msg:blooio:member-stop'`;
  expect(rows.length).toBe(1);expect(rows[0].status).toBe("collected");
  expect(await sql`select status,line from platform.outbound where id=${body.replyIds[0]}`).toEqual([{status:"collected",line:"dry-run"}]);
  const ack:TurnReceiptRequest={channel:input.channel,messageId:input.messageId,replyIds:body.replyIds,outcome:"unknown",providerMessageIds:[],historyRecorded:false};
  expect((await receipt({...ack,replyIds:["unrelated-output"]})).status).toBe(409);
  const unknown=await receipt(ack);expect(unknown.status).toBe(200);expect(await unknown.json()).toEqual({ok:true,replayed:false});
  expect((await sql`select status from network.messages where inbound_id='msg:blooio:member-stop'`)[0].status).toBe("send_unknown");
  const accepted={...ack,outcome:"accepted" as const,providerMessageIds:["synthetic-provider-receipt"]};
  expect((await receipt(accepted)).status).toBe(200);
  expect((await sql`select status from network.messages where inbound_id='msg:blooio:member-stop'`)[0].status).toBe("sent");
  expect(await (await receipt(accepted)).json()).toEqual({ok:true,replayed:true});
  expect((await receipt({...accepted,providerMessageIds:["altered-receipt"]})).status).toBe(409);
  expect(escaped).toBe(before);
  await server.stop(true);await service.close();await start();expect(await (await post(input)).json()).toEqual(body);expect(escaped).toBe(before);
  // The canonical public leave path seals prior personal reply payloads, while STOP remains in force.
  expect((await call("/api/me/delete",{scope:"app"},cookie)).status).toBe(200);
  expect((await post(input)).status).toBe(409);
  const [erased]=await sql`select response,replies,receipt,sender_hash,member_id,app_id from platform.inbound where id='msg:blooio:member-stop'`;
  expect(erased.response).toBeNull();expect(erased.replies).toEqual([]);expect(erased.receipt).toBeNull();expect(erased.sender_hash).toBeNull();expect(erased.member_id).toBeNull();expect(erased.app_id).toBeNull();
  const [retained]=await sql`select response,replies,app_id from platform.inbound where id='msg:blooio:other-app-help'`;
  expect(retained.app_id).toBe("friends");expect(retained.response.outcome).toBe("handled");expect(retained.replies.length).toBe(1);
  expect(await service.accounts.optedIn("slop",phone)).toBe(false);
  await server.stop(true);await service.close();await start();expect((await post(input)).status).toBe(409);expect(escaped).toBe(before);
},60_000);

const joinFriendsByText = async (phone: string, prefix: string) => {
  expect((await post(turn(`${prefix}-start`, phone, "friends.help", "friends"))).status).toBe(200);
  const join = turn(`${prefix}-profile`, phone, "Noa, 29", "friends");
  const joined = await (await post(join)).json() as any;
  expect(joined).toMatchObject({outcome: "handled", reason: "joined", replyKind: "reply"});
  let n = 0;
  for (const text of ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"]) {
    clock.advance(MINUTE); expect((await post(turn(`${prefix}-onboard-${++n}`, phone, text, "friends"))).status).toBe(200);
  }
  return {join, joined};
};

test("a signed replay answers with current consent and context, and dry-run collected replies join the thread history", async () => {
  const phone = "+12125550174", before = escaped;
  const {join, joined} = await joinFriendsByText(phone, "replay");
  const history = await sql`select id,status,line from platform.outbound where id in ${sql(joined.replyIds as string[])}`;
  expect(history.length).toBeGreaterThan(0);
  expect(history.every(row => row.status === "collected" && row.line === "dry-run")).toBe(true);
  const chat = turn("replay-open", phone, "Tell me something about the weather", "friends");
  const open = await (await post(chat)).json() as any;
  expect(open).toMatchObject({outcome: "open", app: "friends", context: {state: "open"}});
  await service.runtimes.get("friends:nyc")!.scoped(tx => tx`update network.members set participation_state='quiet' where app_id='friends' and id=${open.memberId}`);
  const changed = await post(chat);
  expect(changed.status).toBe(200);
  expect(await changed.json()).toEqual({...open, context: {...open.context, state: "busy"}});
  const stop = turn("replay-stop", phone, "STOP", "friends");
  const stopped = await (await post(stop)).json() as any;
  expect(stopped).toMatchObject({outcome: "handled", replyKind: "compliance"});
  const lateJoin = await post(join);
  expect(lateJoin.status).toBe(409);
  expect(await lateJoin.json()).toEqual({error: "turn_context_changed", retryable: false});
  expect((await post(chat)).status).toBe(409);
  expect(await (await post(stop)).json()).toEqual(stopped);
  expect(escaped).toBe(before);
}, 60_000);

test("a member with more than fifty shareable facts gets the newest fifty in the open context", async () => {
  const phone = "+12125550175";
  const {joined} = await joinFriendsByText(phone, "facets");
  const member = joined.memberId as string;
  for (let i = 0; i < 55; i++) {
    await service.runtimeFor("friends")!.scoped(tx => tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, status, valid_from)
      values ('friends', ${`${member}:many-${i}`}, ${member}, 'interest', ${`Shared interest number ${i}`}, '{}', 'shareable', 'said', 'confirmed', ${new Date(clock.now() - (60 - i) * MINUTE)})`);
  }
  await service.runtimeFor("friends")!.scoped(tx => tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, status, valid_from)
    values ('friends', ${`${member}:long`}, ${member}, 'interest', ${"x".repeat(301)}, '{}', 'shareable', 'said', 'confirmed', ${new Date(clock.now() - MINUTE)})`);
  const open = await (await post(turn("facets-open", phone, "Tell me something about the weather", "friends"))).json() as any;
  expect(open).toMatchObject({outcome: "open", app: "friends", memberId: member});
  expect(open.context.facets).toHaveLength(50);
  expect(open.context.facets).toContain("Shared interest number 54");
  expect(open.context.facets).not.toContain("Shared interest number 0");
  expect(open.context.facets.every((fact: string) => fact.length <= 300)).toBe(true);
}, 60_000);

test("a member whose context is withheld gets the fixed handled reply, never silence", async () => {
  const phone = "+12125550177", before = escaped;
  const {joined} = await joinFriendsByText(phone, "withheld");
  const member = joined.memberId as string;
  await service.runtimeFor("friends")!.scoped(tx => tx`update network.members set name='noa@example.com' where app_id='friends' and id=${member}`);
  const answer = await post(turn("withheld-open", phone, "Tell me something about the weather", "friends"));
  expect(answer.status).toBe(200);
  const body = await answer.json() as any;
  expect(body).toMatchObject({outcome: "handled", app: "friends", memberId: member, reason: "context_unavailable", replyKind: "reply",
    replies: [CONTEXT_UNAVAILABLE_REPLY]});
  expect(await sql`select status,line from platform.outbound where id=${body.replyIds[0]}`).toEqual([{status: "collected", line: "dry-run"}]);
  expect(escaped).toBe(before);
}, 60_000);

test("a replayed open turn whose context became unavailable answers the fixed reply and keeps that answer", async () => {
  const phone = "+12125550182", before = escaped;
  const {joined} = await joinFriendsByText(phone, "replay-withheld");
  const member = joined.memberId as string;
  const chat = turn("replay-withheld-open", phone, "Tell me something about the weather", "friends");
  const open = await (await post(chat)).json() as any;
  expect(open).toMatchObject({outcome: "open", app: "friends", memberId: member});
  await service.runtimeFor("friends")!.scoped(tx => tx`update network.members set name='noa@example.com' where app_id='friends' and id=${member}`);
  const replayed = await post(chat);
  expect(replayed.status).toBe(200);
  const body = await replayed.json() as any;
  expect(body).toEqual({outcome: "handled", replies: [CONTEXT_UNAVAILABLE_REPLY], replyIds: ["sys:msg:blooio:replay-withheld-open:context"], delivery: "collected",
    replyKind: "reply", accountEligible: true, app: "friends", memberId: member, reason: "context_unavailable"});
  expect(await sql`select status,line from platform.outbound where id=${body.replyIds[0]}`).toEqual([{status: "collected", line: "dry-run"}]);
  expect(await (await post(chat)).json()).toEqual(body);
  const accepted = await receipt({channel: "blooio", messageId: "replay-withheld-open", replyIds: body.replyIds, providerMessageIds: ["provider-replay-withheld"],
    historyRecorded: true, outcome: "accepted"});
  expect(accepted.status).toBe(200);
  expect(escaped).toBe(before);
}, 60_000);

test("an admitted number whose membership no longer binds gets the fixed reply, not a silent handled turn", async () => {
  const phone = "+12125550178", before = escaped;
  const {joined} = await joinFriendsByText(phone, "unbound");
  const member = joined.memberId as string;
  await service.runtimeFor("friends")!.scoped(tx => tx`update network.members set name='noa@example.com' where app_id='friends' and id=${member}`);
  const person = (await service.accounts.personFor(phone))!;
  await sql`update platform.people set lowest_age=null, birth_date=null, birth_lower=null, birth_upper=null, birth_youngest=null, birth_first_exact=null where id=${person.id}`;
  await sql`delete from platform.age_floor where phone_hash=${service.accounts.phoneHash(phone)}`;
  expect(await service.accounts.lowestAge(phone, person)).toBeUndefined();
  const answer = await post(turn("unbound-open", phone, "Tell me something about the weather", "friends"));
  expect(answer.status).toBe(200);
  const body = await answer.json() as any;
  expect(body).toMatchObject({outcome: "handled", app: "friends", reason: "context_unavailable", replyKind: "reply", accountEligible: false,
    replies: [CONTEXT_UNAVAILABLE_REPLY], replyIds: ["sys:msg:blooio:unbound-open:context"]});
  expect(escaped).toBe(before);
}, 60_000);

test("UNSHARE takes a SHARE back, so a later grant read copies nothing", async () => {
  const phone = "+12125550183", before = escaped;
  const slopCopy = copyFor(brandOf(APPS.slop));
  const {joined} = await joinFriendsByText(phone, "unshare");
  const friendsMember = joined.memberId as string;
  await service.runtimeFor("friends")!.scoped(tx => tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, status, valid_from)
    values ('friends', ${`${friendsMember}:unshare-climbing`}, ${friendsMember}, 'interest', 'rock climbing', '{}', 'matchable', 'said', 'confirmed', ${new Date(clock.now() - DAY)})`);
  clock.advance(MINUTE);
  expect((await post(turn("unshare-slop-start", phone, "slop.date", "slop"))).status).toBe(200);
  clock.advance(MINUTE);
  const slopJoin = await (await post(turn("unshare-slop-profile", phone, "Kit, 29", "slop"))).json() as any;
  expect(slopJoin).toMatchObject({outcome: "handled", app: "slop", reason: "joined"});
  expect(slopJoin.replies).toContain(slopCopy.linkNotice);
  const slopMember = slopJoin.memberId as string;
  clock.advance(MINUTE);
  const shared = await (await post(turn("unshare-share", phone, "SHARE", "slop"))).json() as any;
  expect(shared).toMatchObject({outcome: "handled", app: "slop", memberId: slopMember, replies: [slopCopy.shareDone]});
  const person = (await service.accounts.personFor(phone))!;
  const slopRuntime = service.runtimeFor("slop")!;
  const copies = () => slopRuntime.scoped(tx => tx`select value from network.facets where app_id='slop' and member_id=${slopMember} and source='share_grant'`);
  expect(await copies()).toEqual([{value: "rock climbing"}]);
  clock.advance(MINUTE);
  const unshared = await (await post(turn("unshare-unshare", phone, "unshare", "slop"))).json() as any;
  expect(unshared).toMatchObject({outcome: "handled", app: "slop", memberId: slopMember, reason: "handled", replies: [slopCopy.unshareDone]});
  expect(await sql`select from_app, to_app, revoked_at is not null as revoked from platform.share_grants where person_id=${person.id}`)
    .toEqual([{from_app: "friends", to_app: "slop", revoked: true}]);
  expect(await copies()).toEqual([{value: "rock climbing"}]);
  await slopRuntime.scoped(tx => tx`delete from network.facets where app_id='slop' and member_id=${slopMember} and source='share_grant'`);
  const read = await applyBaseProfileGrants({people: service.people, banned: async () => false, runtimeFor: app => service.runtimeFor(app), now: clock.now()},
    person.id, {app: "slop", memberId: slopMember, runtime: slopRuntime});
  expect(read).toBe(0);
  expect(await copies()).toEqual([]);
  expect(await (await post(turn("unshare-unshare", phone, "unshare", "slop"))).json()).toEqual(unshared);
  expect(escaped).toBe(before);
}, 60_000);

test("a no-keyword join answers with the welcome and the looking-for question in the same handled turn", async () => {
  const phone = "+12125550184", before = escaped;
  expect((await post(turn("network-join-start", phone, "hey there"))).status).toBe(200);
  const joined = await (await post(turn("network-join-profile", phone, "Mo, 30"))).json() as any;
  expect(joined).toMatchObject({outcome: "handled", app: "ntwrk", reason: "joined", replyKind: "reply"});
  expect(joined.replies.length).toBeGreaterThan(1);
  expect(joined.replies.at(-1)).toBe(lookingForAsk(30));
  expect(escaped).toBe(before);
}, 60_000);

// spec/textEnrollment.md, "A current Network member's answer controls other-app enrollment"
test("a bare Friends answer to the pending shared-line question enrolls the current member", async () => {
  const phone = "+12125550139";
  const say = async (id: string, text: string) => {
    clock.advance(MINUTE);
    const response = await post(turn(id, phone, text));
    expect(response.status).toBe(200);
    return response.json();
  };
  expect(await say("enrollment-route-start", "hello")).toMatchObject({ app: "ntwrk", reason: "onboarding_asked" });
  expect(await say("enrollment-route-profile", "Ari, 29")).toMatchObject({ app: "ntwrk", reason: "joined" });
  const pending = () => service.people.getPending(service.accounts.phoneHash(phone), "looking_for");
  expect(await pending()).toMatchObject({ app: "ntwrk" });
  expect(await sql`select status, body like 'What are you looking for:%' as disclosed
    from network.messages where id='ask:in:blooio:enrollment-route-profile'`).toEqual([{ status: "collected", disclosed: true }]);
  expect(await say("enrollment-route-explicit", "join friends")).toMatchObject({ app: "friends", reason: "join_asked" });
  expect(await pending()).toMatchObject({ app: "ntwrk" });
  const person = (await service.accounts.personFor(phone))!;
  expect(await service.people.getMembership(person.id, "friends")).toBeUndefined();
  const answer = await say("enrollment-route-friends", "friends");
  expect(await service.people.getMembership(person.id, "friends")).toMatchObject({ state: "active", firstName: "Ari" });
  expect(answer).toMatchObject({ outcome: "handled", app: "ntwrk", replies: expect.arrayContaining([expect.stringMatching(/friends\.help/i)]) });
  expect(await pending()).toBeUndefined();
  expect(await sql`select app_id from platform.consent_events where e164=${phone} and source='looking_for'`)
    .toEqual([{ app_id: "friends" }]);
}, 60_000);

// spec/textEnrollment.md, "A pending join routes only a possible join answer"
test("an expired probe cannot route a signed shared-line reply away from the app that wrote last", async () => {
  const phone = "+12125550138";
  const created = await Promise.all([APPS.slop, APPS.friends].map(app => service.accounts.join(
    app, { e164: phone, personId: null }, {
      firstName: "Ren", age: 32, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
    },
  )));
  const [slop, friends] = created;
  if (!slop.ok || !friends.ok) throw new Error("Could not join both fixture apps");
  const expired = "shared-route-expired-probe", at = new Date(clock.now() - 3 * DAY), recent = new Date(clock.now() + MINUTE);
  await sql`insert into network.opportunities (app_id,id,kind,state,city,objective,created_at,updated_at)
    values ('slop',${expired},'intro','SKIPPED','nyc','A meeting',${at},${at})`;
  await sql`insert into network.messages (app_id,id,member_id,direction,channel,body,status,opportunity_id,type,ts)
    values ('slop','shared-route-expired-message',${slop.membership.memberId},'outbound','imessage','Would you like to meet?','dry_run',${expired},'probe',${at}),
      ('friends','shared-route-recent-message',${friends.membership.memberId},'outbound','imessage','How was your weekend?','dry_run',null,'info',${recent})`;
  clock.advance(2 * MINUTE);
  const response = await post(turn("enrollment-route-expired-probe", phone, "Thanks, my weekend was nice"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ app: "friends", memberId: friends.membership.memberId });
  expect(await sql`select app_id from network.messages where id='in:blooio:enrollment-route-expired-probe'`).toEqual([{ app_id: "friends" }]);

  const current = "shared-route-current-probe", probeAt = new Date(clock.now() - 2 * MINUTE);
  await sql`insert into network.opportunities (app_id,id,kind,state,city,objective,created_at,updated_at)
    values ('slop',${current},'intro','PROPOSED','nyc','A meeting',${probeAt},${probeAt})`;
  await sql`insert into network.messages (app_id,id,member_id,direction,channel,body,status,opportunity_id,type,ts)
    values ('slop','shared-route-current-message',${slop.membership.memberId},'outbound','imessage','Would you like to meet?','dry_run',${current},'probe',${probeAt})`;
  clock.advance(MINUTE);
  const active = await post(turn("enrollment-route-current-probe", phone, "Yes, please"));
  expect(active.status).toBe(200);
  expect(await active.json()).toMatchObject({ app: "slop", memberId: slop.membership.memberId });
}, 60_000);

// spec/notificationAcknowledgement.md, "Count a delivery action only when the store closes a pending delivery"
test("a signed member open turn records activity once, and STOP revokes replay without rerunning the turn",async()=>{
  const phone="+12125550141", before=escaped;
  const first=await post(turn("friends-join-start",phone,"friends.help","friends"));expect(first.status).toBe(200);
  expect((await first.json() as any).reason).toBe("onboarding_asked");
  const joined=await post(turn("friends-join-profile",phone,"Noa, 29","friends"));expect(joined.status).toBe(200);
  const j=await joined.json() as any;expect(j.reason).toBe("joined");expect(j.replies.length).toBeGreaterThan(0);
  let n=0;
  for (const text of ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"]) {
    clock.advance(MINUTE);expect((await post(turn(`friends-onboard-${++n}`,phone,text,"friends"))).status).toBe(200);
  }
  const personId=(await service.accounts.personFor(phone))!.id;
  const delivery=async (id:string)=>{
    await service.notify!.recordSent(
      {personId,app:"friends",eventType:"requested",subjectId:id,urgency:"requested",summary:"Your update is ready."},
      {deliveryId:id,channel:"imessage",countsTowardCap:true,sentAt:clock.now()},
    );
  };
  const outcome=async (id:string)=>(await sql`select outcome from notify.deliveries where person_id=${personId} and delivery_id=${id}`)[0]?.outcome;
  const firstDelivery="net:open-turn-before", nextDelivery="net:open-turn-after", stopDelivery="net:open-turn-stop";
  await delivery(firstDelivery);
  const wrongApp=await post(turn("friends-open-other-app",phone,"Tell me something about the weather","slop"));
  expect(wrongApp.status).toBe(200);
  expect(await wrongApp.json()).toMatchObject({outcome:"handled",app:"slop",memberId:null});
  const readProfile=await post(turn("friends-open-profile-read",phone,"show my Friends profile","friends"));
  expect(readProfile.status).toBe(200);
  expect(await readProfile.json()).toMatchObject({outcome:"handled",app:"friends"});
  expect(await service.submitProfile(personId,"friends",phone,"I enjoy hiking and cooking")).toBe("accepted");
  expect(await outcome(firstDelivery)).toBeNull();

  const input=turn("friends-open",phone,"Tell me something about the weather","friends");
  const r=await post(input);expect(r.status).toBe(200);const body=await r.json() as any;
  expect(body.outcome).toBe("open");expect(body.app).toBe("friends");expect(body.context.singlePlayer).toBe(false);expect(body.context.activeItems).toBeNull();
  expect(await outcome(firstDelivery)).toBe("acted");
  expect((await sql`select surface,acted from notify.surface_signals where person_id=${personId} and acted>0`))
    .toEqual([{surface:"imessage",acted:1}]);
  await delivery(nextDelivery);
  expect(await (await post(input)).json()).toEqual(body);
  expect(await outcome(nextDelivery)).toBeNull();
  // Canonical receiving is a valid recipient role; the wire's open state must not disable its chat.
  await service.runtimes.get("friends:nyc")!.scoped(tx=>tx`update network.members set participation_state='receiving' where app_id='friends' and id=${body.memberId}`);
  const receiving=await post(turn("friends-receiving-open",phone,"Tell me something about the weather","friends"));expect(receiving.status).toBe(200);
  const receivingBody=await receiving.json() as any;expect(receivingBody.outcome).toBe("open");expect(receivingBody.context.state).toBe("open");
  expect(await outcome(nextDelivery)).toBe("acted");
  await delivery(stopDelivery);
  expect(await outcome(stopDelivery)).toBeNull();
  expect((await post(turn("friends-stop",phone,"STOP","friends"))).status).toBe(200);
  expect(await outcome(stopDelivery)).not.toBe("acted");
  expect((await post(input)).status).toBe(409);
  expect(escaped).toBe(before);
},60_000);

// spec/safetyCase.md, "Direct polite safety requests use the existing counterpart chooser"
test("explicit polite safety requests use the signed member's current counterpart choices", async () => {
  const reporterPhone = "+12125550396";
  const join = (phone: string, firstName: string) => service.accounts.join(
    APPS.friends, { e164: phone, personId: null }, {
      firstName, age: 31, homeCity: "nyc", consent: { sms: true, wording: APPS.friends.consent.text },
    },
  );
  const [reporter, past, current] = await Promise.all([
    join(reporterPhone, "Mina"), join("+12125550397", "Nico"), join("+12125550398", "Zoe"),
  ]);
  if (!reporter.ok || !past.ok || !current.ok) throw new Error("Could not join the safety fixtures");
  const rt = service.runtimeFor("friends")!, reporterId = reporter.membership.memberId;
  // These are already delivered bookings. The journey exercises the signed text reader and durable safety actions.
  const booked = (otherId: string, stage: "done" | "scheduled") => rt.unitOfWork(n => {
    const state = n.exportState(), ids = [reporterId, otherId], now = clock.now();
    const meetingAt = now + (stage === "done" ? -DAY : DAY);
    const opp: NetworkState["opps"][number] = {
      id: `polite-safety-${stage}`, origin: "engine", kind: "intro", category: "social", objective: "Coffee", detail: "Coffee",
      participants: ids, alternates: [], primed: [], status: ids.map(id => [id, "yes"]), explanations: {},
      stage, meetingAt, deadline: now + DAY, createdAt: now - 2 * DAY,
      bookedTold: ids, bookedAt: Object.fromEntries(ids.map(id => [id, now - 2 * DAY])),
      score: 0.8, generator: "fixture",
      components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
      exploration: false, review: { queuedAt: now - 3 * DAY, deadline: now - 2 * DAY, decision: "approve", reviewer: "fixture" },
      sameDay: false, contacted: ids, reminded: [], feedbackFrom: [], tags: [], replacements: 0,
    };
    state.opps.push(opp);
    n.importState(state);
  });
  const say = async (id: string, text: string) => {
    clock.advance(MINUTE);
    const response = await post(turn(`polite-safety-${id}`, reporterPhone, text, "friends"));
    expect(response.status).toBe(200);
    return response.json();
  };
  const reports = () => rt.readState(n => n.safetyReports().filter(r => r.reporterId === reporterId));
  const blocks = () => sql`select to_id from network.edges where app_id='friends' and type='blocked' and from_id=${reporterId} order by to_id`;
  await booked(past.membership.memberId, "done");
  const hypothetical = await say("conditional", "Could you report Nico if I ask later?");
  expect((hypothetical.replies ?? []).join(" ")).not.toMatch(/Who do you mean/i);
  expect(await reports()).toEqual([]);
  expect(await blocks()).toEqual([]);
  expect(await say("request-report", "Could you report my date, he was rude?")).toMatchObject({
    outcome: "handled", replies: [expect.stringMatching(/^Who do you mean: Nico\?/)],
  });
  expect(await reports()).toEqual([]);
  await say("confirm-target", "Nico");
  expect(await reports()).toEqual([expect.objectContaining({ subjectId: past.membership.memberId, kind: "harassment" })]);

  await booked(current.membership.memberId, "scheduled");
  await say("calendar", "Can you block my calendar?");
  await say("delayed", "Can you block Zoe tomorrow?");
  expect(await blocks()).toEqual([{ to_id: past.membership.memberId }]);
  expect(await say("request-block", "Can you block my match?")).toMatchObject({
    outcome: "handled", replies: [expect.stringMatching(/^Done\./)],
  });
  expect((await blocks()).map(row => row.to_id).sort()).toEqual([past.membership.memberId, current.membership.memberId].sort());
  expect(await reports()).toHaveLength(1);
}, 60_000);

test("a committed collection followed by a fault stays unresolved and is never automatically rerun",async()=>{
  const original=service.inbound.bind(service);let handled=0;
  service.inbound=async(...args)=>{handled++;await original(...args);throw new Error("synthetic after-effect fault");};
  const input=turn("fault-after-effects","+12125550131","hello there");
  try {
    expect((await post(input)).status).toBe(409);expect((await post(input)).status).toBe(409);expect(handled).toBe(1);
    // A compliance turn (STOP, START, HELP, leave) whose reply committed before the fault is never sealed:
    // it answers with what committed (inbox.ts rescueCompliance), once, and is never rerun.
    const help=turn("fault-after-help","+12125550132","HELP");
    const rescued=await post(help);expect(rescued.status).toBe(200);
    const rescuedBody=await rescued.json() as any;expect(rescuedBody).toMatchObject({outcome:"handled",reason:"compliance_partial"});expect(rescuedBody.replies.length).toBe(1);
    expect(await (await post(help)).json()).toEqual(rescuedBody);expect(handled).toBe(2);
  } finally { service.inbound=original; }
  await service.tick();expect(handled).toBe(2);
  const [row]=await sql`select status,replies,response,sender,event from platform.inbound where id='msg:blooio:fault-after-effects'`;
  expect(row.status).toBe("unresolved");expect(row.replies).toEqual([]);expect(row.response).toBeNull();expect(row.sender).toBeNull();expect(row.event).toBeNull();
  // The unresolved turn holds this sender's ordinary messages back (at most 10 minutes); STOP, START and
  // HELP are never held back (inbox.ts), so the person can always get help or stop.
  clock.advance(MINUTE);expect((await post(turn("after-fault",input.from,"hello again"))).status).toBe(409);
  expect((await post(turn("after-fault-help",input.from,"HELP"))).status).toBe(200);
},60_000);


test("accepted handled replies repair the single Notify projection after faults, replay and restart, then erase on leave",async()=>{
  const phone="+12125550181",before=escaped;
  expect((await post(turn("handled-join-start",phone,"friends.help","friends"))).status).toBe(200);
  expect((await post(turn("handled-join-profile",phone,"Mira, 29","friends"))).status).toBe(200);
  const originalInbound=service.inbound.bind(service);
  service.inbound=async(...args)=>{
    const out=await originalInbound(...args),event=args[0];
    if (event.kind==="message" && event.messageId.startsWith("handled-notify")) {
      const current=service.inboundTurn()!,rt=service.runtimes.get("friends:nyc")!;
      // Controlled deterministic producer fixture; actual signed collection and Notify owners run unchanged.
      await rt.unitOfWork(()=>{rt.system(current.memberId!,`scheduling:${event.messageId}`,"Your requested schedule is ready.","reply","scheduling");rt.unit.sends.at(-1)!.system=false;});
    }
    return out;
  };
  const actual=service.delivered.bind(service);let fail=true;
  service.delivered=async(...args)=>{await actual(...args);if(fail){fail=false;throw new Error("synthetic after handled Notify SQL commit");}};
  const input=turn("handled-notify",phone,"HELP","friends");
  const response=await post(input);expect(response.status).toBe(200);const body=await response.json() as any;
  expect(body.replies.length).toBe(2);expect(body.delivery).toBe("collected");expect(escaped).toBe(before);
  const ack:TurnReceiptRequest={channel:input.channel,messageId:input.messageId,replyIds:body.replyIds,outcome:"unknown",providerMessageIds:[],historyRecorded:false};
  expect((await receipt(ack)).status).toBe(200);
  expect((await sql`select delivery_id from notify.deliveries where delivery_id='net:scheduling:handled-notify'`).length).toBe(0);
  const accepted={...ack,outcome:"accepted" as const,providerMessageIds:["handled-proof-1","handled-proof-2"],historyRecorded:true};
  // The signed receipt, collected message status and notification projection must stay consistent if the write fails.
  await sql`alter table platform.inbound add constraint reject_fixture_receipt
    check (id <> 'msg:blooio:handled-notify' or receipt->>'outcome' is distinct from 'accepted')`;
  try {
    expect((await receipt(accepted)).status).toBe(500);
    const [original] = await sql`select receipt from platform.inbound where id = 'msg:blooio:handled-notify'`;
    expect(original.receipt).toEqual(ack);
    const [collected] = await sql`select status from network.messages where id = 'scheduling:handled-notify'`;
    expect(collected.status).toBe("send_unknown");
    expect((await sql`select delivery_id from notify.deliveries where delivery_id = 'net:scheduling:handled-notify'`).length).toBe(0);
  } finally {
    await sql`alter table platform.inbound drop constraint reject_fixture_receipt`;
  }
  expect((await receipt(accepted)).status).toBe(200);
  const [message]=await sql`select ts,notification_recorded_at from network.messages where id='scheduling:handled-notify'`;
  expect(message.notification_recorded_at).toBeNull();
  const [notification]=await sql`select sent_at from notify.deliveries where delivery_id='net:scheduling:handled-notify'`;
  // The signed ACK has no provider timestamp; preserve original message chronology, without claiming provider acceptance time.
  expect(new Date(notification.sent_at).getTime()).toBe(new Date(message.ts).getTime());
  expect(await (await post(input)).json()).toEqual(body);
  expect((await sql`select delivery_id from notify.deliveries where delivery_id='net:scheduling:handled-notify'`).length).toBe(1);
  expect((await sql`select notification_recorded_at from network.messages where id='scheduling:handled-notify'`)[0].notification_recorded_at).not.toBeNull();
  expect(await (await receipt(accepted)).json()).toEqual({ok:true,replayed:true});
  fail=true;
  const restartInput=turn("handled-notify-restart",phone,"HELP","friends"),restartResponse=await post(restartInput);
  expect(restartResponse.status).toBe(200);const restartBody=await restartResponse.json() as any;
  const restartAck:TurnReceiptRequest={channel:restartInput.channel,messageId:restartInput.messageId,replyIds:restartBody.replyIds,outcome:"accepted",providerMessageIds:["handled-restart-1","handled-restart-2"],historyRecorded:true};
  expect((await receipt(restartAck)).status).toBe(200);
  expect((await sql`select notification_recorded_at from network.messages where id='scheduling:handled-notify-restart'`)[0].notification_recorded_at).toBeNull();
  service.inbound=originalInbound;
  await server.stop(true);await service.close();await start();
  expect((await sql`select delivery_id from notify.deliveries where delivery_id='net:scheduling:handled-notify-restart'`).length).toBe(1);
  expect((await sql`select notification_recorded_at from network.messages where id='scheduling:handled-notify-restart'`)[0].notification_recorded_at).not.toBeNull();
  const person=await service.accounts.personFor(phone);expect(person).toBeDefined();
  await service.accounts.leave(APPS.friends,{e164:phone,personId:person!.id});
  expect((await post(input)).status).toBe(409);expect((await receipt(accepted)).status).toBe(409);
  expect((await sql`select id from network.messages where id in ('scheduling:handled-notify','scheduling:handled-notify-restart')`).length).toBe(0);
  expect((await sql`select delivery_id from notify.deliveries where delivery_id in ('net:scheduling:handled-notify','net:scheduling:handled-notify-restart')`).length).toBe(0);
  await service.runtimes.get("friends:nyc")!.start();expect(escaped).toBe(before);
},60_000);

test("completed signed payload expiry retains a tombstone and leaves unresolved effects held",async()=>{
  const input=turn("payload-expiry","+12125550151","HELP");expect((await post(input)).status).toBe(200);
  clock.advance(8*DAY);await service.purge();
  expect((await post(input)).status).toBe(409);
  const [expired]=await sql`select status,request_hash,response,replies,receipt,sender_hash from platform.inbound where id='msg:blooio:payload-expiry'`;
  expect(expired.status).toBe("unresolved");expect(expired.request_hash).toBeDefined();expect(expired.response).toBeNull();expect(expired.replies).toEqual([]);expect(expired.receipt).toBeNull();expect(expired.sender_hash).toBeNull();
  const [interrupted]=await sql`select status,replies from platform.inbound where id='msg:blooio:fault-after-effects'`;
  expect(interrupted.status).toBe("unresolved");expect(interrupted.replies).toEqual([]);
},60_000);

test("full canonical deletion scrubs signed context, replies and receipts without crossing people",async()=>{
  const phone="+12125550161", otherPhone="+12125550162", before=escaped;
  for (const [from, name] of [[phone,"Deleteari"],[otherPhone,"Keepnoa"]]) {
    expect((await post(turn(`delete-join-${name}`,from,"friends.help","friends"))).status).toBe(200);
    expect((await post(turn(`delete-profile-${name}`,from,`${name}, 29`,"friends"))).status).toBe(200);
    for (const [i,text] of ["I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()) {
      clock.advance(MINUTE);
      expect((await post(turn(`delete-onboard-${name}-${i}`,from,text,"friends"))).status).toBe(200);
    }
  }
  const open=turn("delete-open",phone,"Tell me something about the weather","friends");
  const opened=await post(open);expect(opened.status).toBe(200);
  const openBody=await opened.json() as any;expect(openBody.outcome).toBe("open");
  expect(JSON.stringify(openBody)).toContain("Deleteari");
  const help=turn("delete-help",phone,"HELP","friends");
  const handled=await post(help);expect(handled.status).toBe(200);
  const helpBody=await handled.json() as any;expect(helpBody.outcome).toBe("handled");expect(helpBody.replyIds.length).toBeGreaterThan(0);
  const ack:TurnReceiptRequest={channel:help.channel,messageId:help.messageId,replyIds:helpBody.replyIds,outcome:"accepted",providerMessageIds:["owned-delete-receipt"],historyRecorded:true};
  expect((await receipt(ack)).status).toBe(200);
  const control=turn("delete-other-person",otherPhone,"Tell me something about the weather","friends");
  const kept=await post(control);expect(kept.status).toBe(200);const keptBody=await kept.json();
  expect((await sql`select receipt from platform.inbound where id='msg:blooio:delete-help'`)[0].receipt).not.toBeNull();
  const call=async(path:string,body:unknown,cookie?:string)=>fetchWithHost(new URL(path,server.url),{method:"POST",headers:{host:"localhost:5104","content-type":"application/json",...(cookie?{cookie}:{})},body:JSON.stringify(body)});
  expect((await call("/api/auth/otp/start",{phone})).status).toBe(200);
  const login=await call("/api/auth/otp/verify",{phone,code});expect(login.status).toBe(200);
  const cookie=login.headers.get("set-cookie")!.split(";")[0]!;
  expect((await call("/api/me/delete",{scope:"all"},cookie)).status).toBe(200);
  for (const input of [open,help]) {
    const replay=await post(input);expect(replay.status).toBe(409);
    expect(await replay.text()).not.toContain("Deleteari");
    const [row]=await sql`select response,replies,receipt,receipt_hash,sender_hash,member_id,app_id,sender,event from platform.inbound where id=${`msg:${input.channel}:${input.messageId}`}`;
    expect(row).toEqual({response:null,replies:[],receipt:null,receipt_hash:null,sender_hash:null,member_id:null,app_id:null,sender:null,event:null});
  }
  expect((await receipt(ack)).status).toBe(409);
  expect((await sql`select person_id from platform.phone_identities where e164=${phone}`).length).toBe(0);
  expect((await sql`select person_id from platform.phone_identities where e164=${otherPhone}`).length).toBe(1);
  expect(await (await post(control)).json()).toEqual(keptBody);
  expect(escaped).toBe(before);
  await server.stop(true);await service.close();await start();
  expect((await post(open)).status).toBe(409);expect((await receipt(ack)).status).toBe(409);
  expect(await (await post(control)).json()).toEqual(keptBody);expect(escaped).toBe(before);
},60_000);

test("the Cloud turn secret is never also a staff bearer token", () => {
  const make = (o: {tokens?: string; consoleToken?: string}) => new NetworkService({url, clock, photoStorage:null, instance:"turn-secret-separation",
    env:{PLATFORM_ENV:"dev", SERVICE_TURN_SECRET:secret}, networks:[{id:"ntwrk:nyc",matchingEnabled:false}], log:()=>{}, ...o});
  expect(() => make({tokens:`admin@*:${secret}`})).toThrow(/SERVICE_TURN_SECRET must differ/);
  expect(() => make({tokens:`reviewer@slop:other-staff-token-0001,admin@*:console-token-00000001`, consoleToken:secret})).toThrow(/SERVICE_TURN_SECRET must differ/);
  expect(() => make({tokens:"admin@*:console-token-00000001", consoleToken:"console-token-00000001"})).not.toThrow();
});


test("isolated route authority fences cross-realm writes and only drains exact durable turns", async () => {
  await server.stop(true); await service.close();
  const authority = {version:1 as const,routeId:"owned-route",generation:"generation-1",audience:"network-owned-qa",realmId:"owned-qa"};
  const begin = clock.now(), policy = {authority,admitUntil:begin+10*MINUTE,drainUntil:begin+20*MINUTE};
  await start(policy);
  const input = {...turn("isolated-help", "+12125550991", "HELP"), networkAuthority:authority};
  const [before] = await sql`select count(*)::int as count from platform.inbound`;
  for (const networkAuthority of [undefined,{...authority,realmId:"production"},{...authority,generation:"old"},{...authority,audience:"wrong"},{...authority,routeId:"other"},{...authority,extra:true}]) {
    expect((await post({...input,networkAuthority})).status).toBe(403);
  }
  const [untouched] = await sql`select count(*)::int as count from platform.inbound`;
  expect(untouched.count).toBe(before.count);
  const accepted = await post(input); expect(accepted.status).toBe(200); const response = await accepted.json() as any;
  const [stored] = await sql`select network_authority,request_hash from platform.inbound where id='msg:blooio:isolated-help'`;
  expect(stored.network_authority).toEqual(authority);
  expect(stored.request_hash).toBe(createHash("sha256").update(JSON.stringify(input)).digest("hex"));
  // Use a distinct fixture name: the separate sharedContext duplicate-first-name
  // defect is tracked explicitly and must not obscure route-authority assertions.
  const phone = "+12125550993";
  let step = 0;
  const qa = (text:string) => ({...turn(`isolated-open-${++step}`,phone,text,"friends"),networkAuthority:authority});
  for (const [index,text] of ["friends.help","Inez, 29","I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()) {
    // Match the proven normal onboarding sequence: later answers arrive after the prior ask.
    if (index >= 2) clock.advance(MINUTE);
    const response=await post(qa(text)), body=await response.json() as any;
    expect({step:index+1,status:response.status,body}).toMatchObject({status:200,body:{outcome:"handled",reason:expect.any(String)}});
  }
  const open = qa("Tell me about the weather"), opened = await (await post(open)).json() as any;
  expect({stage:"after timed onboarding",body:opened}).toMatchObject({body:{outcome:"open"}});
  const action = {channel:open.channel,messageId:open.messageId,app:opened.app,memberId:opened.memberId,networkAuthority:authority};
  const updates = async (body:Record<string,unknown>) => {
    const raw = JSON.stringify(body);
    return fetch(new URL("/internal/updates",server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:"/internal/updates",id:`${open.messageId}:updates`,body:raw,nowS:Math.floor(clock.now()/1000)})},body:raw});
  };
  expect((await updates(action)).status).toBe(200);
  expect((await updates({...action,memberId:"different-member"})).status).toBe(403);
  expect((await updates({...action,networkAuthority:{...authority,generation:"old"}})).status).toBe(403);
  clock.advance(policy.admitUntil-clock.now());
  expect((await updates(action)).status).toBe(200);
  expect(await (await post(input)).json()).toEqual(response);
  expect((await post({...input,text:"STOP"})).status).toBe(409);
  expect((await post({...input,messageId:"isolated-new-after-close"})).status).toBe(403);
  const ack = {channel:input.channel,messageId:input.messageId,replyIds:response.replyIds,outcome:"accepted" as const,providerMessageIds:["synthetic-isolated-receipt"],historyRecorded:false,networkAuthority:authority};
  const escapedBeforeReceipt = escaped;
  expect((await receipt(ack)).status).toBe(200);
  const [savedReceipt] = await sql`select receipt_hash,receipt from platform.inbound where id='msg:blooio:isolated-help'`;
  // Cloud appends the bound authority; Gateway places it after channel. Both
  // sign their own raw bytes, while the previously accepted receipt stays put.
  const gatewayAck = {channel:ack.channel,networkAuthority:{realmId:authority.realmId,audience:authority.audience,generation:authority.generation,routeId:authority.routeId,version:authority.version},messageId:ack.messageId,replyIds:ack.replyIds,outcome:ack.outcome,providerMessageIds:ack.providerMessageIds,historyRecorded:ack.historyRecorded};
  expect(JSON.stringify(gatewayAck)).not.toBe(JSON.stringify(ack));
  expect(await (await receipt(gatewayAck)).json()).toEqual({ok:true,replayed:true});
  expect((await sql`select receipt_hash,receipt from platform.inbound where id='msg:blooio:isolated-help'`)[0]).toEqual(savedReceipt);
  expect(savedReceipt.receipt_hash).toBe(createHash("sha256").update(JSON.stringify(ack)).digest("hex"));
  for (const changed of [
    {...gatewayAck,providerMessageIds:["different-provider-receipt"]},
    {...gatewayAck,historyRecorded:true},
    {...gatewayAck,replyIds:[...gatewayAck.replyIds].reverse().concat("different-reply")},
  ]) expect((await receipt(changed)).status).toBe(409);
  expect((await receipt({...gatewayAck,extra:true} as TurnReceiptRequest)).status).toBe(400);
  const signedBody = JSON.stringify(ack), reorderedBody = JSON.stringify(gatewayAck);
  const wrongSignature = await svcSign(secret,{method:"POST",path:TURN_RECEIPT_PATH,id:`${input.messageId}:receipt`,body:signedBody,nowS:Math.floor(clock.now()/1000)});
  expect((await fetch(new URL(TURN_RECEIPT_PATH,server.url),{method:"POST",headers:{"content-type":"application/json",...wrongSignature},body:reorderedBody})).status).toBe(401);
  expect(escaped).toBe(escapedBeforeReceipt);
  expect((await receipt({...ack,networkAuthority:{...authority,realmId:"wrong"}})).status).toBe(403);
  const raw = JSON.stringify({channel:input.channel,messageId:input.messageId,app:"friends",memberId:"none",itemId:null,text:"tell them hi",networkAuthority:authority});
  const relay = await fetch(new URL("/internal/relay",server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:"/internal/relay",id:`${input.messageId}:relay`,body:raw,nowS:Math.floor(clock.now()/1000)})},body:raw});
  expect(relay.status).toBe(403);
  clock.advance(policy.drainUntil-clock.now());
  expect((await post(input)).status).toBe(403);
  expect((await receipt(ack)).status).toBe(403);
  expect((await updates(action)).status).toBe(403);
  await server.stop(true); await service.close(); await start();
  expect((await post(input)).status).toBe(403);
  expect((await post(turn("legacy-after-isolation", "+12125550992", "HELP"))).status).toBe(200);
}, 60_000);


test("route policy boot validation rejects malformed or non-staging authority", () => {
  const authority = {version:1 as const,routeId:"owned-route",generation:"generation-1",audience:"network-owned-qa",realmId:"owned-qa"};
  const value = {authority,admitUntil:1000,drainUntil:2000};
  const env = {PLATFORM_ENV:"staging",NETWORK_ROUTE_AUTHORITY_POLICY:JSON.stringify(value)};
  const valid = networkRoutePolicy(env);
  expect(valid?.authority).toEqual(authority);
  expect(networkRoutePolicy({})).toBeUndefined();
  expect(routeEnvelopeAllowed(undefined, authority, 0)).toBe(false);
  expect(routeEnvelopeAllowed(valid, authority, 1999)).toBe(true);
  expect(routeEnvelopeAllowed(valid, authority, 2000)).toBe(false);
  for (const bad of [null, [], {...value,extra:true}, {...value,admitUntil:0}, {...value,drainUntil:999}, {...value,drainUntil:Infinity}, {...value,authority:{...authority,url:"https://elsewhere.invalid"}}, {...value,authority:{...authority,version:2}}]) {
    expect(() => networkRoutePolicy({...env,NETWORK_ROUTE_AUTHORITY_POLICY:JSON.stringify(bad)})).toThrow();
  }
  expect(() => networkRoutePolicy({...env,PLATFORM_ENV:"production"})).toThrow();
  expect(() => networkRoutePolicy({...env,PLATFORM_ENV:"dev"})).toThrow();
});

// A real row lock holds both signed requests across the server's drain deadline.
test("isolated actions and receipts recheck the drain window after database lock waits", async () => {
  await server.stop(true); await service.close();
  const authority = {version:1 as const,routeId:"locked-route",generation:"g1",audience:"locked-qa",realmId:"locked-qa"};
  const begin = clock.now(), policy={authority,admitUntil:begin+10*MINUTE,drainUntil:begin+20*MINUTE}; await start(policy);
  const help = {...turn("locked-help", "+12125550994", "HELP"),networkAuthority:authority};
  const handled = await (await post(help)).json() as any;
  let step=0;
  const qa = (text:string) => ({...turn(`locked-open-${++step}`,"+12125550995",text,"friends"),networkAuthority:authority});
  for (const [index,text] of ["friends.help","Luca, 29","I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()) {
    // Match the proven normal onboarding sequence: later answers arrive after the prior ask.
    if (index >= 2) clock.advance(MINUTE);
    const response=await post(qa(text)), body=await response.json() as any;
    expect({step:index+1,status:response.status,body}).toMatchObject({status:200,body:{outcome:"handled",reason:expect.any(String)}});
  }
  const open=qa("Tell me about the weather"), opened=await (await post(open)).json() as any;
  expect({stage:"after timed onboarding",body:opened}).toMatchObject({body:{outcome:"open"}});
  const[memberBefore]=await sql`select participation_state,participation_window from network.members where app_id='friends'and id=${opened.memberId}`;
  const locker=new SQL({url,max:1}); let release!:()=>void, locked!:()=>void;
  const released=new Promise<void>(resolve=>{release=resolve;}), acquired=new Promise<void>(resolve=>{locked=resolve;});
  const transaction=locker.begin(async tx=>{
    await tx`select id from platform.inbound where id in ('msg:blooio:locked-help',${`msg:blooio:${open.messageId}`}) order by id for update`;
    locked(); await released;
  });
  await acquired;
  try {
    const ack={channel:help.channel,messageId:help.messageId,replyIds:handled.replyIds,outcome:"accepted" as const,providerMessageIds:["synthetic-locked-receipt"],historyRecorded:false,networkAuthority:authority};
    const action={channel:open.channel,messageId:open.messageId,app:opened.app,memberId:opened.memberId,idempotencyKey:"locked-state-action",state:"busy",from:null,until:null,note:null,networkAuthority:authority};
    const raw=JSON.stringify(action);
    const pendingReceipt=receipt(ack);
    const pendingAction=fetch(new URL("/internal/set-state",server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:"/internal/set-state",id:action.idempotencyKey,body:raw,nowS:Math.floor(clock.now()/1000)})},body:raw});
    const deadline=Date.now()+5000; let waiters=0;
    while(Date.now()<deadline){
      const[row]=await admin`select count(*)::int as count from pg_stat_activity where datname=${db} and wait_event_type='Lock' and lower(query) like '%platform.inbound%'`;
      waiters=row.count;if(waiters>=2)break;await sleep(10);
    }
    expect(waiters).toBeGreaterThanOrEqual(2);
    clock.advance(policy.drainUntil-clock.now()); release(); await transaction;
    const [receiptResponse, actionResponse] = await Promise.all([pendingReceipt, pendingAction]);
    expect(receiptResponse.status).toBe(403);
    expect(actionResponse.status).toBe(403);
    const rows=await sql`select id,receipt_hash,action_receipts from platform.inbound where id in ('msg:blooio:locked-help',${`msg:blooio:${open.messageId}`})`;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.receipt_hash).toBeNull();
      expect(Object.keys(row.action_receipts)).toHaveLength(0);
    }
    const[memberAfter]=await sql`select participation_state,participation_window from network.members where app_id='friends'and id=${opened.memberId}`;
    expect(memberAfter).toEqual(memberBefore);
    // Expired exact replays remain denied; an accepted receipt is not an extension of the window.
    expect((await receipt(ack)).status).toBe(403);
  } finally {release();await transaction;await locker.close();await server.stop(true);await service.close();await start();}
},60_000);


test("members sharing a first name receive their own context without another person's private details", async () => {
  const phones = ["+12125550891", "+12125550892", "+12125550893"];
  const memberIds: string[] = [];
  for (const [index, phone] of phones.entries()) {
    for (const [step, text] of ["friends.help", `${index === 2 ? "Mira" : "Noa"}, 29`, "I enjoy hiking and cooking",
      "Saturday afternoons work for me", "Small groups are good"].entries()) {
      clock.advance(MINUTE);
      expect((await post(turn(`same-name-${index}-${step}`, phone, text, "friends"))).status).toBe(200);
    }
    const person = await service.accounts.personFor(phone);
    expect(person).toBeDefined();
    const [member] = await sql`select member_id from platform.memberships where person_id=${person!.id}::uuid and app_id='friends'`;
    memberIds.push(member.member_id);
  }
  // Controlled stored-data fixtures challenge the actual model-visible projection, not a mock filter.
  await sql`update network.members set name='Noa Riverstone' where app_id='friends' and id=${memberIds[2]}`;
  await sql`insert into network.facets(app_id,id,member_id,kind,value,privacy_scope,provenance,status)
    values('friends','same-name-private',${memberIds[1]},'fact','PRIVATE_SAME_NAME_CANARY','agent_private','said','confirmed')`;
  for (const [index, memberId] of memberIds.slice(0, 2).entries()) {
    const values = ["Enjoys board games", "Noa Riverstone", memberIds[2]!, "PRIVATE_SAME_NAME_CANARY"];
    for (const [item, value] of values.entries()) await sql`insert into network.facets(app_id,id,member_id,kind,value,privacy_scope,provenance,status)
      values('friends',${`same-name-${index}-facet-${item}`},${memberId},'fact',${value},'shareable','said','confirmed')`;
  }
  const before = escaped;
  for (const [index, phone] of phones.slice(0, 2).entries()) {
    const response = await post(turn(`same-name-open-${index}`, phone, "Tell me about the weather", "friends"));
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.outcome).toBe("open");
    expect(body.context.firstName).toBe("Noa");
    expect(body.context.facets).toContain("Enjoys board games");
    const visible = JSON.stringify(body.context);
    for (const forbidden of ["Noa Riverstone", "PRIVATE_SAME_NAME_CANARY", ...memberIds, ...phones]) expect(visible).not.toContain(forbidden);
  }
  expect(escaped).toBe(before);
}, 60_000);

// This regression must fail on the old UPDATES path: markSeen committed before
// the later route check rejected completion, silently consuming the unread item.
test("expired isolated updates roll back unread and surface changes after a notify row wait", async () => {
  await server.stop(true); await service.close();
  const authority={version:1 as const,routeId:"updates-route",generation:"g1",audience:"updates-qa",realmId:"updates-qa"};
  const policy={authority,admitUntil:clock.now()+10*MINUTE,drainUntil:clock.now()+20*MINUTE};await start(policy);
  const phone="+12125550781";let step=0;
  const qa=(text:string)=>({...turn(`updates-drain-${++step}`,phone,text,"friends"),networkAuthority:authority});
  for(const[index,text]of["friends.help","Talia, 29","I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"].entries()){
    if(index>=2)clock.advance(MINUTE);
    const response=await post(qa(text));expect(response.status).toBe(200);
  }
  const open=qa("Tell me about the weather"),opened=await(await post(open)).json()as any;
  expect({stage:"updates regression open parent",body:opened}).toMatchObject({body:{outcome:"open"}});
  const person=await service.accounts.personFor(phone);expect(person).toBeDefined();
  const[item]=await sql`insert into notify.inbox_items(dedupe_key,person_id,app_id,event_type,subject_id,urgency,summary,created_at)
    values('updates-drain-unread',${person!.id},'friends','test','updates-drain-unread','requested','Your requested update is ready.',${new Date(clock.now())})returning id`;
  const surfaceBefore=await sql`select surface,active,last_used_at,acted,ignored,ignored_streak from notify.surface_signals where person_id=${person!.id} order by surface`;
  const locker=new SQL({url,max:1});let release!:()=>void,locked!:()=>void;
  const gate=new Promise<void>(r=>{release=r;}),acquired=new Promise<void>(r=>{locked=r;});
  const held=locker.begin(async tx=>{await tx`select id from notify.inbox_items where id=${item.id} for update`;locked();await gate;});await acquired;
  let pending:Promise<Response>|undefined;
  try{
    const body=JSON.stringify({channel:open.channel,messageId:open.messageId,app:opened.app,memberId:opened.memberId,networkAuthority:authority});
    pending=fetch(new URL("/internal/updates",server.url),{method:"POST",headers:{"content-type":"application/json",...await svcSign(secret,{method:"POST",path:"/internal/updates",id:`${open.messageId}:updates`,body,nowS:Math.floor(clock.now()/1000)})},body});
    const deadline=Date.now()+5000;let waiters=0;
    while(Date.now()<deadline){const[row]=await admin`select count(*)::int as count from pg_stat_activity where datname=${db} and wait_event_type='Lock'and lower(query)like'%notify.inbox_items%'`;waiters=row.count;if(waiters)break;await sleep(10);}
    expect(waiters).toBeGreaterThan(0);clock.advance(policy.drainUntil-clock.now());release();await held;
    expect((await pending).status).toBe(403);
    const[after]=await sql`select seen_at,seen_on from notify.inbox_items where id=${item.id}`;
    expect(after).toEqual({seen_at:null,seen_on:null});
    expect(await sql`select surface,active,last_used_at,acted,ignored,ignored_streak from notify.surface_signals where person_id=${person!.id} order by surface`).toEqual(surfaceBefore);
  }finally{release();await held;if(pending)await pending.catch(()=>undefined);await locker.close();await server.stop(true);await service.close();await start();}
},60_000);

// Real service + real owned fixture PostgreSQL: provider receipts remain controlled.
test("explicit saved-profile reads select the app without consuming onboarding or changing profiles", async () => {
  await server.stop(true);
  await service.close();
  await start();
  const phone = "+12125550991";
  for (const app of [APPS.friends, APPS.slop]) {
    await service.accounts.invite(app, phone);
    const person = await service.accounts.personFor(phone);
    expect(person).toBeDefined();
    const joined = await service.accounts.join(
      app,
      { e164: phone, personId: person!.id },
      {
        firstName: "Ari",
        age: 29,
        homeCity: "nyc",
        about: app.id === "friends" ? "FRIENDS_ONLY programming and camping." : "SLOP_ONLY private dating details.",
        interests: ["climbing"],
        consent: { sms: true, wording: app.consent.text },
      },
    );
    expect(joined.ok).toBe(true);
  }
  const person = (await service.accounts.personFor(phone))!;
  const saved = await Promise.all(
    ["friends", "slop"].map((app) => service.accounts.store.getMembership(person.id, app as "friends" | "slop")),
  );
  clock.advance(MINUTE);
  expect((await post(turn("profile-prime-slop", phone, "Slop"))).status).toBe(200);
  const pending = async () => {
    const rows =
      await sql<{ id: string; state: string | { asks: unknown; members: unknown[] } }[]>`select id,state from network.network_state where id in ('friends:nyc','slop:nyc') order by id`;
    return rows.map(row => {
      const state = typeof row.state === "string" ? JSON.parse(row.state) : row.state;
      return {
        id: row.id,
        asks: state.asks,
        members: state.members.map((m: any) => ({
          id: m.id,
          stage: m.stage,
          onboarding: m.onboarding,
          pendingAsks: m.pendingAsks,
          awaiting: m.awaiting,
          learned: m.learned,
          asked: m.asked,
          answered: m.answered,
        })),
      };
    });
  };
  const texts = [
    "Please show me the Friends profile I saved; leave it unchanged.",
    "What does my Friends profile say? Please do not change anything.",
    "Show my saved profile. Do not edit it or suggest matches.",
    "Can you show me my Friends profile?",
    "Could you please show my saved profile?",
    "What is my saved profile?",
    "Show me my Friends profile please.",
    "Read my saved Friends profile, thanks.",
    "Could you read my Friends profile? Thanks.",
  ];
  for (const [index, text] of texts.entries()) {
    if (index === 2) {
      clock.advance(MINUTE);
      expect((await post(turn("profile-select-friends", phone, "Friends"))).status).toBe(200);
    }
    const before = await pending();
    const spies = [...service.runtimes.values()].map((rt) => vi.spyOn(rt.net, "onInbound"));
    const input = turn(`profile-read-${index}`, phone, text);
    try {
      const response = await post(input);
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.outcome).toBe("handled");
      expect(body.app).toBe("friends");
      expect(body.replyKind).toBe("reply");
      expect(body.replies.join("\n")).toContain("FRIENDS_ONLY programming and camping.");
      expect(body.replies.join("\n")).not.toContain("SLOP_ONLY");
      expect(body.replies.join("\n")).toContain("I left it unchanged.");
      expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
      expect(await pending()).toEqual(before);
      expect(
        await Promise.all(
          ["friends", "slop"].map((app) => service.accounts.store.getMembership(person.id, app as "friends" | "slop")),
        ),
      ).toEqual(saved);
      expect(await (await post(input)).json()).toEqual(body);
      expect(
        (
          await receipt({
            channel: input.channel,
            messageId: input.messageId,
            replyIds: body.replyIds,
            outcome: "accepted",
            providerMessageIds: [`fixture-profile-receipt-${index}`],
            historyRecorded: true,
          })
        ).status,
      ).toBe(200);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  }
  const before = await pending();
  const foreign = (await (
    await post(turn("profile-foreign", phone, "Show Maya's Friends profile", "friends"))
  ).json()) as any;
  expect(foreign.replies.join("\n")).toContain("own number");
  expect(foreign.replies.join("\n")).not.toContain("FRIENDS_ONLY");
  const ambiguous = (await (
    await post(turn("profile-ambiguous", phone, "Show my Friends and Slop profiles", "friends"))
  ).json()) as any;
  expect(ambiguous.replies.join("\n")).toContain("Which profile");
  expect(ambiguous.replies.join("\n")).not.toContain("FRIENDS_ONLY");
  const line = (await (
    await post(turn("profile-forced-line", phone, "Show my Friends profile", "slop"))
  ).json()) as any;
  expect(line.app).toBe("slop");
  expect(line.replies.join("\n")).not.toContain("FRIENDS_ONLY");
  expect(await pending()).toEqual(before);
  const unsigned = turn("profile-no-auth", phone, texts[0]!);
  expect(
    (
      await fetch(new URL(TURN_PATH, server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(unsigned),
      })
    ).status,
  ).toBe(401);
  const [countsBefore] =
    await sql`select (select count(*) from platform.people) people,(select count(*) from platform.memberships) memberships,(select count(*) from platform.consent_events) consents,(select count(*) from platform.pending_texts) pending`;
  const absent = (await (await post(turn("profile-nonmember", "+12125550992", texts[0]!))).json()) as any;
  expect(absent.replies).toEqual([]);
  const [countsAfter] =
    await sql`select (select count(*) from platform.people) people,(select count(*) from platform.memberships) memberships,(select count(*) from platform.consent_events) consents,(select count(*) from platform.pending_texts) pending`;
  expect(countsAfter).toEqual(countsBefore);
  // An edit is ordinary inbound, never swallowed as a saved-profile read.
  const editSpies = [...service.runtimes.values()].map((rt) => vi.spyOn(rt.net, "onInbound"));
  try {
    const edited = await post(
      turn("profile-edit-intent", phone, "Change my Friends profile to say I like kayaking", "friends"),
    );
    expect(edited.status).toBe(200);
    expect(editSpies.some((spy) => spy.mock.calls.length > 0)).toBe(true);
  } finally {
    for (const spy of editSpies) spy.mockRestore();
  }
  const membershipBeforeGuards = await Promise.all(
    ["friends", "slop"].map((app) => service.accounts.store.getMembership(person.id, app as "friends" | "slop")),
  );
  await service.accounts.store.setPhoneHold(phone, "recycled_number", clock.now());
  const held = (await (await post(turn("profile-held", phone, texts[0]!))).json()) as any;
  expect(held.replies).toEqual([]);
  await service.accounts.store.setPhoneHold(phone, null, clock.now());
  await service.accounts.store.suppress(service.accounts.phoneHash(phone), "synthetic fixture", clock.now());
  const suppressed = (await (await post(turn("profile-suppressed", phone, texts[0]!))).json()) as any;
  expect(suppressed.replies).toEqual([]);
  await service.accounts.store.unsuppress(service.accounts.phoneHash(phone));
  await service.accounts.recordConsent({
    e164: phone,
    app: "friends",
    state: "opted_out",
    source: "keyword:stop",
    wording: "STOP",
    at: clock.now(),
  });
  const pendingBeforeStop = await pending();
  const stopped = (await (await post(turn("profile-opted-out", phone, texts[0]!))).json()) as any;
  // Existing stopHint may send its ordinary compliance reminder; it must never disclose saved data.
  expect(stopped.replies.join("\n")).not.toContain("FRIENDS_ONLY");
  expect(stopped.replies.join("\n")).not.toContain("SLOP_ONLY");
  expect(stopped.replies.join("\n")).not.toContain("Here is your saved");
  expect(await pending()).toEqual(pendingBeforeStop);
  expect(await service.accounts.optedIn("friends", phone)).toBe(false);
  expect(
    await Promise.all(
      ["friends", "slop"].map((app) => service.accounts.store.getMembership(person.id, app as "friends" | "slop")),
    ),
  ).toEqual(membershipBeforeGuards);
}, 60_000);

test("retention keeps a stuck signed turn until staff resolve it, then removes its tombstone", async () => {
  const id = "msg:blooio:fault-after-effects";
  const [before] = await sql`select status,sender_hash from platform.inbound where id=${id}`;
  expect(before.status).toBe("unresolved");expect(before.sender_hash).not.toBeNull();
  clock.advance(inboxKeepMs + turnTombstoneKeepMs + DAY);await service.purge();
  const [kept] = await sql`select status,sender_hash from platform.inbound where id=${id}`;
  expect(kept?.status).toBe("unresolved");expect(kept?.sender_hash).not.toBeNull();
  expect(await service.inbox.resolve(id)).toBe(true);
  await service.purge();
  expect(await sql`select id from platform.inbound where id=${id}`).toEqual([]);
}, 60_000);

test("account erasure clears the sender key of a signed turn that staff never resolved", async () => {
  const phone = "+12125550185";
  await joinFriendsByText(phone, "erase-stuck");
  const person = (await service.accounts.personFor(phone))!;
  const at = new Date(clock.now() - DAY);
  await sql`insert into platform.inbound (id, received_at, arrived_at, status, request_hash, sender_hash)
    values ('msg:blooio:erase-stuck', ${at}, ${at}, 'unresolved', 'fixture-erase-hash', ${service.accounts.phoneHash(phone)})`;
  expect(await service.accounts.deleteAll({ e164: phone, personId: person.id })).toBe(true);
  expect(await sql`select status, sender_hash, sender, event from platform.inbound where id='msg:blooio:erase-stuck'`)
    .toEqual([{ status: "unresolved", sender_hash: null, sender: null, event: null }]);
  await service.purge();
  expect(await sql`select id from platform.inbound where id='msg:blooio:erase-stuck'`).toEqual([{ id: "msg:blooio:erase-stuck" }]);
}, 60_000);

// spec/memberAge.md, "Commit a stated age before projecting it across apps".
test("a signed dotted age statement lowers the durable age across apps", async () => {
  const e164 = "+16465550194";
  for (const app of [APPS.friends, APPS.slop]) {
    await service.accounts.invite(app, e164);
    const person = (await service.accounts.personFor(e164))!;
    const joined = await service.accounts.join(app, { e164, personId: person.id }, {
      firstName: "Ari", age: 29, homeCity: "nyc",
      consent: { sms: true, wording: app.consent.text },
    });
    expect(joined.ok).toBe(true);
  }
  const person = (await service.accounts.personFor(e164))!;
  const ages = async () => {
    const floor = await service.accounts.lowestAge(e164, person);
    const members = await sql`select app_id as app, age from network.members where person_id=${person.id} order by app_id`;
    return { floor, members };
  };
  const readBack = (age: number) => ({ floor: age, members: [{ app:"friends", age }, { app:"slop", age }] });

  const reported = await post(turn("age-dotted-reported", e164, `She said "I'm 15 y.o."`, "friends"));
  expect(reported.status).toBe(200);
  expect(await ages()).toEqual(readBack(29));
  clock.advance(MINUTE);

  const future = await post(turn("age-dotted-future", e164, "I'm 12 y.o., in two years.", "friends"));
  expect(future.status).toBe(200);
  expect(await ages()).toEqual(readBack(29));
  clock.advance(MINUTE);

  const own = turn("age-dotted-current", e164, "I'm 15 y.o. I live in NYC.", "friends");
  const response = await post(own);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ outcome: "handled" });
  expect(await ages()).toEqual(readBack(15));
  expect(await (await post(own)).json()).toMatchObject({ outcome: "handled" });
  expect(await ages()).toEqual(readBack(15));
}, 60_000);

// spec/memberAge.md, "A half age needs age wording to confirm an under-13 refusal".
test("a signed current half-age requires explicit age wording before removing a membership", async () => {
  const phone = "+12125550196";
  const app = APPS.friends;
  await service.accounts.invite(app, phone);
  const person = (await service.accounts.personFor(phone))!;
  const joined = await service.accounts.join(app, { e164: phone, personId: person.id }, {
    firstName: "Ari", age: 17, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
  });
  expect(joined.ok).toBe(true);

  const current = async () => {
    const floor = await service.accounts.lowestAge(phone, person);
    const [member] = await sql`select state from platform.memberships where person_id=${person.id} and app_id='friends'`;
    return { floor, state: member?.state };
  };
  for (const [i, text] of ["I'm 3 and I am undefeated", "I'm 12.5 miles away", "I'm 12.5 y.o., in two years",
    "I'm 16 and a quarter years old tomorrow"].entries()) {
    clock.advance(MINUTE);
    expect((await post(turn(`signed-half-age-negative-${i}`, phone, text, "friends"))).status).toBe(200);
    expect(await current()).toEqual({ floor: 17, state: "active" });
  }

  clock.advance(MINUTE);
  expect((await post(turn("signed-loose-half-age", phone, "I'm 12.5", "friends"))).status).toBe(200);
  expect(await current()).toEqual({ floor: 13, state: "active" });

  clock.advance(MINUTE);
  expect((await post(turn("signed-explicit-half-age", phone, "I'm 12.5 years old", "friends"))).status).toBe(200);
  expect(await current()).toEqual({ floor: 12, state: "removed" });
}, 60_000);

// spec/memberAge.md, "Commit a stated age before projecting it across apps".
test("signed fractional ages distinguish an explicit current age from a height or future birthday", async () => {
  const cases = [
    ["+12125550191", "I'm 7.5 years old", 7],
    ["+12125550192", "I'm 5 1/2 years old", 5],
    ["+12125550193", "I'm 12 and 3 months old", 12],
    ["+12125550195", "I'm 12 years and 3 months old", 12],
    ["+16465550191", "I just turned 7 1/2", 13, "active"],
    ["+16465550192", "I just turned 7.5", 13, "active"],
  ] as const;
  const app = APPS.friends;
  for (const [phone, disclosure, age, expectedState = "removed"] of cases) {
    await service.accounts.invite(app, phone);
    const person = (await service.accounts.personFor(phone))!;
    const joined = await service.accounts.join(app, { e164: phone, personId: person.id }, {
      firstName: "Ari", age: 17, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
    });
    expect(joined.ok).toBe(true);

    const state = async () => {
      const [membership] = await sql`select state from platform.memberships where person_id=${person.id} and app_id='friends'`;
      return membership?.state;
    };
    const controls = ["I'm 5.5", "I'm 5 1/2, slim", "I'm 12 and 3 months sober",
      "I'm 12 and 3 months old, in two years", "I just turned 7.5 miles away",
      "When I turned 7.5, I moved", `She said "${disclosure}."`];
    for (const [i, text] of controls.entries()) {
      clock.advance(MINUTE);
      expect((await post(turn(`fraction-age-control-${phone}-${i}`, phone, text, "friends"))).status).toBe(200);
      expect(await service.accounts.lowestAge(phone, person)).toBe(17);
      expect(await state()).toBe("active");
    }

    clock.advance(MINUTE);
    const message = turn(`fraction-age-disclosure-${phone}`, phone, disclosure, "friends");
    expect((await post(message)).status).toBe(200);
    expect(await service.accounts.lowestAge(phone, person)).toBe(age);
    expect(await state()).toBe(expectedState);
    expect((await post(message)).status).toBe(200);
    expect(await service.accounts.lowestAge(phone, person)).toBe(age);
  }
}, 60_000);

// spec/memberAge.md, "A near birthday gives an estimate for the present age".
test("signed birthday wording keeps a distant age separate from an upcoming weekday", async () => {
  const phone = "+16465550198";
  const app = APPS.friends;
  await service.accounts.invite(app, phone);
  const person = (await service.accounts.personFor(phone))!;
  const joined = await service.accounts.join(app, { e164: phone, personId: person.id }, {
    firstName: "Ari", age: 29, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
  });
  expect(joined.ok).toBe(true);

  for (const [i, text] of ["I'll be 18 in two years", "I'm turning 18 in two years", "I turn 18 in two years"].entries()) {
    clock.advance(MINUTE);
    expect((await post(turn(`distance-birthday-age-${i}`, phone, text, "friends"))).status).toBe(200);
    expect(await service.accounts.lowestAge(phone, person)).toBe(29);
  }

  clock.advance(MINUTE);
  const age = turn("upcoming-weekday-birthday", phone, "I'm 18 y.o. this Friday", "friends");
  expect((await post(age)).status).toBe(200);
  expect(await service.accounts.lowestAge(phone, person)).toBe(17);
}, 60_000);

test("a signed age with months projects the minor's age to other app memberships", async () => {
  const phone = "+12125550197";
  for (const app of [APPS.friends, APPS.slop]) {
    await service.accounts.invite(app, phone);
    const person = (await service.accounts.personFor(phone))!;
    const joined = await service.accounts.join(app, { e164: phone, personId: person.id }, {
      firstName: "Ari", age: 29, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
    });
    expect(joined.ok).toBe(true);
  }
  const person = (await service.accounts.personFor(phone))!;
  const age = turn("fraction-age-across-apps", phone, "I'm 17 years and 3 months old.", "friends");
  expect((await post(age)).status).toBe(200);
  expect(await service.accounts.lowestAge(phone, person)).toBe(17);
  const stored = await sql`select app_id as app, age from network.members where person_id=${person.id} order by app_id`;
  expect(stored).toEqual([{ app: "friends", age: 17 }, { app: "slop", age: 17 }]);
}, 60_000);
