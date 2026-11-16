// spec/memberStanding.md, "Story: Move standing slowly"
// spec/memberStanding.md, "Standing exists only for an adult who consented to the lane"
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { applySchema, devPgUp, DEV_PG_URL } from "../../observatory/db/dev-pg.ts";
import { APPS } from "../../platform/src/apps.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import type { NetworkState } from "../src/network.ts";

const db = `standing_runtime_${randomUUID().replaceAll("-", "")}`;
const url = new URL(`/${db}`, DEV_PG_URL).href;
const admin = new SQL({ url: new URL("/postgres", DEV_PG_URL).href, max: 1 });
const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
const firstTick = clock.now();
const secret = "synthetic-weekly-standing-fixture-signing-secret";
const app = APPS.ntwrk;
const networkId = "ntwrk:nyc";
const evidenceValue = "Coordinated an open source documentation project";
let sql: SQL;
let service: NetworkService;

async function start() {
  service = new NetworkService({
    url, clock, env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret }, log: () => {},
    networks: [{ id: networkId }], devMatching: [networkId], network: { seed: 19, plans: false, growth: false },
    adapter: () => new DryRunAdapter(() => {}),
  });
  await service.start();
  return service.runtimeFor(app.id)!;
}

beforeAll(async () => {
  await devPgUp();
  await admin.unsafe(`create database ${db}`);
  await applySchema(url, { lockTimeout: "5s" });
  sql = new SQL({ url, max: 2 });
}, 120_000);

afterAll(async () => {
  try {
    await service?.close();
    await sql?.close();
    await admin.unsafe(`drop database if exists ${db} with (force)`);
  } finally {
    await admin.close();
  }
});

async function enroll(e164: string, firstName: string) {
  const invitation = await service.accounts.invite(app, e164);
  if (!invitation) throw new Error("Missing fixture staff invitation");
  const joined = await service.accounts.join(app, { e164, personId: invitation.personId }, {
    firstName, age: 31, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
  });
  if (!joined.ok) throw new Error(`Fixture signup failed: ${joined.error}`);
  return { e164, personId: invitation.personId, id: joined.membership.memberId };
}

async function signedTurn(from: string, messageId: string, text: string) {
  const input: TurnRequest = { messageId, app: app.id, from, to: null, text, receivedAt: clock.now(), channel: "blooio", transport: "imessage" };
  const body = JSON.stringify(input);
  return service.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", body, headers: {
    "content-type": "application/json",
    ...await svcSign(secret, { method: "POST", path: TURN_PATH, id: messageId, body, nowS: Math.floor(clock.now() / 1000) }),
  } }));
}

async function standingRows() {
  const [record] = await sql<{ state: NetworkState }[]>`select state from network.network_state where id=${networkId}`;
  return record?.state.memberStanding ?? [];
}

test("private standing moves once a week across restart and drops ineligible lane rows", async () => {
  let runtime = await start();
  const eligible = await enroll("+12125550126", "Ari");
  const underage = await enroll("+12125550127", "Lee");
  const optedOut = await enroll("+12125550128", "Dee");
  const forgotten = await enroll("+12125550129", "Sam");
  const members = [eligible, underage, optedOut, forgotten];
  for (const { id } of members) {
    await sql`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, status, valid_from)
      values (${app.id}, ${`fixture-role:${id}`}, ${id}, 'skill', 'Open to professional introductions',
        ${sql.array(["lane:Intro"], "TEXT")}, 'matchable', 'vouched', 'confirmed', ${new Date(firstTick)}),
        (${app.id}, ${`fixture-evidence:${id}`}, ${id}, 'fact', ${evidenceValue},
        ${sql.array(["lane:Intro", "evidence:20"], "TEXT")}, 'matchable', 'connected_source', 'confirmed', ${new Date(firstTick)})`;
  }
  expect(await runtime.tick()).toBe(true);
  const initial = await standingRows();
  expect(initial).toHaveLength(members.length);
  expect(initial).toEqual(expect.arrayContaining(members.map(({ id }) => expect.objectContaining({
    memberId: id, lane: "Intro", side: "Peer", value: 20, observedAt: firstTick,
    evidenceIds: [expect.stringMatching(/^[a-f0-9]{64}$/)],
  }))));
  await sql`update network.facets set tags=${sql.array(["lane:Intro", "evidence:90"], "TEXT")}
    where app_id=${app.id} and id=${`fixture-evidence:${eligible.id}`}`;

  clock.advance(6 * DAY);
  expect(await runtime.tick()).toBe(true);
  expect(await standingRows()).toEqual(initial);
  await service.close();
  runtime = await start();
  expect(await standingRows()).toEqual(initial);

  clock.advance(DAY);
  expect(await runtime.tick()).toBe(true);
  const updated = await standingRows();
  const own = updated.find(row => row.memberId === eligible.id);
  expect(own).toMatchObject({ lane: "Intro", side: "Peer", value: 25, observedAt: clock.now() });
  expect(own?.evidenceIds).toEqual(initial.find(row => row.memberId === eligible.id)?.evidenceIds);
  await service.close();
  runtime = await start();
  clock.advance(DAY);
  expect(await runtime.tick()).toBe(true);
  expect((await standingRows()).find(row => row.memberId === eligible.id)).toEqual(own);

  const person = await service.accounts.personFor(underage.e164);
  if (!person) throw new Error("Missing fixture person's verified phone");
  await service.accounts.recordAge(underage.e164, person, 17);
  expect((await signedTurn(optedOut.e164, "standing-stop", "STOP")).status).toBe(200);
  await service.accounts.leave(app, forgotten);
  const retained = new Set((await standingRows()).map(row => row.memberId));
  expect(retained.has(optedOut.id)).toBe(false);
  expect(retained.has(forgotten.id)).toBe(false);
  clock.advance(HOUR);
  expect(await runtime.tick()).toBe(true);
  expect(await standingRows()).toEqual([own]);

  const open = await signedTurn(eligible.e164, "standing-open", "Could you explain the solar system?");
  expect(open.status).toBe(200);
  const context = await open.json();
  const exported = await service.accounts.exportApp(app, eligible);
  const messages = await sql`select body from network.messages
    where app_id=${app.id} and member_id=${eligible.id} and direction='outbound' order by ts, id`;
  expect(context).toMatchObject({ outcome: "open", memberId: eligible.id, context: expect.any(Object) });
  expect(messages.length).toBeGreaterThan(0);
  expect(JSON.stringify([context, exported, messages])).not.toMatch(/"memberStanding"|"standing"|"uncertainty"|"evidenceIds"/);
  expect(JSON.stringify([context, messages])).not.toContain(evidenceValue);

  // spec/profileFactEdit.md, "Only a direct request from the current app member can show their saved facts"
  const list = await signedTurn(eligible.e164, "standing-list", "SHOW MY FACTS");
  const listed = (await list.json()).replies.join("\n");
  expect(listed).toContain(evidenceValue);
  const reference = /pfr_[a-p]{32}/.exec(listed)?.[0];
  if (!reference) throw new Error("The reviewed source fact was not listed");
  const stage = await signedTurn(eligible.e164, "standing-privacy-stage", `SET FACT SCOPE ${reference} TO agent_private`);
  const challenge = /pfc_[a-p]{32}/.exec((await stage.json()).replies.join("\n"))?.[0];
  if (!challenge) throw new Error("The exact fact scope edit was not staged");
  const confirmed = await signedTurn(eligible.e164, "standing-privacy-confirm", `CONFIRM FACT EDIT ${challenge}`);
  expect(await confirmed.json()).toMatchObject({ reason: "profile_fact_edit", replies: [expect.stringContaining("applied that edit")] });
  expect(await sql`select privacy_scope from network.facets where app_id=${app.id} and id=${`fixture-evidence:${eligible.id}`}`)
    .toEqual([{ privacy_scope: "agent_private" }]);
  const basis = own?.evidenceIds[0];
  if (!basis) throw new Error("Missing stored evidence before scope withdrawal");
  expect((await standingRows()).flatMap(row => row.evidenceIds)).not.toContain(basis);

  clock.advance(DAY);
  expect(await runtime.tick()).toBe(true);
  expect(await standingRows()).toEqual([{ memberId: eligible.id, lane: "Intro", side: "Peer",
    value: 0, observedAt: clock.now(), evidenceIds: [] }]);
}, 120_000);
