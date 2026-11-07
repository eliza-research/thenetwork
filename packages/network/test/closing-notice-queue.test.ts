// The live queue's stale check against the texts the Network writes as a date ends (PRD F18, F19, F29):
// the drop notice to the other member and the post-meeting feedback ask go out; a text queued about the
// date before it ended still expires unsent. The Network and the queue share one clock, as in the service.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { MINUTE } from "@thenetwork/core";
import type { SendRequest } from "../../blooio/src/types.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { Mini } from "./mini.ts";

const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_closing_notice_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
let sql: SQL;

beforeAll(async () => {
  if (!pgAvailable) return;
  await devPgUp();
  const a = new SQL({ url: ADMIN_URL, max: 1 });
  try { await a.unsafe(`drop database if exists ${DB} with (force)`); await a.unsafe(`create database ${DB}`); } finally { await a.close(); }
  const url = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
  await applySchema(url, { lockTimeout: "5s" });
  sql = new SQL({ url, max: 2 });
}, 120_000);
afterAll(async () => {
  await sql?.close();
  if (!pgAvailable) return;
  const a = new SQL({ url: ADMIN_URL, max: 1 });
  try { await a.unsafe(`drop database if exists ${DB} with (force)`); } finally { await a.close(); }
});

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const ADDR: Record<string, string> = { a: "+12125550181", b: "+12125550182" };

async function booked() {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
  await w.onboard("a", "b"); w.propose(["a", "b"]); await w.answerProbes(["a", "b"]);
  const opp = [...(w.net as any).opps.values()].find((o: any) => o.stage === "scheduled");
  expect(opp).toBeDefined();
  const sent: SendRequest[] = [];
  // Rows carry no member id: the member-binding checks need platform rows this test does not seed.
  const rt: any = { net: w.net, memberOf: () => undefined, addressOf: (id: string) => ADDR[id], db: sql, instance: `closing-${process.pid}`,
    optedOut: async () => false, notificationCurrent: async () => true, capTake: async () => true, capRelease: async () => {}, relayAdmission: async () => ({ ok: true }) };
  const ad = new BlooioAdapter({ from: "+12125550100", clock: w.clock, app: "friends", env: {}, log: () => {}, liveGate: () => true,
    provider: { kind: "sim", send: async (r: SendRequest) => { sent.push(r); return { providerMessageId: `sim:${r.idempotencyKey}`, status: "sent" as const }; } } as any,
    limits: { perRecipientPerHour: 100 } } as any);
  ad.attach(rt);
  for (const to of Object.values(ADDR)) await ad.queue.inbound(to);
  return { w, opp, ad, sent };
}

test.skipIf(!pgAvailable)("a drop notice written as the date closes is sent; a text queued before the close expires", async () => {
  const { w, opp, ad } = await booked();
  // Queued about the date while it was still on, held until after it closed.
  await ad.queue.enqueue(sql, [{ id: `t1-before-${opp.id}`, to: ADDR.b!, kind: "transactional", text: "See you Saturday.", oppId: opp.id, city: "nyc" }]);
  w.clock.advance(MINUTE);
  const from = w.mark();
  await w.say("a", "sorry, I can't make it anymore");
  expect(opp.stage).toBe("closed");
  const notice = w.to("b", from).find(s => (s.meta as any).type === "cancellation")!;
  expect(notice).toBeDefined();
  await ad.queue.enqueue(sql, [{ id: `t1-drop-${opp.id}`, to: ADDR.b!, kind: "transactional", text: notice.body, oppId: opp.id, city: "nyc" }]);
  await ad.queue.drain();
  expect(await ad.queue.statusOf(`t1-drop-${opp.id}`)).toBe("sent");
  expect(await ad.queue.statusOf(`t1-before-${opp.id}`)).toBe("expired");
}, 120_000);

test.skipIf(!pgAvailable)("the post-meeting feedback ask is sent", async () => {
  const { w, opp, ad } = await booked();
  let mark = w.mark(), ask: { body: string } | undefined;
  for (let h = 0; h < 240 && !ask; h++) {
    await w.run(3_600_000);
    ask = w.sent.slice(mark).find(s => s.to === "a" && (s.meta as any).type === "feedback_request"); mark = w.mark();
  }
  expect(ask).toBeDefined();
  expect(opp.stage).toBe("done");
  await ad.queue.enqueue(sql, [{ id: `t2-fb-${opp.id}`, to: ADDR.a!, kind: "transactional", text: ask!.body, oppId: opp.id, city: "nyc" }]);
  await ad.queue.drain();
  expect(await ad.queue.statusOf(`t2-fb-${opp.id}`)).not.toBe("expired");
}, 120_000);
