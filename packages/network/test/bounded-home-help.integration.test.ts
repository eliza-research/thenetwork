// spec/boundedHelp.md, "Intake keeps only structured home-help details after considering a service".
// spec/boundedHelp.md, "Fix the roster before review and recheck it at approval".
// spec/boundedHelp.md, "Closure and expiry end authority for this plan".
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { BoundedHomeHelp, type HomeHelpDraft } from "../src/bounded-help.ts";

const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const db = `network_home_help_test_${process.pid}`;
const user = process.env.USER ?? "postgres";
const base = `postgres://${user}@localhost:${DEV_PG_PORT}`;
const START = Date.UTC(2026, 9, 5, 17);
const owner = { app: "ntwrk", requesterId: "requester" } as const;
const reviewer = { app: "ntwrk", staffId: "authorized-safety-staff" } as const;
const helperPerson = "7a457330-6b92-49b3-a7bd-2156f9801fa6";
const plan = { app: "ntwrk", id: "7a457330-6b92-49b3-a7bd-2156f9801fac" } as const;

describe.skipIf(!pgAvailable)("bounded home-help intake and review (Postgres)", () => {
  let sql: SQL;
  const useApp = <T>(run: (tx: SQL) => Promise<T>, app: "ntwrk" | "friends" = "ntwrk") => sql.begin(async tx => {
    await tx.unsafe("set local role network_service");
    await tx`select set_config('app.app_id', ${app}, true)`;
    return run(tx);
  });
  const clock = new SimClock(START);
  const makeStore = (beforeRosterFacts?: () => Promise<void>) => new BoundedHomeHelp({
    ownerEligible: async (tx, value) => {
      const [row] = await tx`select id from network.members where app_id=${value.app} and id=${value.requesterId}
        and age>=18 and account_status='active' and not opted_out`;
      return !!row;
    },
    reviewerAuthorized: async (_tx, value) => value.staffId === reviewer.staffId && value.app === reviewer.app,
    rosterEligibility: async (tx, { owner, helperIds }) => {
      await beforeRosterFacts?.();
      const all = [owner.requesterId, ...helperIds];
      const rows = await tx`select id from network.members where app_id=${owner.app} and id in ${tx(all)}
        and age>=18 and account_status='active' and not opted_out`;
      const [met] = helperIds.length === 1
        ? await tx`select 1 from network.edges where app_id=${owner.app} and type='met'
          and from_id=${owner.requesterId} and to_id=${helperIds[0]!}` : [];
      return { everyoneEligible: rows.length === all.length, singletonPreviouslyMet: !!met };
    },
  }, () => clock.now());

  beforeAll(async () => {
    await devPgUp();
    const admin = new SQL(`${base}/postgres`);
    try { await admin.unsafe(`create database ${db}`); } finally { await admin.close(); }
    await applySchema(`${base}/${db}`);
    sql = new SQL({ url: `${base}/${db}`, max: 3 });
    const people = [
      { app: "ntwrk", member: "requester", age: 34, person: "7a457330-6b92-49b3-a7bd-2156f9801fa1" },
      { app: "ntwrk", member: "helper-a", age: 31, person: helperPerson },
      { app: "ntwrk", member: "helper-b", age: 29, person: "7a457330-6b92-49b3-a7bd-2156f9801fa2" },
      { app: "ntwrk", member: "helper-c", age: 28, person: "7a457330-6b92-49b3-a7bd-2156f9801fa3" },
      { app: "friends", member: "friends-helper", age: 36, person: "7a457330-6b92-49b3-a7bd-2156f9801fa4" },
    ];
    for (const person of people) {
      await sql`insert into platform.people (id,lowest_age) values (${person.person},${person.age})`;
      await sql`insert into network.members (app_id,id,age,person_id) values (${person.app},${person.member},${person.age},${person.person})`;
      await sql`insert into platform.memberships (app_id,person_id,member_id,state) values (${person.app},${person.person},${person.member},'active')`;
    }
  });

  afterAll(async () => {
    await sql?.close();
    const admin = new SQL(`${base}/postgres`);
    try { await admin.unsafe(`drop database if exists ${db} with (force)`); } finally { await admin.close(); }
  });

  test("a reviewed roster and deadline survive restart, and changes end its approval", async () => {
    let store = makeStore();
    const draft: HomeHelpDraft = {
      task: "MoveFurniture", area: "Greenpoint", alternative: "NoSuitableService", effortMinutes: 45,
      startsAt: START + 8 * HOUR, endsAt: START + 9 * HOUR, expiresAt: START + 4 * HOUR,
    };
    const request = { ...plan, ...owner, draft, detailsConfirmed: true, alternativeChecked: true };
    const helpers = { ...plan, revision: 1, helperIds: ["helper-b", "helper-a"] };
    expect(await useApp(tx => store.submit(tx, { ...request, alternativeChecked: false }))).toBeUndefined();
    expect(await useApp(tx => store.submit(tx, { ...request, draft: { ...draft, address: "17 Fictional Street" } }))).toBeUndefined();
    expect(await useApp(tx => store.submit(tx, { ...request, draft: { ...draft, area: "17 Fictional Street" } }))).toBeUndefined();
    expect(await useApp(tx => store.submit(tx, request))).toEqual({ id: plan.id, revision: 1, phase: "AwaitingHelpers" });
    expect(await useApp(tx => store.submit(tx, request))).toEqual({ id: plan.id, revision: 1, phase: "AwaitingHelpers" });
    expect(await useApp(tx => store.proposeRoster(tx, { ...helpers, helperIds: ["helper-a"] }))).toBeUndefined();
    expect(await useApp(tx => store.proposeRoster(tx, { ...helpers, helperIds: ["helper-a", "helper-a"] }))).toBeUndefined();
    expect(await useApp(tx => store.proposeRoster(tx, { ...helpers, helperIds: ["helper-a", "friends-helper"] }))).toBeUndefined();
    expect(await useApp(tx => store.proposeRoster(tx, helpers))).toEqual({ id: plan.id, revision: 2, phase: "AwaitingReview" });

    store = makeStore();
    const review = { ...reviewer, ...helpers, revision: 2 };
    expect(await useApp(tx => store.listForReview(tx, { ...reviewer, staffId: "ordinary-member" }))).toEqual([]);
    expect(await useApp(tx => store.listForReview(tx, reviewer), "friends")).toEqual([]);
    expect(await useApp(tx => store.listForReview(tx, reviewer))).toEqual([{
      ...plan, ...owner, draft, revision: 2, phase: "AwaitingReview", helperIds: ["helper-a", "helper-b"],
    }]);
    expect(await useApp(tx => store.approve(tx, { ...review, staffId: "ordinary-member" }))).toBeUndefined();
    expect(await useApp(tx => store.approve(tx, { ...review, helperIds: ["helper-a", "helper-c"] }))).toBeUndefined();
    expect(await useApp(tx => store.approve(tx, { ...review, revision: 1 }))).toBeUndefined();
    await sql`update network.members set opted_out=true where id='helper-b'`;
    expect(await useApp(tx => store.approve(tx, review))).toBeUndefined();
    await sql`update network.members set opted_out=false where id='helper-b'`;
    expect(await useApp(tx => store.approve(tx, review))).toEqual({ id: plan.id, revision: 2, phase: "Approved" });
    expect(await useApp(tx => store.currentApproval(tx, review))).toMatchObject({ approval: { staffId: reviewer.staffId, at: START } });
    await sql`update network.members set opted_out=true where id='helper-b'`;
    expect(await useApp(tx => store.currentApproval(tx, review))).toBeUndefined();
    await sql`update network.members set opted_out=false where id='helper-b'`;

    const revised = { ...request, revision: 2, draft: { ...draft, area: "Williamsburg", expiresAt: draft.expiresAt - MINUTE } };
    expect(await useApp(tx => store.readOwnerDraft(tx, { ...owner, ...plan, revision: 2 }))).toEqual(draft);
    expect(await useApp(tx => store.readOwnerDraft(tx, { ...plan, requesterId: "helper-a", revision: 2 }))).toBeUndefined();
    expect(await useApp(tx => store.readOwnerDraft(tx, { ...owner, ...plan, revision: 1 }))).toBeUndefined();
    expect(await useApp(tx => store.revise(tx, { ...revised, requesterId: "helper-a" }))).toBeUndefined();
    expect(await useApp(tx => store.revise(tx, revised))).toEqual({ id: plan.id, revision: 3, phase: "AwaitingHelpers" });
    expect(await useApp(tx => store.currentApproval(tx, review))).toBeUndefined();
    const proposals = await Promise.all([
      useApp(tx => store.proposeRoster(tx, { ...helpers, revision: 3 })),
      useApp(tx => store.proposeRoster(tx, { ...helpers, revision: 3, helperIds: ["helper-a", "helper-c"] })),
    ]);
    expect(proposals.filter(Boolean)).toEqual([{ id: plan.id, revision: 4, phase: "AwaitingReview" }]);
    const [selected] = await useApp(tx => store.listForReview(tx, reviewer));
    expect(selected?.draft).toEqual(revised.draft);
    expect(selected?.helperIds).toContain("helper-a");
    if (!selected) throw new Error("The reviewable revision was not persisted");
    const latestReview = { ...review, revision: selected.revision, helperIds: selected.helperIds };
    expect(await useApp(tx => store.approve(tx, latestReview))).toEqual({ id: plan.id, revision: 4, phase: "Approved" });
    clock.set(revised.draft.expiresAt);
    expect(await useApp(tx => store.currentApproval(tx, latestReview))).toBeUndefined();
    expect(await useApp(tx => store.expire(tx, plan))).toBe(true);
    expect(await useApp(tx => store.proposeRoster(tx, { ...helpers, revision: 4 }))).toBeUndefined();

    const second = { ...request, id: "0c50c415-a0e1-43fa-a5ec-9f16203dc976", draft: { ...draft, expiresAt: draft.startsAt } };
    await useApp(tx => store.submit(tx, second));
    await sql`insert into network.edges (app_id,from_id,to_id,type,strength) values ('ntwrk','requester','helper-a','met',1)`;
    let rosterLocked: () => void = () => {};
    let continueRoster: () => void = () => {};
    const readingRoster = new Promise<void>(resolve => { rosterLocked = resolve; });
    const resumeRoster = new Promise<void>(resolve => { continueRoster = resolve; });
    const pausedStore = makeStore(async () => { rosterLocked(); await resumeRoster; });
    const proposed = useApp(tx => pausedStore.proposeRoster(tx, { app: second.app, id: second.id, revision: 1, helperIds: ["helper-a"] }));
    await readingRoster;
    try {
      // Erasure follows this same lock order. It must wait until a roster that names the helper is visible to its trigger.
      await expect(sql.begin(async tx => {
        await tx.unsafe("set local lock_timeout = '150ms'");
        await tx`select id from platform.people where id=${helperPerson} for update`;
        await tx`update platform.memberships set state='removed' where person_id=${helperPerson}`;
      })).rejects.toMatchObject({ code: "55P03" });
    } finally { continueRoster(); }
    expect(await proposed).toEqual({ id: second.id, revision: 2, phase: "AwaitingReview" });
    await sql`update platform.memberships set state='removed' where member_id='helper-a'`;
    expect(await useApp(tx => store.listForReview(tx, reviewer))).toEqual([]);
    const stored = await sql`select id,phase,helper_ids from network.bounded_home_help order by id`;
    expect(stored.map(row => ({ ...row }))).toEqual([{ id: plan.id, phase: "Closed", helper_ids: [] }]);
  });
});
