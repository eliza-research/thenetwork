// Profile-learning state machine (docs/research/quint-findings/profile_learning.md): Postgres-backed
// cases for the suggestion store, the review parser and the delete-everything path.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { SQL } from "bun";
import { randomUUID } from "node:crypto";
import { applySchema, devPgUp, DEV_PG_PORT } from "../../observatory/db/dev-pg.ts";
import { ProfileSuggestions, type SuggestionOwner, type SourceSuggestion } from "../service/profile-suggestions.ts";
import { renderSuggestionReview, reviewSuggestionMessage } from "../service/profile-suggestion-review.ts";
import { PgPeopleStore } from "../../platform/src/pg-store.ts";

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
