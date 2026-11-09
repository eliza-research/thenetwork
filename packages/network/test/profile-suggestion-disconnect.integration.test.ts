/** Real SQL + service route integration; only the external Cloud revoked-owner proof is synthetic. */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { SQL } from "bun";
import { createHash, randomUUID } from "node:crypto";
import { applySchema, devPgUp, DEV_PG_PORT } from "../../observatory/db/dev-pg.ts";
import { SimClock } from "@thenetwork/core";
import { svcSign, svcVerify } from "../../core/src/svc/svc-auth.ts";
import { PROFILE_REVIEW_DISCONNECT_PATH, PROFILE_REVIEW_DISCONNECT_PROOF_PATH,
  parseProfileReviewDisconnectProofRequest, type ProfileReviewDisconnectRequest } from "../../core/src/svc/profile-review-disconnect.ts";
import { ProfileSuggestions, type SuggestionOwner, type SourceSuggestion } from "../service/profile-suggestions.ts";
import { profileReviewFactory } from "../service/profile-review-factory.ts";
import { NetworkService } from "../service/service.ts";

const now = Date.UTC(2026, 9, 20, 12), secret = "synthetic-cleanup-secret-".repeat(3);
const base = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}`;
const db = `profile_disconnect_${process.pid}`;
let sql: SQL, owner: SuggestionOwner, connectionId: string;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
beforeAll(async () => {
  await devPgUp(); const admin = new SQL(`${base}/postgres`);
  await admin.unsafe(`create database ${db}`); await admin.close(); sql = new SQL(`${base}/${db}`);
});
beforeEach(async () => {
  await applySchema(`${base}/${db}`, { reset: true });
  owner = { personId: randomUUID(), app: "friends", userId: randomUUID(), organizationId: randomUUID(), chatId: `personal:${randomUUID()}` };
  connectionId = randomUUID();
  await sql`insert into platform.people(id,lowest_age,phone_hash) values(${owner.personId},30,'disconnect-fixture-phone')`;
  await sql`insert into platform.memberships(person_id,app_id,member_id,state,first_name,profile) values(${owner.personId},'friends','member-one','active','Alex','{}')`;
  await sql`insert into network.members(id,app_id,person_id,name,age,home_city,account_status) values('member-one','friends',${owner.personId},'Alex',30,'nyc','active')`;
});
afterAll(async () => { await sql.close(); const admin = new SQL(`${base}/postgres`); await admin.unsafe(`drop database ${db}`); await admin.close(); });

async function seed(retain: boolean, accepted: boolean, createdAt = now - 2000) {
  const store = new ProfileSuggestions(sql, async () => true);
  const suggestion: SourceSuggestion = { connectionId, source: "gmail", observedAt: createdAt - 1000,
    kind: "interest", value: "I enjoy climbing", tags: ["climbing"], confidence: .8, scope: "agent_private" };
  const batch = (await store.propose(owner, { windowStart: createdAt - 5000, windowEnd: createdAt,
    timezone: "America/Los_Angeles", expiresAt: now + 60_000, retainOnDisconnect: retain,
    allowedKinds: ["interest"], suggestions: [suggestion] }, createdAt))!;
  expect(batch).not.toBeNull();
  if (accepted) expect((await store.decide(owner, { batchId: batch.id, revision: batch.revision,
    decisions: [{ suggestionId: batch.suggestions[0]!.id, action: "accept" }] }, createdAt)).kind).toBe("saved");
  return batch;
}

async function fixture() {
  const clock = new SimClock(now);
  const policy = { authority: { version: 1 as const, routeId: "disconnect-fixture", generation: "one", audience: "disconnect-fixture", realmId: "fixture-realm" },
    admitUntil: now + 120_000, drainUntil: now + 180_000 };
  let calls = 0, activeSourceCalls = 0;
  let alter: (proof: Record<string, unknown>, call: number) => void = () => {};
  let signed = true;
  const cloud = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    calls++;
    expect(new URL(req.url).pathname).toBe(PROFILE_REVIEW_DISCONNECT_PROOF_PATH);
    const raw = await req.text(), wrapper = parseProfileReviewDisconnectProofRequest(JSON.parse(raw));
    const auth = await svcVerify(secret, { method: "POST", path: PROFILE_REVIEW_DISCONNECT_PROOF_PATH, headers: req.headers, body: raw, nowS: Math.floor(clock.now()/1000) });
    if (!wrapper || !auth.ok || auth.id !== `connection-cleanup:${wrapper.request.requestNonce}`) return new Response(null, { status: 403 });
    const proof: Record<string, unknown> = { ...wrapper.request, purpose: "network-profile-review-revoked-owner-v1", requestSha256: wrapper.requestSha256,
      userId: owner.userId, organizationId: owner.organizationId, chatId: owner.chatId, connectionState: "revoked",
      revokedAt: now - 1000, issuedAt: clock.now(), expiresAt: clock.now() + 10_000 };
    alter(proof, calls);
    const body = JSON.stringify(proof);
    return new Response(body, { headers: signed ? await svcSign(secret, { method: "POST", path: PROFILE_REVIEW_DISCONNECT_PROOF_PATH,
      id: `${auth.id}:proof`, body, nowS: Math.floor(clock.now()/1000) }) : {} });
  } });
  const callbacks = profileReviewFactory({ origin: cloud.url.origin, secret, development: true, routePolicy: policy, now: () => clock.now() });
  const service = new NetworkService({ url: `${base}/${db}`, clock, notify: false, log: () => {}, networks: [{ id: "friends:nyc" }],
    env: { PLATFORM_ENV: "staging", PLATFORM_HASH_KEY: "synthetic-disconnect-hash-".repeat(2), SERVICE_TURN_SECRET: secret, NETWORK_ROUTE_AUTHORITY_POLICY: JSON.stringify(policy) },
    profileSuggestionRevokedOwner: callbacks.profileSuggestionRevokedOwner,
    profileSuggestionAuthorization: async () => { activeSourceCalls++; return false; } });
  const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: service.fetch });
  const request = (operation: ProfileReviewDisconnectRequest["operation"] = "disconnect"): ProfileReviewDisconnectRequest => ({
    version: 1, operation, app: owner.app, personId: owner.personId, memberId: "member-one", connectionId,
    revokedEventId: "revoked:one", requestNonce: randomUUID() });
  return { clock, request, get calls() { return calls; }, get activeSourceCalls() { return activeSourceCalls; },
    setAlter(fn: typeof alter) { alter = fn; }, setSigned(value: boolean) { signed = value; },
    async post(input = request(), unsigned = false) {
      const body = JSON.stringify(input);
      const response = await fetch(http.url.origin + PROFILE_REVIEW_DISCONNECT_PATH, { method: "POST", body,
        headers: unsigned ? {} : await svcSign(secret, { method: "POST", path: PROFILE_REVIEW_DISCONNECT_PATH,
          id: `connection-cleanup:${input.requestNonce}`, body, nowS: Math.floor(clock.now()/1000) }) });
      return { status: response.status, body: await response.json(), requestHash: sha(body) };
    }, async close() { http.stop(true); cloud.stop(true); await service.close(); } };
}

test("revoked cleanup uses real SQL with active-source authorization false and leaves reconnect batches untouched", async () => {
  await seed(true, true); await seed(false, true); await seed(false, false);
  const newer = await seed(false, true, now);
  const f = await fixture();
  try {
    const request = f.request(); const result = await f.post(request);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ kind: "connection_cleanup", operation: "disconnect", counts: { pending: 0, retainedAccepted: 1, linkedFacts: 1 } });
    expect(f.activeSourceCalls).toBe(0);
    expect((await sql`select status from platform.profile_suggestions where batch_id=${newer.id}`)[0].status).toBe("accepted");
    expect(await sql`select id from network.facets`).toHaveLength(2);
    const receiptRows = await sql`select request_hash from platform.profile_suggestion_connection_receipts where request_nonce=${request.requestNonce}`;
    expect(receiptRows).toHaveLength(1);
    expect(receiptRows[0].request_hash).toBe(result.requestHash);
    expect((await f.post(request)).body).toEqual(result.body);
    expect(await sql`select request_nonce from platform.profile_suggestion_connection_receipts`).toHaveLength(1);
    const readback = await f.post(f.request("readback")); expect(readback.status).toBe(200);
    expect(readback.body.counts).toEqual({ pending: 0, retainedAccepted: 1, linkedFacts: 1 });
    const deleted = await f.post(f.request("delete")); expect(deleted.status).toBe(200);
    expect(deleted.body.counts).toEqual({ pending: 0, retainedAccepted: 0, linkedFacts: 0 });
    expect(await sql`select id from network.facets`).toHaveLength(1);
    expect((await sql`select status from platform.profile_suggestions where batch_id=${newer.id}`)[0].status).toBe("accepted");
    expect(JSON.stringify(deleted.body)).not.toContain(connectionId);
  } finally { await f.close(); }
});

test("wrong owner/event/operation/request hash, unsigned proof and stale scope deny without SQL writes", async () => {
  await seed(true, true); const f = await fixture();
  try {
    expect((await f.post(f.request(), true)).status).toBe(401);
    for (const patch of [{ personId: randomUUID() }, { userId: randomUUID() }, { revokedEventId: "wrong-event" },
      { operation: "delete" }, { requestSha256: "0".repeat(64) }, { revokedAt: now + 1 }, { expiresAt: now }, { connectionState: "active" }]) {
      const firstCall = f.calls + 1;
      f.setAlter((proof, call) => { if (!("userId" in patch) || call > firstCall) Object.assign(proof, patch); });
      expect((await f.post()).status).toBe(403);
    }
    f.setAlter(() => {}); f.setSigned(false); expect((await f.post()).status).toBe(403);
    expect(await sql`select request_nonce from platform.profile_suggestion_connection_receipts`).toHaveLength(0);
    expect(await sql`select id from network.facets`).toHaveLength(1);
    expect(f.activeSourceCalls).toBe(0);
  } finally { await f.close(); }
});

test("revoked cutoff or owner expiry changing after cleanup writes rolls nonce and data back together", async () => {
  await seed(false, true); const f = await fixture();
  try {
    f.setAlter((proof, call) => { if (call === 3) proof.revokedAt = now - 500; });
    expect((await f.post()).status).toBe(403);
    expect(await sql`select request_nonce from platform.profile_suggestion_connection_receipts`).toHaveLength(0);
    expect(await sql`select id from network.facets`).toHaveLength(1);
    // A second fresh request expires during the post-write canonical owner refresh.
    f.setAlter((_proof, call) => { if (call === 6) f.clock.advance(20_000); });
    expect((await f.post()).status).toBe(403);
    expect(await sql`select request_nonce from platform.profile_suggestion_connection_receipts`).toHaveLength(0);
    expect(await sql`select id from network.facets`).toHaveLength(1);
    expect(f.activeSourceCalls).toBe(0);
  } finally { await f.close(); }
});


test("service cleanup route defaults closed without revoked-owner callback and refuses expired route", async () => {
  const service = new NetworkService({ url: `${base}/${db}`, clock: new SimClock(now), notify: false, log: () => {},
    networks: [{ id: "friends:nyc" }], env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret } });
  try {
    const body = JSON.stringify({ version: 1, operation: "readback", app: owner.app, personId: owner.personId,
      memberId: "member-one", connectionId, revokedEventId: "revoked:one", requestNonce: randomUUID() });
    expect((await service.fetch(new Request("http://fixture.invalid" + PROFILE_REVIEW_DISCONNECT_PATH, { method: "POST", body }))).status).toBe(503);
  } finally { await service.close(); }
  const f = await fixture();
  try { f.clock.advance(120_000); expect((await f.post()).status).toBe(503); expect(f.calls).toBe(0); }
  finally { await f.close(); }
});

test("a signed cleanup request with an array where a string is expected is refused before any Cloud call", async () => {
  await seed(false, true); const f = await fixture();
  try {
    // String(["friends"]) is "friends": the parser must test the type, not the text form.
    for (const patch of [{ app: [owner.app] }, { operation: ["readback"] }]) {
      const result = await f.post({ ...f.request(), ...patch } as unknown as ProfileReviewDisconnectRequest);
      expect(result.status).toBe(400);
    }
    expect(f.calls).toBe(0);
    expect(await sql`select request_nonce from platform.profile_suggestion_connection_receipts`).toHaveLength(0);
  } finally { await f.close(); }
});
