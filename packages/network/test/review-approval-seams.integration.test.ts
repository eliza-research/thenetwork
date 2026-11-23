import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { SIM_REVIEW_JUDGE, simulatedServiceJudge } from "../../engine/src/reviewJudge.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { BlooioAdapter, DryRunAdapter, type Delivery, type Outbound } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import type { NetworkState } from "../src/network.ts";

const database = `network_review_seams_${randomUUID().replaceAll("-", "")}`;
const local = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}`;
const url = `${local}/${database}`;
const secret = "review-approval-seams-signed-fixture";
const clock = new SimClock(Date.UTC(2026, 10, 12, 17));
let admin: SQL, db: SQL, service: NetworkService;
let turnId = 0;
let holdQueue = true;

class HoldingCarrier extends BlooioAdapter {
  override async deliver(messages: Outbound[]): Promise<Delivery[]> { return holdQueue ? [] : super.deliver(messages); }
}

beforeAll(async () => {
  if (!pgAvailable) return;
  await devPgUp();
  admin = new SQL({ url: `${local}/postgres`, max: 1 });
  await admin.unsafe(`create database ${database}`);
  await applySchema(url, { lockTimeout: "60s" });
  db = new SQL({ url, max: 2 });
  service = new NetworkService({ url, clock, instance: "review-approval-seams", log: () => {}, photoStorage: null, notify: false,
    tokens: "admin:adm-tok", env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret }, reviewJudge: simulatedServiceJudge({ exceptions: false }),
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "peon:nyc" }],
    adapter: (_net, rt) => rt.app.id === "peon" ? new HoldingCarrier({ from: "+12125550100", clock, app: "peon", log: () => {},
      provider: { kind: "sim", send: async request => ({ providerMessageId: request.idempotencyKey, status: "sent" }) } })
      : new DryRunAdapter(() => {}),
  });
  await service.start();
}, 120_000);

afterAll(async () => {
  await service?.close();
  await db?.close();
  await admin?.unsafe(`drop database if exists ${database} with (force)`);
  await admin?.close();
});

async function turn(from: string, text: string) {
  const messageId = `seam-${++turnId}`;
  const payload: TurnRequest = { messageId, from, text, receivedAt: clock.now(), channel: "blooio", to: null, transport: "sms" };
  const body = JSON.stringify(payload);
  const res = await service.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", body, headers: {
    "content-type": "application/json",
    ...await svcSign(secret, { method: "POST", path: TURN_PATH, id: messageId, body, nowS: Math.floor(clock.now() / 1000) }),
  } }));
  const out = { status: res.status, body: await res.json() };
  clock.advance(MINUTE);
  return out;
}

const staff = (path: string, body?: object) => service.fetch(new Request(`http://127.0.0.1/apps/peon${path}`, {
  method: body ? "POST" : "GET", headers: { authorization: "Bearer adm-tok", ...(body ? { "content-type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
}));
const runtime = () => service.runtimeFor("peon")!;
const memberOf = async (phone: string) => (await service.memberApps(phone))[0]?.memberId as string;
const probeOf = async (oppId: string) => db`select m.member_id as "to", m.type, o.status from network.messages m
  join platform.outbound o on o.app_id=m.app_id and o.id=m.id where m.app_id='peon' and m.opportunity_id=${oppId} order by m.ts, m.id`;

async function storedReview(oppId: string, change: (review: NonNullable<NetworkState["opps"][number]["review"]>) => object) {
  const [row] = await db<{ state: NetworkState }[]>`select state from network.network_state where id = ${runtime().id}`;
  const state = row!.state;
  const opp = state.opps.find(item => item.id === oppId)!;
  opp.review = change(opp.review!) as typeof opp.review;
  await db`update network.network_state set state = ${state}::jsonb where id = ${runtime().id}`;
}

// spec/automatedReview.md, "An approval names its approver"
test.skipIf(!pgAvailable)("the Peon send check admits a judge approval and a named legacy reviewer, and refuses a legacy simulator approval and a stopped approval", async () => {
  expect((await staff("/matching", { on: true })).status).toBe(200);
  const roles = ["data analyst", "accountant", "registered nurse", "customer support"] as const;
  const pairs = [];
  for (const [n, role] of roles.entries()) {
    const employerPhone = `+121255502${String(40 + n * 2)}`, candidatePhone = `+121255502${String(41 + n * 2)}`;
    expect((await turn(employerPhone, `join peon\nMy name is Em${"abcd"[n]}. I am 40 years old.`)).status).toBe(200);
    expect((await turn(employerPhone, `We're hiring a ${role}, level 2, 3 openings, $90k-$125k, remote. Must have SQL level 2`)).body.replies[0]).toMatch(/Reply yes to post it/);
    expect((await turn(employerPhone, "yes")).body.replies[0]).toMatch(new RegExp(`^Posted: ${role}\\.`));
    const employer = await memberOf(employerPhone);
    expect(await (await staff(`/employers/${employer}/verify`, { company: `Company ${n}`, note: "Verified by a staff reviewer." })).json()).toEqual({ ok: true });
    expect((await turn(candidatePhone, `join peon\nMy name is Ca${"abcd"[n]}. I am 30 years old.`)).status).toBe(200);
    const draft = await turn(candidatePhone, `PEON JOB SEARCH ${role}; level 2; minimum $85,000; mode remote; skills sql=4`);
    const proof = /CONFIRM PEON JOB SEARCH search_[a-p]{16}/.exec(draft.body.replies?.[0] ?? "")![0];
    expect((await turn(candidatePhone, proof)).body.replies).toEqual(["I saved your Peon job search. I'll ask you before any introduction."]);
    pairs.push({ employer, candidate: await memberOf(candidatePhone), employerPhone, candidatePhone });
  }

  const queue = (runtime().adapter as BlooioAdapter).queue;
  for (const p of pairs) { await queue.inbound(p.employerPhone); await queue.inbound(p.candidatePhone); }
  const day = Math.floor((clock.now() + 24 * HOUR) / (24 * HOUR)) * 24 * HOUR + 19 * HOUR;
  clock.advance((day >= clock.now() + 24 * HOUR ? day : day + 24 * HOUR) - clock.now());
  await runtime().tick();
  for (let run = 0; run < 3; run++) await service.reviewJudgeTick();
  expect(await (await staff("/review")).json()).toMatchObject({ items: [] });

  const state = (await runtime().pg.load())!;
  const items = pairs.map(p => state.opps.find(o => o.participants.includes(p.candidate) && o.participants.includes(p.employer))!);
  for (const item of items) {
    expect(item.review).toMatchObject({ decision: "approve", approver: "judge", reviewer: SIM_REVIEW_JUDGE });
    expect(await probeOf(item.id)).toEqual([expect.objectContaining({ type: "probe", status: "pending" })]);
  }
  const [judged, legacySimulator, legacyStaff, stopped] = items as [typeof items[0], typeof items[0], typeof items[0], typeof items[0]];
  await storedReview(legacySimulator.id, ({ approver: _approver, ...rest }) => ({ ...rest, reviewer: "sim_auto_reviewer" }));
  await storedReview(legacyStaff.id, ({ approver: _approver, ...rest }) => ({ ...rest, reviewer: "staff-1" }));
  await storedReview(stopped.id, review => ({ ...review, stopped: { by: "staff-1", at: clock.now() } }));

  holdQueue = false;
  await runtime().deliver();
  expect(await probeOf(judged.id)).toEqual([expect.objectContaining({ to: pairs[0]!.candidate, type: "probe", status: "sent" })]);
  expect(await probeOf(legacySimulator.id)).toEqual([expect.objectContaining({ to: pairs[1]!.candidate, type: "probe", status: "suppressed_ineligible" })]);
  expect(await probeOf(legacyStaff.id)).toEqual([expect.objectContaining({ to: pairs[2]!.candidate, type: "probe", status: "sent" })]);
  expect(await probeOf(stopped.id)).toEqual([expect.objectContaining({ to: pairs[3]!.candidate, type: "probe", status: "suppressed_ineligible" })]);
}, 300_000);
