// spec/boundedHelp.md, "Fix the roster before review and recheck it at approval".
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { HOUR } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../db/dev-pg.ts";
import { Accounts } from "../../platform/src/accounts.ts";
import { APPS } from "../../platform/src/apps.ts";
import { PgPeopleStore } from "../../platform/src/pg-store.ts";
import { createBoundedHomeHelpAuthority } from "../service/bounded-home-help-authority.ts";
import { BoundedHomeHelp, type HomeHelpDraft } from "../src/bounded-help.ts";
import type { TrustState } from "../src/trust.ts";
import { Mini, START } from "./mini.ts";

const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const db = `network_home_help_authority_test_${process.pid}`;
const base = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}`;
const app = "ntwrk" as const;
const networkId = "ntwrk:nyc";
const requester = "requester";
const helperA = "helper-a";
const helperB = "helper-b";
const plan = { app, id: randomUUID() };
const owner = { app, requesterId: requester };
const helperIds = [helperA, helperB];
const prefs = { categoriesOptIn: ["help"], formats: ["one_to_one", "small_group"], quietHours: [22, 8], maxTravelMinutes: 45, onlyWhenAsked: false };
const draft: HomeHelpDraft = {
  task: "MoveFurniture", area: "Greenpoint", alternative: "NoSuitableService", effortMinutes: 30,
  // Tuesday 2 pm in New York, after the Monday intake.
  startsAt: Date.UTC(2026, 9, 6, 18), endsAt: Date.UTC(2026, 9, 6, 19), expiresAt: START + 3 * HOUR,
};
const members = [
  { id: requester, name: "Rae", age: 34, area: "Greenpoint", phone: "+12125550100" },
  { id: helperA, name: "Ari", age: 31, area: "Greenpoint", phone: "+12125550101" },
  { id: helperB, name: "Bryn", age: 29, area: "Greenpoint", phone: "+12125550102" },
];

describe.skipIf(!pgAvailable)("canonical home-help roster authority (Postgres)", () => {
  let sql: SQL;
  const people = new Map<string, string>();
  const accountsFor = (tx: SQL) => new Accounts(new PgPeopleStore(tx), { hashKey: "home-help-authority-fixture", now: () => START, apps: id => APPS[id] });
  const authority = createBoundedHomeHelpAuthority({
    accountsFor, appInfo: id => APPS[id],
    routeOfMember: (id, city) => id === app && city === "nyc" ? networkId : undefined,
    reviewerAuthorized: async (_tx, reviewer) => reviewer.app === app && reviewer.staffId === "safety-reviewer",
    now: () => START,
  });
  const store = new BoundedHomeHelp(authority, () => START);
  const scoped = <T>(run: (tx: SQL) => Promise<T>) => sql.begin(async tx => {
    await tx.unsafe("set local role network_service");
    await tx`select set_config('app.app_id', ${app}, true)`;
    return run(tx);
  });

  beforeAll(async () => {
    await devPgUp();
    const admin = new SQL(`${base}/postgres`);
    try { await admin.unsafe(`create database ${db}`); } finally { await admin.close(); }
    await applySchema(`${base}/${db}`);
    sql = new SQL(`${base}/${db}`);
    const mini = new Mini(members, { review: "human" });
    const accounts = accountsFor(sql);
    for (const { id, name, age, area, phone } of members) {
      const person = await accounts.createPerson(phone, "otp_sms", age);
      people.set(id, person.id);
      await accounts.store.putMembership({ app, personId: person.id, memberId: id, state: "active", review: null,
        firstName: name, profile: { homeCity: "New York City", neighborhood: area }, joinedAt: START, leftAt: null });
      await accounts.recordConsent({ app, e164: phone, state: "opted_in", source: "join", at: START - HOUR });
      await sql`insert into network.members (app_id,id,person_id,name,age,home_city,home_area,prefs,joined_at)
        values (${app},${id},${person.id},${name},${age},'nyc',${area},${prefs}::jsonb,${new Date(START)})`;
      await sql`insert into network.presence (app_id,member_id,city,type,areas)
        values (${app},${id},'nyc','home',${sql.array([area], "TEXT")})`;
      if (id !== requester) await sql`insert into network.facets
        (app_id,id,member_id,kind,value,tags,privacy_scope,provenance,source,status,confidence,valid_from,observed_at)
        values (${app},${`offer:${id}`},${id},'offer','I can help move furniture',${sql.array(["moving_help"], "TEXT")},
          'matchable','said','chat','confirmed',1,${new Date(START)},${new Date(START)})`;
      for (const answer of ["Hi", "More time outdoors", "Tuesday afternoons", "Small groups are good"]) await mini.say(id, answer);
    }
    const state = mini.net.exportState();
    await sql`insert into network.network_state (id,version,state,saved_at) values (${networkId},${state.version},${state}::jsonb,${new Date(START)})
      on conflict (id) do update set version=excluded.version,state=excluded.state,saved_at=excluded.saved_at`;
  });

  afterAll(async () => {
    await sql?.close();
    const admin = new SQL(`${base}/postgres`);
    try { await admin.unsafe(`drop database if exists ${db} with (force)`); } finally { await admin.close(); }
  });

  test("two eligible helpers can be reviewed, and live policy changes withdraw approval authority", async () => {
    const request = { ...owner, ...plan, draft, detailsConfirmed: true, alternativeChecked: true };
    expect(await scoped(tx => store.submit(tx, request))).toMatchObject({ revision: 1, phase: "AwaitingHelpers" });
    expect(await scoped(tx => store.proposeRoster(tx, { ...plan, revision: 1, helperIds: [helperA] }))).toBeUndefined();
    const recordAttendance = (member: string, counterpart: string, planId: string) => sql`insert into network.capital_events
      (app_id,id,type,member_id,t,event) values (${app},${`${planId}:${member}`},'plan_attended',${member},${new Date(START - HOUR)},
      ${sql.json({ member, planId, publicVenue: true, counterparts: [counterpart] })}::jsonb)`;
    await recordAttendance(requester, helperA, "earlier-public-meeting");
    await recordAttendance(helperA, requester, "unrelated-public-meeting");
    expect(await scoped(tx => store.proposeRoster(tx, { ...plan, revision: 1, helperIds: [helperA] }))).toBeUndefined();
    await recordAttendance(helperA, requester, "earlier-public-meeting");
    expect(await scoped(tx => store.proposeRoster(tx, { ...plan, revision: 1, helperIds: [helperA] })))
      .toMatchObject({ revision: 2, phase: "AwaitingReview" });
    expect(await scoped(tx => store.proposeRoster(tx, { ...plan, revision: 2, helperIds })))
      .toMatchObject({ revision: 3, phase: "AwaitingReview" });
    const review = { ...plan, revision: 3, helperIds, staffId: "safety-reviewer" };
    expect(await scoped(tx => store.approve(tx, review))).toMatchObject({ revision: 3, phase: "Approved" });
    const current = () => scoped(tx => store.currentApproval(tx, review));
    expect(await current()).toMatchObject({ helperIds });

    await sql`insert into platform.person_blocks (from_person,to_person,origin_app,at)
      values (${people.get(helperA)},${people.get(helperB)},'friends',${new Date(START)})`;
    expect(await current()).toBeUndefined();
    await sql`delete from platform.person_blocks where from_person=${people.get(helperA)} and to_person=${people.get(helperB)}`;
    expect(await current()).toMatchObject({ helperIds });

    const accounts = accountsFor(sql);
    const phone = members[2]!.phone;
    await accounts.recordConsent({ app: null, e164: phone, state: "opted_out", source: "keyword:stop", at: START - 2 });
    expect(await current()).toBeUndefined();
    await accounts.recordConsent({ app, e164: phone, state: "opted_in", source: "keyword:start", at: START - 1 });
    expect(await current()).toMatchObject({ helperIds });

    await sql`update network.members set age=null where id=${helperB}`;
    await sql`update platform.people set lowest_age=null where id=${people.get(helperB)}`;
    expect(await current()).toBeUndefined();
    await sql`update network.members set age=${members[2]!.age} where id=${helperB}`;
    await sql`update platform.people set lowest_age=${members[2]!.age} where id=${people.get(helperB)}`;
    expect(await current()).toMatchObject({ helperIds });

    await sql`update network.members set prefs=${{ ...prefs, categoriesOptIn: ["social"] }}::jsonb where id=${helperB}`;
    expect(await current()).toBeUndefined();
    await sql`update network.members set prefs=${prefs}::jsonb where id=${helperB}`;
    expect(await current()).toMatchObject({ helperIds });

    const busy = { state: "busy", from: new Date(draft.startsAt).toISOString(), until: new Date(draft.endsAt).toISOString(), note: null };
    await sql`update network.members set participation_window=${busy}::jsonb where app_id=${app} and id=${helperB}`;
    expect(await current()).toBeUndefined();
    await sql`update network.members set participation_window=null where app_id=${app} and id=${helperB}`;
    expect(await current()).toMatchObject({ helperIds });

    const watched: TrustState = [{ id: helperB, score: 3, level: "watch", events: [], reportsFrom: [], blocksMade: [] }];
    const setTrust = (trust: TrustState) => sql`update network.network_state set state=jsonb_set(state,'{trust}',${sql.json(trust)}::jsonb)
      where id=${networkId}`;
    await setTrust(watched);
    expect(await current()).toBeUndefined();
    await setTrust([]);
    expect(await current()).toMatchObject({ helperIds });

    await sql`delete from network.facets where app_id=${app} and member_id=${helperB} and kind='offer'`;
    expect(await current()).toBeUndefined();
  });
});
