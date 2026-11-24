// spec/privateHomeHelpVenue.md, "The requester supplies one address after everyone accepts this revision".
// spec/privateHomeHelpVenue.md, "A helper reads the address in a directly verified private request".
// spec/privateHomeHelpVenue.md, "Revocation, plan change and expiry end access".
import { createSecretKey } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { HOUR, SimClock } from "@thenetwork/core";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../db/dev-pg.ts";
import { BoundedHomeHelp, type HomeHelpDraft } from "../src/bounded-help.ts";
import { BoundedHomeHelpConsent, type HomeHelpConsentKey } from "../src/bounded-home-help-consent.ts";
import { BoundedHomeHelpVenue } from "../src/bounded-home-help-venue.ts";

const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const db = `network_home_help_venue_${process.pid}`;
const base = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}`;
const start = Date.UTC(2026, 9, 5, 17);
const clock = new SimClock(start);
const address = "15 Fictional Street Apt 2, Brooklyn NY 11222";
const owner = { app: "ntwrk", memberId: "requester", e164: "+12125550101" } as const;
const helper = { app: "ntwrk", memberId: "helper-a", e164: "+12125550102" } as const;
const otherHelper = { app: "ntwrk", memberId: "helper-b", e164: "+12125550103" } as const;
const helperIds = [helper.memberId, otherHelper.memberId];
const actors = [owner, helper, otherHelper];
const draft: HomeHelpDraft = {
  task: "CarryBoxes", area: "Greenpoint", alternative: "ServiceUnavailable", effortMinutes: 30,
  startsAt: start + 2 * HOUR, endsAt: start + 3 * HOUR, expiresAt: start + HOUR,
};

let sql: SQL;
const useApp = <T>(run: (tx: SQL) => Promise<T>, app: "ntwrk" | "friends" = "ntwrk") => sql.begin(async tx => {
  await tx.unsafe("set local role network_service");
  await tx`select set_config('app.app_id', ${app}, true)`;
  return run(tx);
});
const plans = new BoundedHomeHelp({
  ownerEligible: async (tx, value) => !!(await tx`select 1 from network.members where app_id=${value.app}
    and id=${value.requesterId} and not opted_out`).length,
  reviewerAuthorized: async (_tx, value) => value.app === owner.app && value.staffId === "safety-reviewer",
  rosterEligibility: async (tx, value) => {
    const ids = [value.owner.requesterId, ...value.helperIds];
    const eligible = await tx`select 1 from network.members
      where app_id=${value.owner.app} and id in ${tx(ids)} and not opted_out`;
    return { everyoneEligible: eligible.length === ids.length, singletonPreviouslyMet: false };
  },
}, () => clock.now());
const consents = new BoundedHomeHelpConsent(plans, async (_tx, app, actor) => actors.some(candidate =>
  app === candidate.app && actor.memberId === candidate.memberId && actor.e164 === candidate.e164), () => clock.now());
const makeVenue = (keyByte: number) => new BoundedHomeHelpVenue(consents.currentConsent.bind(consents),
  createSecretKey(Buffer.alloc(32, keyByte)), () => clock.now());

async function approvedPlan(id: string): Promise<HomeHelpConsentKey> {
  const plan = { app: owner.app, id };
  expect(await useApp(tx => plans.submit(tx, { ...plan, requesterId: owner.memberId, draft, detailsConfirmed: true, alternativeChecked: true })))
    .toMatchObject({ revision: 1, phase: "AwaitingHelpers" });
  expect(await useApp(tx => plans.proposeRoster(tx, { ...plan, revision: 1, helperIds }))).toMatchObject({ revision: 2, phase: "AwaitingReview" });
  const approved = { ...plan, revision: 2 };
  expect(await useApp(tx => plans.approve(tx, { ...approved, staffId: "safety-reviewer", helperIds }))).toMatchObject({ phase: "Approved" });
  expect(await useApp(tx => consents.stage(tx, approved))).toBe(true);
  return approved;
}

async function accept(key: HomeHelpConsentKey, actor: typeof actors[number]) {
  const notice = await useApp(tx => consents.pendingNotice(tx, { ...key, recipientId: actor.memberId }));
  if (!notice) throw new Error("Expected a pending home-help consent notice");
  expect(await useApp(tx => consents.recordSent(tx, notice))).toBe(true);
  expect(await useApp(tx => consents.respond(tx, { ...key, actor, decision: "accept" }))).toBe("Accepted");
}

if (pgAvailable) {
  beforeAll(async () => {
    await devPgUp();
    const admin = new SQL(`${base}/postgres`);
    try { await admin.unsafe(`create database ${db}`); } finally { await admin.close(); }
    await applySchema(`${base}/${db}`);
    sql = new SQL(`${base}/${db}`);
    for (const [index, actor] of actors.entries()) {
      const person = `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`;
      await sql`insert into platform.people (id,lowest_age) values (${person},32)`;
      await sql`insert into network.members (app_id,id,age,person_id) values (${actor.app},${actor.memberId},32,${person})`;
      await sql`insert into platform.memberships (app_id,person_id,member_id,state) values (${actor.app},${person},${actor.memberId},'active')`;
    }
  });

  afterAll(async () => {
    await sql?.close();
    const admin = new SQL(`${base}/postgres`);
    try { await admin.unsafe(`drop database if exists ${db} with (force)`); } finally { await admin.close(); }
  });
}

test.skipIf(!pgAvailable)("private addresses need exact consent and are erased on withdrawal, revocation, or expiry", async () => {
  const venue = makeVenue(1);
  const plan = await approvedPlan("00000000-0000-0000-0000-000000000010");
  await accept(plan, owner);
  await accept(plan, helper);
  const submission = { ...plan, address };
  expect(await useApp(tx => venue.submit(tx, owner, submission))).toBe(false);
  expect(await useApp(tx => venue.reveal(tx, helper, plan))).toBeUndefined();
  await accept(plan, otherHelper);
  expect(await useApp(tx => venue.submit(tx, helper, submission))).toBe(false);
  expect(await useApp(tx => venue.submit(tx, owner, { ...submission, address: "15 Fictional Street\nExtra" }))).toBe(false);
  expect(await useApp(tx => venue.submit(tx, owner, submission))).toBe(true);
  expect(await useApp(tx => venue.submit(tx, owner, submission))).toBe(false);

  const [sealed] = await useApp(tx => tx<{ payload: string; size: number }[]>`
    select v::text as payload, octet_length(ciphertext) as size
    from network.bounded_home_help_venue v where plan_id=${plan.id}`);
  expect(sealed?.payload).not.toContain(address);
  expect(sealed?.size).toBe(Buffer.byteLength(address));
  expect(await useApp(tx => tx`select * from network.bounded_home_help_venue`, "friends")).toHaveLength(0);
  expect(await useApp(tx => makeVenue(2).reveal(tx, helper, plan))).toBeUndefined();
  expect(await useApp(tx => makeVenue(1).reveal(tx, helper, plan))).toEqual({ address });
  expect(await useApp(tx => venue.reveal(tx, otherHelper, plan))).toEqual({ address });
  expect(await useApp(tx => venue.reveal(tx, owner, plan))).toBeUndefined();
  expect(await useApp(tx => venue.reveal(tx, { ...helper, memberId: "staff" }, plan))).toBeUndefined();
  expect(await useApp(tx => venue.reveal(tx, { ...helper, app: "friends" }, plan), "friends")).toBeUndefined();
  expect(await useApp(tx => venue.reveal(tx, helper, { ...plan, revision: 1 }))).toBeUndefined();
  expect(await useApp(tx => venue.revoke(tx, helper, plan))).toBe(false);

  expect(await useApp(tx => consents.respond(tx, { ...plan, actor: helper, decision: "withdraw" }))).toBe("Withdrawn");
  expect(await useApp(tx => venue.reveal(tx, otherHelper, plan))).toBeUndefined();
  expect(await useApp(tx => tx`select nonce,ciphertext,auth_tag from network.bounded_home_help_venue where plan_id=${plan.id}`))
    .toEqual([{ nonce: null, ciphertext: null, auth_tag: null }]);

  const revocable = await approvedPlan("00000000-0000-0000-0000-000000000011");
  const expiring = await approvedPlan("00000000-0000-0000-0000-000000000012");
  const copied = await approvedPlan("00000000-0000-0000-0000-000000000013");
  for (const key of [revocable, expiring, copied]) {
    for (const actor of actors) await accept(key, actor);
    expect(await useApp(tx => venue.submit(tx, owner, { ...key, address }))).toBe(true);
  }
  await sql`update network.bounded_home_help_venue target set (nonce, ciphertext, auth_tag)=(source.nonce, source.ciphertext, source.auth_tag)
    from network.bounded_home_help_venue source where target.plan_id=${copied.id} and source.plan_id=${revocable.id}`;
  expect(await useApp(tx => venue.reveal(tx, helper, copied))).toBeUndefined();
  expect(await useApp(tx => plans.close(tx, { ...copied, actor: { kind: "owner", requesterId: owner.memberId } }))).toBe(true);
  expect(await useApp(tx => tx`select 1 from network.bounded_home_help_venue where plan_id=${copied.id}`)).toHaveLength(0);
  expect(await useApp(tx => venue.revoke(tx, owner, revocable))).toBe(true);
  expect(await useApp(tx => venue.submit(tx, owner, { ...revocable, address }))).toBe(false);
  expect(await useApp(tx => venue.reveal(tx, helper, revocable))).toBeUndefined();
  expect(await useApp(tx => plans.close(tx, { ...revocable, actor: { kind: "owner", requesterId: owner.memberId } }))).toBe(true);
  expect(await useApp(tx => tx`select 1 from network.bounded_home_help_venue where plan_id=${revocable.id}`)).toHaveLength(0);

  clock.set(draft.expiresAt);
  expect(await useApp(tx => venue.reveal(tx, helper, expiring))).toBeUndefined();
  await useApp(tx => venue.purgeExpired(tx, owner.app));
  expect(await useApp(tx => tx`select 1 from network.bounded_home_help_venue`)).toHaveLength(0);
});
