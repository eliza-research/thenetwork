// spec/expectedMemberInvitation.md, "Only a confirmed expected invitation can enter the shared line queue".
// spec/expectedMemberInvitation.md, "One durably claimed dispatch may contact the recipient".
// spec/expectedMemberInvitation.md, "Only the intended verified recipient can accept".
import { afterAll, beforeAll, expect, test } from "vitest";
import { memberInviteDraftMs, memberInviteWindowMs } from "../../core/src/generated/memberInvitation.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { APPS, type AppId } from "../../platform/src/apps.ts";
import { newMemberInvitation, storeMemberInvitation } from "../../platform/src/invite-links.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { ExpectedMemberInvitations, type ExpectedInvitationDelivery } from "../service/expected-invitation-store.ts";
import { memberInvitationLink } from "../src/invitation.ts";

const owner = (app: AppId) => `${app}_present_inviter`;
const secret = "integration-fixture-expected-invitation";
const recipient = "+12125550106";
const another = "+12125550107";
const start = Date.UTC(2026, 10, 16, 16);
let now = start;
let url: string;
let sql: SQL;
const store = new ExpectedMemberInvitations(secret, () => now);
const authorize = async () => true;

function scoped<T>(app: AppId, work: (tx: SQL) => Promise<T>): Promise<T> {
  return sql.begin(async tx => {
    await tx`set local role network_service`;
    await tx`select set_config('app.app_id', ${app}, true)`;
    return work(tx);
  });
}

function body(link: string) {
  return `Ari invited you to The Network. ${link}\nReply STOP to opt out.`;
}

async function enqueue(tx: SQL, invite: ExpectedInvitationDelivery): Promise<string> {
  const text = body(invite.link);
  const at = new Date(now);
  await tx`insert into platform.outbound (id,app_id,line,to_address,kind,body,fingerprint,time_zone,status,next_attempt_at,created_at,updated_at)
    values (${invite.id},${invite.app},'test-line',${invite.to},'transactional',${text},${invite.tokenHash},'America/New_York','pending',${at},${at},${at})`;
  return text;
}

async function stage(app: AppId, to: string) {
  const { token, tokenHash } = newMemberInvitation(secret, app);
  const link = memberInvitationLink(APPS[app], token);
  const key = { app, inviterMemberId: owner(app), tokenHash, link, to };
  const result = await scoped(app, async tx => {
    await storeMemberInvitation(tx, app, key, "friend", now);
    return store.stage(tx, key);
  });
  if (!result) throw new Error("Expected a private invitation challenge");
  return { ...key, ...result };
}

function confirm(input: Awaited<ReturnType<typeof stage>>) {
  return scoped(input.app, tx => store.confirm(tx, { ...input, transportAvailable: true }, authorize, enqueue));
}

if (pgAvailable) {
  beforeAll(async () => {
    url = await migratedDb("expected_invitation");
    sql = new SQL(url);
    await sql`insert into network.members (app_id,id,name,home_city)
      values ('ntwrk',${owner("ntwrk")},'Ari','nyc'),('friends',${owner("friends")},'Ari','nyc')`;
  }, 120_000);

  afterAll(async () => {
    await sql?.close();
    if (url) await dropDb(url);
  });
}

test.skipIf(!pgAvailable)("confirmation atomically queues one bound contact across apps", async () => {
  const first = await stage("ntwrk", recipient);
  const alternate = await stage("friends", recipient);
  const [sealed] = await scoped(first.app, tx => tx<{ stored: string }[]>`select e::text as stored
    from platform.expected_member_invitations e where token_hash=${first.tokenHash}`);
  expect(sealed?.stored).toBeDefined();
  expect(sealed?.stored).not.toContain(recipient);
  expect(sealed?.stored).not.toContain(first.link);
  expect(sealed?.stored).not.toContain(first.code);
  expect(await scoped("friends", tx => tx`select 1 from platform.expected_member_invitations where token_hash=${first.tokenHash}`)).toHaveLength(0);
  expect(await scoped(first.app, tx => store.confirm(tx, { ...first, inviterMemberId: "another_owner", transportAvailable: true }, authorize, enqueue))).toBeUndefined();

  await expect(scoped(first.app, tx => store.confirm(tx, { ...first, transportAvailable: true }, authorize, async (inner, delivery) => {
    await enqueue(inner, delivery);
    throw new Error("Could not commit the queue row");
  }))).rejects.toThrow("Could not commit the queue row");
  expect(await sql`select id from platform.outbound`).toHaveLength(0);
  expect(await sql`select recipient_hash from platform.expected_invitation_contacts`).toHaveLength(0);
  expect(await confirm(first)).toBe("queued");
  const [confirmation, otherApp] = await Promise.all([confirm(first), confirm(alternate)]);
  expect(confirmation).toBe("replayed");
  expect(otherApp).toBeUndefined();
  expect(await scoped(first.app, tx => tx`select nonce,ciphertext,auth_tag from platform.expected_member_invitations where token_hash=${first.tokenHash}`))
    .toEqual([{ nonce: null, ciphertext: null, auth_tag: null }]);

  const [queued] = await sql<{ id: string }[]>`select id from platform.outbound where app_id=${first.app}`;
  if (!queued) throw new Error("Expected one outbound row");
  const delivery = { app: first.app, id: queued.id, to: first.to, body: body(first.link) };
  expect(await scoped(first.app, tx => store.currentDelivery(tx, delivery))).toMatchObject({ inviterMemberId: owner(first.app), tokenHash: first.tokenHash });
  expect(await scoped(first.app, tx => store.currentDelivery(tx, { ...delivery, body: "Modified body" }))).toBeUndefined();
  expect(await scoped(first.app, tx => store.markDeliveryAttempt(tx, delivery))).toBe(false);
  expect(await scoped(first.app, tx => store.verifyRecipient(tx, first))).toBe(false);
  expect(await scoped(first.app, tx => store.decline(tx, another))).toBe(false);
  now = start + 3_600_000;
  await scoped(first.app, async tx => {
    await tx`update platform.outbound set status='sending' where id=${delivery.id}`;
    expect(await store.markDeliveryAttempt(tx, delivery)).toBe(true);
  });
  expect(await scoped(first.app, tx => store.verifyRecipient(tx, first))).toBe(true);
  expect(await scoped(first.app, tx => store.verifyRecipient(tx, { ...first, to: another }))).toBe(false);
  await sql`update platform.outbound set status='retry_scheduled',note='recovered after the worker stopped' where id=${delivery.id}`;
  expect(await scoped(first.app, tx => store.currentDelivery(tx, delivery))).toBeUndefined();
  await sql`update platform.outbound set note='receipt lookup: never admitted' where id=${delivery.id}`;
  expect(await scoped(first.app, tx => store.currentDelivery(tx, delivery))).toMatchObject({ tokenHash: first.tokenHash });
  await scoped(first.app, async tx => {
    await tx`update platform.outbound set status='sending' where id=${delivery.id}`;
    expect(await store.markDeliveryAttempt(tx, delivery)).toBe(true);
  });

  now = start + memberInviteWindowMs;
  const blockedDuringWindow = await stage("friends", recipient);
  expect(await confirm(blockedDuringWindow)).toBeUndefined();
  expect(await scoped(first.app, tx => store.decline(tx, recipient))).toBe(true);
  now += 3_600_000;
  await scoped(first.app, tx => store.purgeExpired(tx, first.app));
  const blockedAfterDecline = await stage("friends", recipient);
  expect(await confirm(blockedAfterDecline)).toBeUndefined();
  expect(await sql`select id from platform.outbound`).toHaveLength(1);

  const expiredChallenge = await stage("friends", another);
  now += memberInviteDraftMs;
  expect(await confirm(expiredChallenge)).toBeUndefined();
  await scoped("friends", tx => store.purgeExpired(tx, "friends"));
  expect(await scoped("friends", tx => tx`select 1 from platform.expected_member_invitations where token_hash=${expiredChallenge.tokenHash}`)).toHaveLength(0);

  const competing = await Promise.all([stage("ntwrk", another), stage("friends", another)]);
  const competingOutcomes = await Promise.all(competing.map(confirm));
  expect(competingOutcomes.filter(value => value === "queued")).toHaveLength(1);
  const winner = competing[competingOutcomes.indexOf("queued")];
  if (!winner) throw new Error("Expected one owner of the shared recipient fence");
  const [competingRow] = await sql<{ id: string }[]>`select id from platform.outbound where to_address=${another}`;
  if (!competingRow) throw new Error("Expected a single queued contact across apps");
  await scoped(winner.app, async tx => {
    await tx`update platform.outbound set status='sending' where id=${competingRow.id}`;
    expect(await store.markDeliveryAttempt(tx, { ...winner, id: competingRow.id, body: body(winner.link) })).toBe(true);
  });
  expect(await scoped(winner.app, tx => store.verifyRecipient(tx, winner))).toBe(true);
  expect(await scoped("ntwrk", tx => store.decline(tx, another))).toBe(true);
  expect(await scoped(winner.app, tx => store.verifyRecipient(tx, winner))).toBe(false);
});
