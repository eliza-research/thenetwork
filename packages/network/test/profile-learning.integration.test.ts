// Profile-learning state machine (docs/research/quint-findings/profile_learning.md): Postgres-backed
// cases for the suggestion store, the review parser and the delete-everything path.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { SQL } from "bun";
import { createHash, randomUUID } from "node:crypto";
import { applySchema, devPgUp, DEV_PG_PORT } from "../../observatory/db/dev-pg.ts";
import { ProfileSuggestions, type SuggestionOwner, type SourceSuggestion } from "../service/profile-suggestions.ts";
import { renderSuggestionReview, reviewSuggestionMessage } from "../service/profile-suggestion-review.ts";
import { PgPeopleStore } from "../../platform/src/pg-store.ts";
import { SimClock } from "@thenetwork/core";
import { NetworkService } from "../service/service.ts";
import type { ProfileReviewDisconnectProof, ProfileReviewDisconnectRequest } from "../../core/src/svc/profile-review-disconnect.ts";

const now = Date.UTC(2026, 9, 17, 12);
const e164 = "+12125550100";
const db = `profile_learning_${process.pid}`;
const base = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}`;
let sql: SQL;
let owner: SuggestionOwner;
let store: ProfileSuggestions;
const gmail = (): SourceSuggestion => ({ connectionId: "owned-google-connection", source: "gmail", observedAt: now - 1000,
  kind: "interest", value: "I enjoy climbing", tags: ["climbing"], confidence: 0.7, scope: "agent_private" });
const input = (suggestions = [gmail()], windowEnd = now) => ({ windowStart: now - 60_000, windowEnd,
  timezone: "America/Los_Angeles", allowedKinds: ["interest" as const], expiresAt: now + 60_000, retainOnDisconnect: false, suggestions });

beforeAll(async () => {
  await devPgUp();
  const admin = new SQL(`${base}/postgres`);
  await admin.unsafe(`create database ${db}`);
  await admin.close();
  sql = new SQL(`${base}/${db}`);
});
beforeEach(async () => {
  await applySchema(`${base}/${db}`, { reset: true });
  owner = { personId: randomUUID(), app: "ntwrk", chatId: "own-chat", userId: "own-user", organizationId: "own-org" };
  await sql`insert into platform.people(id,lowest_age,phone_hash) values(${owner.personId},30,'fixture-phone-hash')`;
  await sql`insert into platform.memberships(person_id,app_id,member_id,state,first_name,profile) values(${owner.personId},'ntwrk','owned-member','active','Alex','{}')`;
  await sql`insert into network.members(id,app_id,person_id,name,age,home_city,account_status) values('owned-member','ntwrk',${owner.personId},'Alex',30,'nyc','active')`;
  await sql`insert into platform.phone_identities(e164,person_id,verified_at,method) values(${e164},${owner.personId},${new Date(now)},'inbound_message')`;
  store = new ProfileSuggestions(sql, async (who, consent) => who.userId === owner.userId && consent.connectionId === "owned-google-connection");
});
afterAll(async () => {
  await sql.close();
  const admin = new SQL(`${base}/postgres`);
  await admin.unsafe(`drop database ${db}`);
  await admin.close();
});

// SD-170: the V1 cleanup receipt holds Cloud user, organization, chat and connection ids.
test("delete everything removes the connection cleanup receipts of the person", async () => {
  await sql`insert into platform.profile_suggestion_connection_receipts(request_nonce,request_hash,event_id,operation,app_id,person_id,member_id,user_id,organization_id,chat_id,connection_id,revoked_at)
    values(${randomUUID()},${"a".repeat(64)},'revoked-event','readback','ntwrk',${owner.personId},'owned-member',${owner.userId},${owner.organizationId},${owner.chatId},'owned-google-connection',${new Date(now)})`;
  await new PgPeopleStore(sql).deleteAll(owner.personId, e164, "fixture-phone-hash", now);
  expect(await sql`select request_nonce from platform.profile_suggestion_connection_receipts`).toHaveLength(0);
});

// SD-175: STOP is in the consent ledger, but the member projection (opted_out, membership state) is not yet updated.
test("a STOP in the consent ledger blocks collect and accept before the projection changes", async () => {
  const pending = (await store.propose(owner, input(), now))!;
  expect(pending).not.toBeNull();
  await sql`insert into platform.consent_events(e164,app_id,state,source,at) values(${e164},null,'opted_out','fixture',${new Date(now)})`;
  expect((await sql`select opted_out from network.members where id='owned-member'`)[0].opted_out).toBe(false);
  expect(await store.propose(owner, input(), now)).toBeNull();
  expect(await store.decide(owner, { batchId: pending.id, revision: pending.revision,
    decisions: [{ suggestionId: pending.suggestions[0]!.id, action: "accept" }] }, now)).toEqual({ kind: "denied" });
  expect(await sql`select id from network.facets`).toHaveLength(0);
  expect(await sql`select id from platform.profile_suggestion_batches`).toHaveLength(1);
});

// SD-240: the store accepts a future Calendar event start by design; the review must show it and let the member decide.
test("a batch with a future Calendar event renders, and the member can reject its rows", async () => {
  const eventStart = now + 3_600_000;
  const calendar: SourceSuggestion = { ...gmail(), source: "google_calendar", observedAt: eventStart, value: "I enjoy group walks", tags: ["walking"] };
  const batch = (await store.propose(owner, input([gmail(), calendar], eventStart + 1000), now))!;
  expect(batch.suggestions).toHaveLength(2);
  const text = renderSuggestionReview(batch, owner, now);
  expect(text).not.toBeNull();
  const index = batch.suggestions.findIndex(s => s.source === "google_calendar") + 1;
  expect(await reviewSuggestionMessage(store, owner, batch.id, `reject ${batch.id}.${batch.revision} ${index}`, now))
    .toMatchObject({ kind: "saved", rejected: [batch.suggestions[index - 1]!.id] });
});

// SD-462: network code reads time only from the Clock. The V1 and V2 cleanups read Date.now() when the store had no fence clock.
test("revoked-connection cleanup reads time only from the store clock, never the wall clock", async () => {
  const who = { ...owner, userId: randomUUID(), organizationId: randomUUID(), chatId: `personal:${randomUUID()}` };
  const connectionId = randomUUID();
  await new ProfileSuggestions(sql, async () => true).propose(who, input([{ ...gmail(), connectionId }]), now);
  const v1 = (issuedAt: number) => {
    const request: ProfileReviewDisconnectRequest = { version: 1, operation: "disconnect", app: who.app, personId: who.personId, memberId: "owned-member",
      connectionId, revokedEventId: `fixture-revoked:${randomUUID()}`, requestNonce: randomUUID() };
    const proof: ProfileReviewDisconnectProof = { ...request, purpose: "network-profile-review-revoked-owner-v1",
      requestSha256: createHash("sha256").update(JSON.stringify(request)).digest("hex"), userId: who.userId, organizationId: who.organizationId,
      chatId: who.chatId, connectionState: "revoked", revokedAt: issuedAt, issuedAt, expiresAt: issuedAt + 10_000 };
    return { request, proof };
  };
  const wall = v1(Date.now());
  const noClock = new ProfileSuggestions(sql, async () => false, async () => true);
  expect(await noClock.applyRevokedConnection(who, wall.request, wall.proof, () => true)).toBeNull();
  expect((await sql`select status from platform.profile_suggestions`)[0].status).toBe("proposed");
  const clocked = new ProfileSuggestions(sql, async () => false, async () => true, { now: () => now + 1, valid: () => true });
  const onClock = v1(now);
  expect(await clocked.applyRevokedConnection(who, onClock.request, onClock.proof, () => true)).toEqual({ pending: 0, retainedAccepted: 0, linkedFacts: 0 });
  expect((await sql`select status from platform.profile_suggestions`)[0].status).toBe("withdrawn");
});

// SD-463: leave runs the Network forget, then removes the membership in a second transaction.
// A crash between the two kept the batches and their pending text, and owned() could no longer reach them.
test("a leave that stops after the Network forget leaves no suggestion batches", async () => {
  await store.propose(owner, input(), now);
  const service = new NetworkService({ url: `${base}/${db}`, clock: new SimClock(now), networks: [{ id: "ntwrk:nyc" }], log: () => {},
    env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: "local-profile-learning-fixture-secret-only", PLATFORM_HASH_KEY: "synthetic-profile-learning-hash-key" } });
  try {
    service.people.forgetMembership = async () => { throw new Error("crash after the Network forget"); };
    await expect(service.accounts.leave(service.apps.ntwrk, { e164, personId: owner.personId })).rejects.toThrow("crash after the Network forget");
    expect((await sql`select person_id from network.members where id='owned-member'`)[0].person_id).toBeNull();
    expect((await sql`select state from platform.memberships where person_id=${owner.personId}`)[0].state).toBe("active");
    expect(await sql`select id from platform.profile_suggestion_batches`).toHaveLength(0);
    expect(await sql`select id from platform.profile_suggestions`).toHaveLength(0);
  } finally { await service.close(); }
});

// Q-profile_learning-1: a ban or a phone hold commits while the Cloud source checks run. The person and
// member locks do not stop either write (a phone ban has no person row to wait on), so the eligibility read
// at the start of the transaction was stale.
test("a ban or hold during the Cloud source checks blocks collect and accept", async () => {
  const people = new PgPeopleStore(sql);
  const pending = (await store.propose(owner, input(), now))!;
  expect(pending).not.toBeNull();
  const banDuringCheck = new ProfileSuggestions(sql, async () => {
    await people.ban({ id: randomUUID(), scope: "phone", personId: null, phoneHash: "fixture-phone-hash", reason: "fixture",
      reportId: null, bannedBy: "fixture-staff", at: now });
    return true;
  });
  expect(await banDuringCheck.propose(owner, input(), now)).toBeNull();
  expect(await sql`select id from platform.profile_suggestion_batches`).toHaveLength(1);
  await sql`delete from platform.bans`;
  const holdDuringCheck = new ProfileSuggestions(sql, async () => { await people.setPhoneHold(e164, "recycled_number", now); return true; });
  expect(await holdDuringCheck.decide(owner, { batchId: pending.id, revision: pending.revision,
    decisions: [{ suggestionId: pending.suggestions[0]!.id, action: "accept" }] }, now)).toEqual({ kind: "denied" });
  expect(await sql`select id from network.facets`).toHaveLength(0);
});
