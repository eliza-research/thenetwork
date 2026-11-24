import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test } from "vitest";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { peonPack, PEON_ENGINE_CONFIG, runEngine } from "@thenetwork/engine";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../db/dev-pg.ts";
import { pgAvailable } from "../../../apps/observatory/test/pg.ts";
import { BlooioAdapter, DryRunAdapter, type Delivery, type Outbound } from "../service/channel.ts";
import { appWiring } from "../service/packs.ts";
import { NetworkService } from "../service/service.ts";
import { loadSnapshot } from "../service/snapshot.ts";

const database = `network_peon_search_${randomUUID().replaceAll("-", "")}`;
const local = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}`;
const url = `${local}/${database}`;
const secret = "peon-candidate-search-signed-fixture";
let clock: SimClock;
const candidate = "+12125550183";
const manager = "+12125550184";
const minor = "+12125550185";
let admin: SQL, db: SQL, service: NetworkService;
let holdPeonQueue = false;
const accepted = new Set<string>();

class PeonTestCarrier extends BlooioAdapter {
  override async deliver(messages: Outbound[]): Promise<Delivery[]> {
    return holdPeonQueue ? [] : super.deliver(messages);
  }
}

function start() {
  service = new NetworkService({ url, clock, instance: "peon-candidate-search", log: () => {}, photoStorage: null, notify: false,
    tokens: "admin:adm-tok", env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret },
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "peon:nyc" }],
    adapter: (_net, rt) => rt.app.id === "peon" ? new PeonTestCarrier({ from: "+12125550100", clock, app: "peon", liveGate: () => true,
      log: () => {}, provider: { kind: "sim", send: async request => {
        accepted.add(request.idempotencyKey);
        return { providerMessageId: request.idempotencyKey, status: "sent" };
      } },
    }) : new DryRunAdapter(() => {}),
  });
  return service.start();
}

async function turn(messageId: string, from: string, text: string, receivedAt = clock.now()) {
  const payload: TurnRequest = { messageId, from, text, receivedAt, channel: "blooio", to: null, transport: "sms" };
  const body = JSON.stringify(payload);
  const res = await service.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", body, headers: {
    "content-type": "application/json",
    ...await svcSign(secret, { method: "POST", path: TURN_PATH, id: messageId, body, nowS: Math.floor(clock.now() / 1000) }),
  } }));
  return { status: res.status, body: await res.json() };
}

async function peonReviewItem(memberId: string) {
  await service.runtimeFor("peon")!.tick();
  const review = await (await service.fetch(new Request("http://127.0.0.1/apps/peon/review", {
    headers: { authorization: "Bearer adm-tok" },
  }))).json();
  return review.items.find((item: { proposal: { participants: string[] } }) => item.proposal.participants.includes(memberId));
}

async function queuedProbe(oppId: string, memberId: string, exceptId?: string) {
  return (await db`select o.id,o.status,m.body from platform.outbound o join network.messages m on m.app_id=o.app_id and m.id=o.id
    where o.app_id='peon' and m.opportunity_id=${oppId} and m.member_id=${memberId} and m.type='probe'`)
    .find(row => row.id !== exceptId);
}

const staff = (path: string, body: object) => service.fetch(new Request(`http://127.0.0.1/apps/peon${path}`, {
  method: "POST", headers: { authorization: "Bearer adm-tok", "content-type": "application/json" }, body: JSON.stringify(body),
}));

beforeEach(async () => {
  if (!pgAvailable) return;
  clock = new SimClock(Date.UTC(2026, 10, 12, 17));
  holdPeonQueue = false;
  accepted.clear();
  await devPgUp();
  admin = new SQL({ url: `${local}/postgres`, max: 1 });
  await admin.unsafe(`create database ${database}`);
  await applySchema(url, { lockTimeout: "5s" });
  db = new SQL({ url, max: 2 });
  await start();
}, 120_000);

afterEach(async () => {
  await service?.close();
  await db?.close();
  await admin?.unsafe(`drop database if exists ${database} with (force)`);
  await admin?.close();
});

test.skipIf(!pgAvailable)("a signed Peon candidate read-back becomes a Hire profile only on exact confirmation", async () => {
  for (const [id, phone, name, age] of [["adult", candidate, "Rae", 29], ["employer", manager, "Sam", 36], ["minor", minor, "Kim", 16]] as const) {
    expect(await turn(`join-${id}`, phone, `join peon\nMy name is ${name}. I am ${age} years old.`))
      .toMatchObject({ status: 200, body: { outcome: "handled", reason: "joined", app: "peon" } });
  }
  const [owner] = await service.memberApps(candidate);
  const [employer] = await service.memberApps(manager);
  expect((await staff(`/employers/${employer!.memberId}/verify`, { company: "Acme & Sons, Inc.", note: "Verified by a staff reviewer." })).status).toBe(200);
  expect((await staff("/postings", { managerId: employer!.memberId, title: "data analyst", seniority: 2,
    openings: 3, payMin: 90, payMax: 125, mode: "remote", must: [{ skill: "sql", level: 2 }] })).status).toBe(200);

  const search = "PEON JOB SEARCH data analyst; level 2; minimum $85,125.50; mode remote; skills sql=4; exclude OtherCo";
  expect((await turn("minor-draft", minor, search)).body).toMatchObject({ reason: "peon_candidate_search", replies: [] });
  const invalid = await turn("invalid-draft", candidate, `${search}; graduation year 2015`);
  expect(invalid.body.replies[0]).toContain("To draft a Peon job search");
  const pendingAt = clock.now();
  const proposed = await turn("draft-a", candidate, search, pendingAt);
  expect(proposed).toMatchObject({ status: 200, body: { reason: "peon_candidate_search", app: "peon", memberId: owner!.memberId } });
  const proposedBody: string = proposed.body.replies[0];
  expect(proposedBody).toContain("$85,125.50 USD");
  const confirmation = proposedBody.match(/CONFIRM PEON JOB SEARCH search_[a-p]{16}/)![0];
  expect((await turn("draft-a", candidate, search, pendingAt)).body.replies).toEqual([proposedBody]);
  const matching = async () => {
    const input = await loadSnapshot(db, clock.now(), { app: "peon", city: "nyc" });
    const adapt = appWiring("peon").hooks!.engineInput!;
    return (await runEngine(adapt({ ...input, interactions: [] }), { ...PEON_ENGINE_CONFIG, cities: ["nyc"], seed: 1 }, { pack: peonPack })).proposals;
  };
  expect(await matching()).toEqual([]);
  await turn("bare-yes", candidate, "Yes", pendingAt);
  expect(await db`select id from network.intents where app_id='peon' and details='peon:search'`).toEqual([]);
  clock.advance(MINUTE);
  await service.close();
  await start();
  const approvedAt = clock.now();
  const saved = await turn("confirm-a", candidate, confirmation, approvedAt);
  expect(saved.body.replies).toEqual(["I saved your Peon job search. I'll ask you before any introduction."]);
  expect((await turn("confirm-a", candidate, confirmation, approvedAt)).body.replies).toEqual(saved.body.replies);
  const live = await db`select member_id,status from network.intents where app_id='peon' and details='peon:search'`;
  expect(live).toEqual([{ member_id: owner!.memberId, status: "active" }]);
  const facets = await db`select tags,privacy_scope from network.facets where app_id='peon' and member_id=${owner!.memberId}`;
  expect(facets).toContainEqual({ tags: ["peon:exclude:otherco", "peon:candidate_search"], privacy_scope: "agent_private" });
  expect(facets.flatMap(row => row.tags)).toContain("peon:pay_floor:85.1255");
  expect(await matching()).toEqual(expect.arrayContaining([expect.objectContaining({ lane: "Hire",
    participants: expect.arrayContaining([owner!.memberId, expect.stringMatching(/^job:/)]),
  })]));

  // Staff reviews an ordinary generated opportunity. The candidate alone sees the first question.
  expect((await staff("/matching", { on: true })).status).toBe(200);
  const runtime = service.runtimeFor("peon")!;
  const queue = (runtime.adapter as PeonTestCarrier).queue;
  await queue.inbound(candidate);
  await queue.inbound(manager);
  clock.advance(26 * HOUR);
  const item = await peonReviewItem(owner!.memberId);
  expect(item).toBeDefined();
  holdPeonQueue = true;
  expect(await (await staff(`/review/${encodeURIComponent(item.oppId)}`, { decision: "approve", revision: item.revision })).json()).toEqual({ ok: true });
  const queuedFor = (memberId: string) => queuedProbe(item.oppId, memberId);
  const first = await queuedFor(owner!.memberId);
  expect(first?.status).toBe("pending");
  await turn("early-candidate-yes", candidate, "Yes");
  expect(await queuedFor(employer!.memberId)).toBeUndefined();
  holdPeonQueue = false;
  await runtime.deliver();
  expect(accepted.has(`tn:${first.id}`)).toBe(true);
  expect(await queuedFor(employer!.memberId)).toBeUndefined();
  clock.advance(MINUTE);
  holdPeonQueue = true;
  await turn("candidate-yes-to-delivered-role", candidate, "Yes");
  const pendingForEmployer = await queuedFor(employer!.memberId);
  expect(pendingForEmployer?.status).toBe("pending");

  // A new approved private company exclusion removes the fit. A draft alone does not.
  const replacement = await turn("draft-b", candidate, search.replace("OtherCo", "Acme & Sons, Inc."));
  expect((await db`select tags from network.facets where app_id='peon' and member_id=${owner!.memberId} and kind='boundary'`)
    .flatMap(row => row.tags)).toContain("peon:exclude:otherco");
  const replacementProof = replacement.body.replies[0].match(/CONFIRM PEON JOB SEARCH search_[a-p]{16}/)[0];
  expect((await turn("use-older-reference", candidate, confirmation)).body.replies[0]).toContain("no longer available");
  expect((await turn("confirm-b", candidate, replacementProof)).status).toBe(200);
  expect(await matching()).toEqual([]);
  holdPeonQueue = false;
  await runtime.deliver();
  expect(accepted.has(`tn:${pendingForEmployer.id}`)).toBe(false);
  expect((await queuedFor(employer!.memberId))?.status).toBe("suppressed_ineligible");

  const expired = await turn("draft-c", candidate, search);
  const expiredProof = expired.body.replies[0].match(/CONFIRM PEON JOB SEARCH search_[a-p]{16}/)[0];
  clock.advance(15 * MINUTE);
  await service.purge();
  expect(await db`select reference from network.peon_candidate_search_drafts where member_id=${owner!.memberId}`).toEqual([]);
  expect((await turn("confirm-c", candidate, expiredProof)).body.replies[0]).toContain("no longer available");
  expect(await matching()).toEqual([]);

  // spec/standingIntentManagement.md: an owner pauses an intent while its first probe is queued.
  const pausedPhone = "+12125550186";
  // Fix the membership and draft IDs so the legacy list reference contains a seven-digit run.
  const memberId = "peon_00000000-0000-4000-8000-000000000003";
  const invitation = await service.accounts.invite(APPS.peon, pausedPhone);
  await db`update platform.memberships set member_id=${memberId} where app_id='peon' and member_id=${invitation!.memberId}`;
  expect((await turn("join-pause-candidate", pausedPhone, "join peon\nMy name is Vic. I am 31 years old.")).body)
    .toMatchObject({ reason: "joined", memberId });
  const pausingDraft = await turn("pause-candidate-draft", pausedPhone, search);
  expect(pausingDraft.body.replies[0]).toMatch(/CONFIRM PEON JOB SEARCH search_[a-p]{16}/);
  const draftReference = "search_abcdefghijklmnop";
  await db`update network.peon_candidate_search_drafts set reference=${draftReference} where app_id='peon' and member_id=${memberId}`;
  expect((await turn("pause-candidate-confirm", pausedPhone, `CONFIRM PEON JOB SEARCH ${draftReference}`)).body.replies)
    .toEqual(["I saved your Peon job search. I'll ask you before any introduction."]);
  await queue.inbound(pausedPhone);
  clock.advance(24 * HOUR);
  const pausedItem = await peonReviewItem(memberId);
  expect(pausedItem).toBeDefined();
  holdPeonQueue = true;
  expect(await (await staff(`/review/${encodeURIComponent(pausedItem.oppId)}`, { decision: "approve", revision: pausedItem.revision })).json()).toEqual({ ok: true });
  const pausedProbe = await queuedProbe(pausedItem.oppId, memberId);
  expect(pausedProbe?.status).toBe("pending");
  const listed = await turn("list-search", pausedPhone, "LIST MY INTENTS");
  const reference = "INT-MPGPEEACABCL";
  const legacyReference = "I-CF6F4402012B";
  expect(listed.body.replies.join("\n")).toContain(`${reference} · active · Find work as a data analyst`);
  const status = async () => (await db`select status from network.intents where app_id='peon' and member_id=${memberId} and details='peon:search'`)[0]?.status;
  for (const [id, otherReference] of [["new", reference], ["legacy", legacyReference]]) {
    const denied = await turn(`pause-other-member-search-${id}`, manager, `PAUSE INTENT ${otherReference}`);
    expect(denied.body.replies[0]).toContain("I couldn't identify one saved intent");
    expect(await status()).toBe("active");
  }
  expect((await turn("pause-search", pausedPhone, `PAUSE INTENT ${reference}`)).body.replies).toEqual([`Paused intent ${reference}.`]);
  expect(await status()).toBe("paused");
  holdPeonQueue = false;
  await runtime.deliver();
  expect(accepted.has(`tn:${pausedProbe.id}`)).toBe(false);
  expect((await queuedProbe(pausedItem.oppId, memberId))?.status).toMatch(/^(suppressed_ineligible|expired)$/);
  expect((await turn("close-search-legacy", pausedPhone, `CLOSE INTENT ${legacyReference.toLowerCase()}`)).body.replies).toEqual([`Closed intent ${reference}.`]);
  expect(await status()).toBe("closed");
});

test.skipIf(!pgAvailable)("a posting displaces the queued manager question and a fresh receipt can book the same introduction", async () => {
  expect((await turn("join-candidate", candidate, "join peon\nMy name is Rae. I am 29 years old.")).body).toMatchObject({ reason: "joined" });
  expect((await turn("join-manager", manager, "join peon\nMy name is Sam. I am 36 years old.")).body).toMatchObject({ reason: "joined" });
  const [owner] = await service.memberApps(candidate);
  const [employer] = await service.memberApps(manager);
  expect((await staff(`/employers/${employer!.memberId}/verify`, { company: "Acme", note: "Verified by staff." })).status).toBe(200);
  expect((await staff("/postings", { managerId: employer!.memberId, title: "data analyst", seniority: 2, openings: 1,
    payMin: 90, payMax: 125, mode: "remote", must: [{ skill: "sql", level: 2 }] })).status).toBe(200);
  const draft = await turn("candidate-search", candidate, "PEON JOB SEARCH data analyst; level 2; minimum $85,000; mode remote; skills sql=4");
  const confirmation = draft.body.replies[0].match(/CONFIRM PEON JOB SEARCH search_[a-p]{16}/)![0];
  clock.advance(MINUTE);
  expect((await turn("candidate-confirm-search", candidate, confirmation)).body.replies[0]).toContain("I saved your Peon job search");
  expect((await staff("/matching", { on: true })).status).toBe(200);
  const runtime = service.runtimeFor("peon")!;
  const queue = (runtime.adapter as PeonTestCarrier).queue;
  for (const phone of [candidate, manager]) await queue.inbound(phone);
  clock.advance(26 * HOUR);
  const item = await peonReviewItem(owner!.memberId);
  expect(item).toBeDefined();
  expect((await staff(`/review/${encodeURIComponent(item.oppId)}`, { decision: "approve", revision: item.revision })).status).toBe(200);
  await runtime.deliver();
  const role = await queuedProbe(item.oppId, owner!.memberId);
  expect(accepted.has(`tn:${role!.id}`)).toBe(true);
  clock.advance(MINUTE);
  holdPeonQueue = true;
  await turn("candidate-yes-to-role", candidate, "Yes");
  const interrupted = await queuedProbe(item.oppId, employer!.memberId);
  expect(interrupted?.status).toBe("pending");
  const opportunity = () => runtime.net.exportState().opps.find(o => o.id === item.oppId);
  const employerQuestions = () => runtime.net.exportState().members.find(member => member.id === employer!.memberId)?.asked;
  const firstSentAt = opportunity()?.sentAt?.[employer!.memberId];
  const asked = employerQuestions();

  clock.advance(MINUTE);
  const posting = await turn("manager-starts-different-post", manager, "We're hiring a barista, 1 opening, $40k-$50k, onsite in Manhattan");
  expect(posting.body.replies.join(" ")).toContain("Reply yes to post it");
  holdPeonQueue = false;
  await runtime.deliver();
  expect(accepted.has(`tn:${interrupted!.id}`)).toBe(false);
  expect((await queuedProbe(item.oppId, employer!.memberId))?.status).toBe("suppressed_ineligible");

  clock.advance(MINUTE);
  holdPeonQueue = true;
  await turn("manager-declines-different-post", manager, "No");
  await runtime.tick();
  const fresh = await queuedProbe(item.oppId, employer!.memberId, interrupted!.id);
  expect(fresh?.status).toBe("pending");
  expect(opportunity()?.sentAt?.[employer!.memberId]).toBe(firstSentAt);
  expect(employerQuestions()).toBe(asked);

  const admission = (row: { id: string; body: string }) => db.begin(tx => runtime.peonHireAdmission(tx, {
    app: "peon", oppId: item.oppId, memberId: employer!.memberId, id: row.id, text: row.body,
  }));
  expect(await admission(interrupted!)).toMatchObject({ ok: false });
  expect(await admission(fresh!)).toEqual({ ok: true });
  await turn("manager-yes-before-fresh-delivery", manager, "Yes");
  expect(opportunity()?.stage).toBe("probing");

  holdPeonQueue = false;
  await runtime.deliver();
  expect(accepted.has(`tn:${fresh!.id}`)).toBe(true);
  clock.advance(MINUTE);
  await turn("manager-yes-after-fresh-delivery", manager, "Yes");
  expect(opportunity()?.stage).toBe("scheduled");
});
