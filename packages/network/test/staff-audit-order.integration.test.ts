// Audit OPS27: a leak-review decision, an inbound-turn release and a phone-hold decision each act only after
// their request audit row, and write a result row after the act, like every other staff safety action.
// spec/staffSafetyService.md, "Keep the requested and result audits in order"
// Needs the dev Postgres on :54339.
import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { applySchema } from "../../observatory/db/dev-pg.ts";
import { PgAudit } from "../../observatory/src/staff.ts";
import type { AuditEntry } from "../../observatory/src/types.ts";
import { APPS } from "../../platform/src/apps.ts";
import { CloudChannelAdapter } from "../service/cloud-channel.ts";
import { NetworkService } from "../service/service.ts";

const db = `network_staff_audit_${randomUUID().replaceAll("-", "")}`, url = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/${db}`;
const admin = new SQL({ url: `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/postgres`, max: 1 });
const clock = new SimClock(Date.UTC(2026, 10, 17, 16));
const token = "synthetic-staff-audit-order-token-20261117";
const phone = "+12125550231";
const secret = "synthetic-staff-audit-order-turn-secret-2026";
let sql: SQL, service: NetworkService, auditDown = false, line = "";

const staff = (path: string, b: object) => service.fetch(new Request(`http://127.0.0.1${path}?app=friends`, {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(b),
}));
const parked = async () => (await sql`select status from platform.outbound where id='parked-1'`)[0]?.status;
const turn = async () => (await sql`select status, sender_hash from platform.inbound where id='msg:blooio:stuck-1'`)[0];
const hold = async () => (await sql`select hold from platform.phone_identities where e164=${phone}`)[0]?.hold;
const phases = async (action: string) => (await sql`select detail->>'phase' as phase, ok from network.staff_audit where action=${action} order by id`)
  .map(r => `${r.phase}:${r.ok}`);

beforeAll(async () => {
  await admin.unsafe(`create database ${db}`);
  await applySchema(url, { lockTimeout: "5s" });
  sql = new SQL({ url, max: 2 });
  const audit = new PgAudit(url);
  service = new NetworkService({
    url, clock, photoStorage: null, tokens: `admin@*:${token},safety@*:${token}`,
    audit: { kind: audit.kind, list: q => audit.list(q), close: () => audit.close(), write: async (entry: AuditEntry) => {
      if (auditDown) throw new Error("synthetic audit sink outage");
      await audit.write(entry);
    } },
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
    networks: [{ id: "friends:nyc", matchingEnabled: false }], network: { seed: 1 }, log: () => {},
    adapter: (_net, rt) => new CloudChannelAdapter({ clock, app: rt.app.id, city: rt.city, from: "+12125550230", origin: "http://127.0.0.1:9", secret,
      env: { PLATFORM_ENV: "dev" } }),
  });
  await service.start();
  line = (service.runtimeFor("friends")!.adapter as CloudChannelAdapter).queue.line;
  const now = new Date(clock.now());
  await sql`insert into platform.outbound (id, app_id, line, kind, fingerprint, time_zone, status, next_attempt_at, created_at, updated_at, body, to_address, note)
    values ('parked-1', 'friends', ${line}, 'reply', 'fixture', 'America/New_York', 'parked_leak_review', ${now}, ${now}, ${now}, 'Fixture text', '+12125550299', 'leak: canary')`;
  await sql`insert into platform.inbound (id, received_at, arrived_at, status, request_hash, sender_hash)
    values ('msg:blooio:stuck-1', ${now}, ${now}, 'processing', 'fixture-hash', 'fixture-sender')`;
  const joined = await service.accounts.join(APPS.friends, { e164: phone, personId: null }, { firstName: "Ada", age: 33, consent: { sms: true, wording: APPS.friends.consent.text } });
  expect(joined.ok).toBe(true);
  await service.people.setPhoneHold(phone, "recycled_number", clock.now());
}, 60_000);

afterAll(async () => {
  await service?.close();
  await sql?.close();
  await admin.unsafe(`drop database if exists ${db} with (force)`);
  await admin.close();
});

test("with the audit sink down, no staff action runs; with it up, each action has a request row before it and a result row after it", async () => {
  auditDown = true;
  for (const r of [
    await staff("/queue/leak-review/parked-1", { decision: "drop", reason: "a fixture canary, never send" }),
    await staff("/inbound/resolve", { id: "msg:blooio:stuck-1" }),
    await staff("/holds", { phone, decision: "same_owner" }),
  ]) expect(r.ok).toBe(false);
  // Nothing acted: the text is still parked, the turn still holds back its sender, and the number is still on hold.
  expect(await parked()).toBe("parked_leak_review");
  expect(await turn()).toMatchObject({ status: "processing", sender_hash: "fixture-sender" });
  expect(await hold()).toBe("recycled_number");

  auditDown = false;
  expect(await (await staff("/queue/leak-review/parked-1", { decision: "drop", reason: "a fixture canary, never send" })).json()).toEqual({ ok: true });
  expect(await (await staff("/inbound/resolve", { id: "msg:blooio:stuck-1" })).json()).toEqual({ ok: true });
  expect(await (await staff("/holds", { phone, decision: "same_owner" })).json()).toEqual({ ok: true });
  expect(await parked()).toBe("dropped_leak_review");
  expect(await turn()).toMatchObject({ status: "unresolved", sender_hash: null });
  expect(await hold()).toBeNull();
  expect(await phases("leak_drop")).toEqual(["requested:true", "result:true"]);
  expect(await phases("resolve_inbound_turn")).toEqual(["requested:true", "result:true"]);
  expect((await sql`select detail->>'phase' as phase, ok from network.staff_audit where action='safety' and detail->>'safety'='phone_hold' order by id`)
    .map(r => `${r.phase}:${r.ok}`)).toEqual(["requested:true", "result:true"]);
  // The leak decision keeps the staff member's reason on both rows.
  expect((await sql`select reason from network.staff_audit where action='leak_drop'`).map(r => r.reason)).toEqual(["a fixture canary, never send", "a fixture canary, never send"]);
}, 60_000);
