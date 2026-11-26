import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { applySchema, devPgUp, DEV_PG_URL } from "../../db/dev-pg.ts";
import { APPS } from "../../platform/src/apps.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";

const db = `join_repair_${randomUUID().replaceAll("-", "")}`;
const url = new URL(`/${db}`, DEV_PG_URL).href;
const admin = new SQL({ url: new URL("/postgres", DEV_PG_URL).href, max: 1 });
const clock = new SimClock(Date.UTC(2026, 10, 21, 16));
const app = APPS.friends;
const networkId = "friends:nyc";
const consent = { sms: true, wording: app.consent.text } as const;
let sql: SQL;
let service: NetworkService;
const forgotten: string[] = [];

beforeAll(async () => {
  await devPgUp();
  await admin.unsafe(`create database ${db}`);
  await applySchema(url, { lockTimeout: "5s" });
  sql = new SQL({ url, max: 2 });
  service = new NetworkService({
    url, clock, env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: "synthetic-join-repair-signing-secret" }, log: () => {},
    networks: [{ id: networkId }], devMatching: [networkId], network: { seed: 23, plans: false, growth: false },
    adapter: () => new DryRunAdapter(() => {}),
  });
  service.onForget(ctx => { forgotten.push(ctx.memberId ?? ""); });
  await service.start();
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

const memberRows = (memberId: string) => sql<{ account_status: string }[]>`select account_status from network.members where app_id=${app.id} and id=${memberId}`;

test("siteEnrollment, the effective age controls a repeated join: a repeated web join creates the missing Network member", async () => {
  const e164 = "+12125550171";
  const first = await service.accounts.join(app, { e164, personId: null }, { firstName: "Ida", age: 34, homeCity: "nyc", consent });
  if (!first.ok) throw new Error(`fixture join failed: ${first.error}`);
  const memberId = first.membership.memberId;
  expect(await memberRows(memberId)).toHaveLength(1);
  await sql`update network.members set account_status='removed' where app_id=${app.id} and id=${memberId}`;
  const again = await service.accounts.join(app, { e164, personId: first.membership.personId }, { firstName: "Ida", age: 34, homeCity: "nyc", consent });
  expect(again).toMatchObject({ ok: true, created: false, membership: { memberId } });
  expect((await memberRows(memberId)).map(r => r.account_status)).not.toContain("removed");
});

test("siteEnrollment, success follows the join hook: a failed join forgets the membership and keeps the app's grants and photos", async () => {
  const e164 = "+12125550172";
  forgotten.length = 0;
  await sql.unsafe("create function network.join_repair_fault() returns trigger language plpgsql as $$ begin raise exception 'join repair fault'; end $$");
  await sql.unsafe("create trigger join_repair_fault before insert on network.members for each row execute function network.join_repair_fault()");
  try {
    await expect(service.accounts.join(app, { e164, personId: null }, { firstName: "Jo", age: 36, homeCity: "nyc", consent })).rejects.toThrow("join repair fault");
  } finally {
    await sql.unsafe("drop trigger join_repair_fault on network.members");
    await sql.unsafe("drop function network.join_repair_fault()");
  }
  const person = (await service.accounts.personFor(e164))!;
  expect((await service.accounts.store.getMembership(person.id, app.id))?.state).toBe("removed");
  expect(await service.accounts.optedIn(app.id, e164)).toBe(false);
  expect(forgotten).toEqual([]);
});
