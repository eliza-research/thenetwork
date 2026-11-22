// spec/seedInvitation.md, "A retry can return only the original live batch" and
// "Only the verified recipient can spend a current invitation".
import { afterAll, beforeAll, expect, test } from "vitest";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { memberInviteWindowMs } from "../../core/src/generated/memberInvitation.ts";
import type { AppId } from "../src/apps.ts";
import { InvitationUnavailable } from "../src/invite-links.ts";
import { SeedInvitations, type SeedInvitationBatchRequest } from "../src/seed-invitations.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const at = Date.UTC(2026, 10, 16, 16);
const e164 = "+12125550111";
const other = "+12125550112";
const note = "Private staff vouch, for this invitation only";
const first = {
  app: "ntwrk", issuerId: "cohort-operator", requestId: "seed-batch-a",
  entries: [{ e164, homeCity: "nyc", vouchNote: note }, { e164: other, homeCity: "sf", vouchNote: `  ${"é".repeat(250)}  ` }],
} satisfies SeedInvitationBatchRequest;
let now = at;
let url: string;
let sql: SQL;
const store = new SeedInvitations("seed-invitation-integration-fixture", () => now);

function scoped<T>(app: AppId, work: (tx: SQL) => Promise<T>): Promise<T> {
  return sql.begin(async tx => {
    await tx`set local role network_service`;
    await tx`select set_config('app.app_id', ${app}, true)`;
    return work(tx);
  });
}

if (pgAvailable) {
  beforeAll(async () => {
    url = await migratedDb("seed_invitations");
    sql = new SQL(url);
  }, 120_000);
  afterAll(async () => {
    await sql?.close();
    if (url) await dropDb(url);
  });
}

test.skipIf(!pgAvailable)("staff seed batches and verified redemption stay app-bound and erase private evidence", async () => {
  const issue = (input: SeedInvitationBatchRequest) => scoped(input.app, tx => store.issue(tx, input));
  for (const vouchNote of ["   ", "é".repeat(251)]) {
    expect(await issue({ ...first, entries: [first.entries[0]!, { ...first.entries[1]!, vouchNote }] })).toEqual({ kind: "unavailable" });
  }
  expect(await sql`select id from platform.seed_invitation_batches`).toHaveLength(0);
  const attempts = await Promise.all([issue(first), issue(first)]);
  const batch = attempts.find(result => result.kind === "issued");
  if (!batch || batch.kind !== "issued") throw new Error("Expected one original batch");
  expect(attempts.filter(result => result.kind === "issued")).toHaveLength(1);
  expect(attempts.find(result => result.kind === "replayed")).toEqual({ ...batch, kind: "replayed" });
  expect(batch.issuedAt).toBe(at);
  expect(batch.expiresAt).toBe(at + memberInviteWindowMs);
  expect(await issue({ ...first, entries: [{ ...first.entries[0]!, vouchNote: "Changed vouch" }] })).toEqual({ kind: "conflict" });
  expect(await issue({ ...first, requestId: "duplicate-phone", entries: [first.entries[0]!, { ...first.entries[0]!, e164: "212-555-0111" }] }))
    .toEqual({ kind: "unavailable" });
  expect(await sql`select id from network.members`).toHaveLength(0);
  expect(await sql`select id from platform.people`).toHaveLength(0);
  expect(await sql`select id from platform.outbound`).toHaveLength(0);

  const [link, second] = batch.links;
  if (!link || !second) throw new Error("Expected individual links");
  expect(link.token).not.toBe(second.token);
  const stored = await scoped(first.app, tx => tx<{ evidence: string; size: number }[]>`select i::text as evidence,octet_length(ciphertext) as size
    from platform.seed_invitations i where batch_id=${batch.batchId} order by ordinal`);
  expect(stored).toHaveLength(2);
  expect(stored[0]?.evidence).not.toContain(e164);
  expect(stored[0]?.evidence).not.toContain(note);
  expect(stored[0]?.evidence).not.toContain(link.token);
  expect(stored[0]?.size).toBe(Buffer.byteLength(note));
  expect(stored[1]?.size).toBe(500);
  expect(await scoped("friends", tx => tx`select batch_id from platform.seed_invitations where batch_id=${batch.batchId}`)).toHaveLength(0);
  expect(await scoped(first.app, tx => store.findRecipient(tx, { app: first.app, token: link.token, e164: other }))).toBeUndefined();
  expect(await scoped("friends", tx => store.findRecipient(tx, { app: "friends", token: link.token, e164 }))).toBeUndefined();

  const lookup = { app: first.app, token: link.token, e164 };
  const referral = await scoped(first.app, tx => store.findRecipient(tx, lookup));
  if (!referral) throw new Error("Expected a verified recipient binding");
  const join = async (tx: SQL, memberId: string) => {
    await tx`insert into network.members (app_id,id,name,home_city) values (${first.app},${memberId},'Ari','sf')`;
    await store.consume(tx, { app: first.app, referral, e164, memberId });
  };
  await expect(scoped(first.app, async tx => {
    await join(tx, "rolled-back-member");
    throw new Error("Could not persist the join");
  })).rejects.toThrow("Could not persist the join");
  expect(await scoped(first.app, tx => store.findRecipient(tx, lookup))).toEqual(referral);
  const redemptions = await Promise.allSettled(["cohort-member-a", "cohort-member-b"].map(id => scoped(first.app, tx => join(tx, id))));
  expect(redemptions.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(redemptions.find(result => result.status === "rejected")?.reason).toBeInstanceOf(InvitationUnavailable);
  const [joined] = await sql<{ id: string; home_city: string }[]>`select id,home_city from network.members`;
  expect(joined?.home_city).toBe("sf");
  expect(await sql`select member_id,batch_id,issuer_id,home_city,welcome_projected_at from platform.seed_invitation_attributions`)
    .toEqual([{ member_id: joined?.id, batch_id: batch.batchId, issuer_id: first.issuerId, home_city: "nyc", welcome_projected_at: null }]);
  expect(await sql`select recipient_hash,nonce,ciphertext,auth_tag from platform.seed_invitations where token_hash=${referral.tokenHash}`)
    .toEqual([{ recipient_hash: null, nonce: null, ciphertext: null, auth_tag: null }]);
  expect(await issue(first)).toEqual({ ...batch, kind: "replayed" });
  expect(await scoped(first.app, tx => store.findRecipient(tx, lookup))).toBeUndefined();
  expect(await scoped("friends", tx => store.decline(tx, { app: "friends", e164: other }))).toBe(0);
  expect(await scoped(first.app, tx => store.decline(tx, { app: first.app, e164: other }))).toBe(1);
  expect(await scoped(first.app, tx => store.findRecipient(tx, { app: first.app, token: second.token, e164: other }))).toBeUndefined();

  now = batch.expiresAt;
  await scoped(first.app, tx => store.purgeExpired(tx, first.app));
  expect(await sql`select token_hash from platform.seed_invitations`).toHaveLength(0);
  expect(await sql`select member_id from platform.seed_invitation_attributions`).toHaveLength(1);
  expect(await issue(first)).toEqual({ kind: "unavailable" });
});
