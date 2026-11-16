// spec/homeHelpConsent.md, "Only the current approved roster can receive a notice".
// spec/homeHelpConsent.md, "A response belongs to the recipient of a delivered notice".
// spec/homeHelpConsent.md, "Any withdrawal or invalidation stops the reviewed consent".
// spec/homeHelpConsent.md, "The requester and every member of the exact roster must accept".
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { HOUR, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { BoundedHomeHelpConsent, type HomeHelpConsentKey } from "../src/bounded-home-help-consent.ts";
import { BoundedHomeHelp, type HomeHelpDraft } from "../src/bounded-help.ts";

const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const db = `network_home_help_consent_test_${process.pid}`;
const base = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}`;
const START = Date.UTC(2026, 9, 5, 17);
const app = "ntwrk" as const;
const requester = { memberId: "requester", e164: "+12125550100" };
const helperA = { memberId: "helper-a", e164: "+12125550101" };
const helperB = { memberId: "helper-b", e164: "+12125550102" };
const actors = [requester, helperA, helperB];
const helperIds = [helperA.memberId, helperB.memberId];
const draft: HomeHelpDraft = { task: "CarryBoxes", area: "Greenpoint", alternative: "ServiceUnavailable", effortMinutes: 30,
  startsAt: START + 8 * HOUR, endsAt: START + 9 * HOUR, expiresAt: START + 4 * HOUR };

describe.skipIf(!pgAvailable)("reviewed home-help consent (Postgres)", () => {
  let sql: SQL;
  const clock = new SimClock(START);
  const scoped = <T>(run: (tx: SQL) => Promise<T>, scope: "ntwrk" | "friends" = app) => sql.begin(async tx => {
    await tx.unsafe("set local role network_service");
    await tx`select set_config('app.app_id',${scope},true)`;
    return run(tx);
  });
  const plans = new BoundedHomeHelp({
    ownerEligible: async (_tx, owner) => owner.app === app && owner.requesterId === requester.memberId,
    reviewerAuthorized: async (_tx, reviewer) => reviewer.app === app && reviewer.staffId === "safety-reviewer",
    rosterEligibility: async (tx, { owner, helperIds }) => {
      const ids = [owner.requesterId, ...helperIds];
      const active = await tx`select id from network.members where app_id=${owner.app} and id in ${tx(ids)}
        and age>=18 and account_status='active' and not opted_out`;
      return { everyoneEligible: active.length === ids.length, singletonPreviouslyMet: false };
    },
  }, () => clock.now());
  const makeStore = () => new BoundedHomeHelpConsent(plans, async (_tx, scope, actor) => scope === app
    && actors.some(known => known.memberId === actor.memberId && known.e164 === actor.e164), () => clock.now());

  beforeAll(async () => {
    await devPgUp();
    const admin = new SQL(`${base}/postgres`);
    try { await admin.unsafe(`create database ${db}`); } finally { await admin.close(); }
    await applySchema(`${base}/${db}`);
    sql = new SQL(`${base}/${db}`);
    for (const actor of actors) {
      const person = randomUUID();
      await sql`insert into platform.people (id, lowest_age) values (${person},34)`;
      await sql`insert into network.members (app_id,id,age,person_id) values (${app},${actor.memberId},34,${person})`;
      await sql`insert into platform.memberships (app_id,person_id,member_id,state) values (${app},${person},${actor.memberId},'active')`;
    }
  });

  afterAll(async () => {
    await sql?.close();
    const admin = new SQL(`${base}/postgres`);
    try { await admin.unsafe(`drop database if exists ${db} with (force)`); } finally { await admin.close(); }
  });

  async function makeApproved(): Promise<HomeHelpConsentKey> {
    const key = { app, id: randomUUID(), revision: 2 };
    await scoped(async tx => {
      const request = { ...key, requesterId: requester.memberId, detailsConfirmed: true, alternativeChecked: true, draft };
      expect(await plans.submit(tx, request)).toMatchObject({ phase: "AwaitingHelpers", revision: 1 });
      expect(await plans.proposeRoster(tx, { ...key, revision: 1, helperIds })).toMatchObject({ phase: "AwaitingReview", revision: 2 });
      expect(await plans.approve(tx, { ...key, helperIds, staffId: "safety-reviewer" })).toMatchObject({ phase: "Approved", revision: 2 });
    });
    return key;
  }

  test("the requester unlocks helper notices and only an exact delivered roster can consent", async () => {
    const key = await makeApproved();
    let store = makeStore();
    expect(await scoped(tx => store.stage(tx, { ...key, revision: 1 }))).toBe(false);
    expect(await scoped(tx => store.stage(tx, key), "friends")).toBe(false);
    expect(await scoped(tx => store.stage(tx, key))).toBe(true);
    const pending = (recipientId: string) => scoped(tx => store.pendingNotice(tx, { ...key, recipientId }));
    const accept = (actor: typeof requester, receivedAt?: number) => scoped(tx => store.respond(tx, { ...key, actor, decision: "accept", receivedAt }));
    const current = () => scoped(tx => store.currentConsent(tx, key));

    const ownerNotice = await pending(requester.memberId);
    expect(ownerNotice).toMatchObject({ ...key, role: "requester", task: "CarryBoxes", area: "Greenpoint", helperCount: 2 });
    if (!ownerNotice) throw new Error("Missing requester notice");
    expect(ownerNotice).not.toHaveProperty("helperIds");
    expect(ownerNotice).not.toHaveProperty("address");
    store = makeStore();
    expect(await scoped(tx => store.stage(tx, key))).toBe(true);
    expect(await pending(requester.memberId)).toEqual(ownerNotice);
    expect(await pending(helperA.memberId)).toBeUndefined();
    expect(await accept(requester)).toBeUndefined();
    expect(await current()).toBeUndefined();
    expect(await scoped(tx => store.recordSentById(tx, app, ownerNotice.noticeId, helperA.memberId))).toBe(false);
    expect(await scoped(tx => store.pendingNoticeById(tx, app, ownerNotice.noticeId, requester.memberId))).toEqual(ownerNotice);
    clock.set(START + 2_000);
    expect(await scoped(tx => store.recordSentById(tx, app, ownerNotice.noticeId, requester.memberId, START + 1_000))).toBe(true);
    expect(await accept(requester, START + 999)).toBeUndefined();
    expect(await accept({ ...requester, e164: helperB.e164 })).toBeUndefined();
    expect(await accept(requester, START + 1_500)).toBe("Accepted");
    expect(await scoped(tx => store.recordSent(tx, { ...ownerNotice, acceptedAt: START + 1_000 }))).toBe(true);
    const helperNotices = await Promise.all(helperIds.map(pending));
    for (const [index, notice] of helperNotices.entries()) {
      expect(notice).toMatchObject({ role: "helper", recipientId: helperIds[index] });
      if (!notice) throw new Error("Missing helper notice");
      expect(await scoped(tx => store.recordSent(tx, notice))).toBe(true);
      expect(await current()).toBeUndefined();
      expect(await accept(actors[index + 1]!)).toBe("Accepted");
    }
    expect(await current()).toMatchObject({ ...key, requesterId: requester.memberId, helperIds });
    expect(await scoped(tx => store.respond(tx, { ...key, actor: helperB, decision: "withdraw" }))).toBe("Withdrawn");
    expect(await current()).toBeUndefined();
    expect(await accept(helperB)).toBeUndefined();
    expect(await scoped(tx => store.stage(tx, key))).toBe(false);
  });

  test("declines, policy changes, revision and expiry cancel earlier consent independently", async () => {
    const store = makeStore();
    const key = await makeApproved();
    expect(await scoped(tx => store.stage(tx, key))).toBe(true);
    const ownerNotice = await scoped(tx => store.pendingNotice(tx, { ...key, recipientId: requester.memberId }));
    if (!ownerNotice) throw new Error("Missing requester notice");
    expect(await scoped(tx => store.recordSent(tx, ownerNotice))).toBe(true);
    expect(await scoped(tx => store.respond(tx, { ...key, actor: requester, decision: "decline" }))).toBe("Declined");
    expect(await scoped(tx => store.pendingNotice(tx, { ...key, recipientId: helperA.memberId }))).toBeUndefined();
    expect(await scoped(tx => store.currentConsent(tx, key))).toBeUndefined();
    expect(await scoped(tx => plans.revise(tx, { ...key, requesterId: requester.memberId, detailsConfirmed: true,
      alternativeChecked: true, draft }))).toMatchObject({ revision: 3, phase: "AwaitingHelpers" });
    expect(await sql`select 1 from network.bounded_home_help_consent where plan_id=${key.id}`).toHaveLength(0);

    const affected = await makeApproved();
    expect(await scoped(tx => store.stage(tx, affected))).toBe(true);
    await sql`update network.members set opted_out=true where app_id=${app} and id=${helperB.memberId}`;
    expect(await scoped(tx => store.pendingNotice(tx, { ...affected, recipientId: requester.memberId }))).toBeUndefined();
    await sql`update network.members set opted_out=false where app_id=${app} and id=${helperB.memberId}`;
    expect(await scoped(tx => store.stage(tx, affected))).toBe(false);

    const stopped = await makeApproved();
    expect(await scoped(tx => store.stage(tx, stopped))).toBe(true);
    await scoped(tx => store.invalidateForMember(tx, app, helperB.memberId));
    expect(await scoped(tx => store.pendingNotice(tx, { ...stopped, recipientId: requester.memberId }))).toBeUndefined();
    expect(await scoped(tx => store.stage(tx, stopped))).toBe(false);

    const expired = await makeApproved();
    expect(await scoped(tx => store.stage(tx, expired))).toBe(true);
    clock.set(draft.expiresAt);
    expect(await scoped(tx => store.pendingNotice(tx, { ...expired, recipientId: requester.memberId }))).toBeUndefined();
    expect(await scoped(tx => plans.expire(tx, expired))).toBe(true);
    expect(await sql`select 1 from network.bounded_home_help_consent where plan_id=${expired.id}`).toHaveLength(0);
  });
});
