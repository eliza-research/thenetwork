// spec/boundedHelp.md, "Fix the roster before review and recheck it at approval".
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { staffUser } from "../../observatory/src/staff.ts";
import type { StaffUser } from "../../observatory/src/types.ts";
import { handleBoundedHomeHelpStaff, writeBoundedHomeHelpStaffAudit, type BoundedHomeHelpStaffDeps } from "../service/bounded-home-help-staff.ts";
import { BoundedHomeHelp } from "../src/bounded-help.ts";

const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const db = `network_home_help_staff_test_${process.pid}`;
const base = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}`;
const app = "ntwrk" as const;
const at = Date.UTC(2026, 9, 5, 17);
const staff = staffUser("home-help-safety", [{ role: "safety", app }], "token");
const outside = staffUser("outside-safety", [{ role: "safety", app: "slop" }], "token");
const queue = "/safety/home-help";

describe.skipIf(!pgAvailable)("staff home-help decision (Postgres)", () => {
  let sql: SQL;
  const transaction: BoundedHomeHelpStaffDeps["transaction"] = (scope, run) => sql.begin(async tx => {
    await tx.unsafe("set local role network_service");
    await tx`select set_config('app.app_id', ${scope}, true)`;
    return run(tx);
  });

  beforeAll(async () => {
    await devPgUp();
    const admin = new SQL(`${base}/postgres`);
    try { await admin.unsafe(`create database ${db}`); } finally { await admin.close(); }
    await applySchema(`${base}/${db}`);
    sql = new SQL(`${base}/${db}`);
    for (const member of ["requester", "helper-one", "helper-two"]) {
      const person = randomUUID();
      await sql`insert into platform.people (id,lowest_age) values (${person},33)`;
      await sql`insert into network.members (app_id,id,age,person_id) values (${app},${member},33,${person})`;
      await sql`insert into platform.memberships (app_id,person_id,member_id,state) values (${app},${person},${member},'active')`;
    }
  });

  afterAll(async () => {
    await sql?.close();
    const admin = new SQL(`${base}/postgres`);
    try { await admin.unsafe(`drop database if exists ${db} with (force)`); } finally { await admin.close(); }
  });

  test("an app safety reviewer nominates and approves the exact roster in separate audited decisions", async () => {
    const store = new BoundedHomeHelp({
      ownerEligible: async () => true,
      reviewerAuthorized: async (_tx, reviewer) => reviewer.app === app && reviewer.staffId === staff.id,
      rosterEligibility: async () => ({ everyoneEligible: true, singletonPreviouslyMet: false }),
    }, () => at);
    let failAudit = false;
    const deps: BoundedHomeHelpStaffDeps = {
      store, transaction, now: () => at,
      writeAudit: async (tx, audit) => {
        await writeBoundedHomeHelpStaffAudit(tx, audit);
        if (failAudit) throw new Error("fixture audit failure");
      },
    };
    const id = randomUUID();
    const helperIds = ["helper-one", "helper-two"];
    const pending = { app, id, revision: 2, helperIds };
    const target = `${queue}/${id}`;
    const invoke = async (path: string, user: StaffUser, body?: unknown) => {
      const req = new Request(`https://staff.test${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
      const res = await handleBoundedHomeHelpStaff(deps, req, { path, app, user });
      if (!res) throw new Error("The staff route did not match");
      return res;
    };
    await transaction(app, async tx => {
      await store.submit(tx, { app, id, requesterId: "requester", detailsConfirmed: true, alternativeChecked: true,
        draft: { task: "MoveFurniture", area: "Greenpoint", alternative: "NoSuitableService", effortMinutes: 10,
          startsAt: at + 1_000_000, endsAt: at + 2_000_000, expiresAt: at + 100_000 } });
    });

    const nomination = { action: "nominate", revision: 1, helperIds };
    const approval = { action: "approve", revision: 2, helperIds };
    expect((await invoke(queue, outside)).status).toBe(403);
    expect((await invoke(target, outside, nomination)).status).toBe(403);
    expect((await invoke(target, outside, approval)).status).toBe(403);
    expect((await invoke(target, staff, { ...nomination, note: "unstructured review details" })).status).toBe(400);
    failAudit = true;
    expect((await invoke(target, staff, nomination)).status).toBe(503);
    failAudit = false;
    const nominated = await invoke(target, staff, nomination);
    expect(nominated.status).toBe(200);
    expect(await nominated.json()).toEqual({ ok: true, result: { id, revision: 2, phase: "AwaitingReview" } });
    expect(await transaction(app, tx => store.currentApproval(tx, pending))).toBeUndefined();
    expect((await invoke(target, staff, nomination)).status).toBe(409);
    const listing = await invoke(queue, staff);
    expect(listing.headers.get("cache-control")).toBe("no-store");
    expect(await listing.json()).toMatchObject({ ok: true, items: [{ id, revision: 2, helperIds }] });
    expect((await invoke(target, staff, { ...approval, note: "unstructured review details" })).status).toBe(400);
    expect((await invoke(target, staff, { ...approval, revision: 1 })).status).toBe(409);
    expect((await invoke(target, staff, { ...approval, helperIds: ["helper-one"] })).status).toBe(409);

    failAudit = true;
    expect((await invoke(target, staff, approval)).status).toBe(503);
    expect(await transaction(app, tx => store.currentApproval(tx, pending))).toBeUndefined();
    failAudit = false;
    const approved = await invoke(target, staff, approval);
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({ ok: true, result: { id, revision: 2, phase: "Approved" } });
    expect(await transaction(app, tx => store.currentApproval(tx, pending))).toMatchObject({ approval: { staffId: staff.id, at } });
    const closed = await invoke(target, staff, { action: "close", revision: 2 });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toEqual({ ok: true });
    expect(await transaction(app, tx => store.currentApproval(tx, pending))).toBeUndefined();
    const audits = await sql`select action, target_id, ok, detail from network.staff_audit where app_id=${app} order by id`;
    expect(audits.map(row => ({ ...row }))).toEqual([
      { action: "decide_bounded_home_help", target_id: id, ok: true, detail: { decision: "nominate", revision: 1 } },
      { action: "decide_bounded_home_help", target_id: id, ok: false, detail: { decision: "nominate", revision: 1 } },
      { action: "read_bounded_home_help", target_id: null, ok: true, detail: {} },
      { action: "decide_bounded_home_help", target_id: id, ok: false, detail: { decision: "approve", revision: 1 } },
      { action: "decide_bounded_home_help", target_id: id, ok: false, detail: { decision: "approve", revision: 2 } },
      { action: "decide_bounded_home_help", target_id: id, ok: true, detail: { decision: "approve", revision: 2 } },
      { action: "decide_bounded_home_help", target_id: id, ok: true, detail: { decision: "close", revision: 2 } },
    ]);
  });
});
