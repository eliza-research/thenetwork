import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { applySchema } from "../../db/dev-pg.ts";
import { loadSnapshot } from "../service/snapshot.ts";

const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const db = `network_snapshot_introduced_${randomUUID().replaceAll("-", "")}`;
const admin = new SQL({ url: `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/postgres`, max: 1 });
const url = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/${db}`;
const START = Date.parse("2026-10-05T07:00:00Z");
const BOOKED = new Date("2026-11-19T00:00:00Z");
let sql: SQL;

describe.skipIf(!pgAvailable)("snapshot introduced edge (Postgres)", () => {
  beforeAll(async () => {
    await admin.unsafe(`create database ${db}`);
    await applySchema(url, { lockTimeout: "5s" });
    sql = new SQL({ url, max: 2 });
    const app = "ntwrk";
    await sql`insert into network.members (app_id, id, name, home_city, age, account_status, invited_by, joined_at) values
      (${app}, 's42:a', 'Ann A', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:b', 'Ben B', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:c', 'Cat C', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:d', 'Dan D', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:e', 'Eve E', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:f', 'Fay F', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:g', 'Gia G', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:h', 'Hal H', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:i', 'Ivy I', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:j', 'Jay J', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:k', 'Kim K', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:l', 'Lee L', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:m', 'Mia M', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:n', 'Ned N', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:o', 'Ora O', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:p', 'Pam P', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:q', 'Quinn Q', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:r', 'Rae R', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:t', 'Tess T', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:u', 'Uma U', 'nyc', 30, 'removed', null, ${new Date(START)}),
      (${app}, 's42:v', 'Val V', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:w', 'Wes W', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:x', 'Xiu X', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:y', 'Yara Y', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:z', 'Zoe Z', 'nyc', 30, 'active', null, ${new Date(START)})`;
    await sql`insert into network.members (app_id, id, name, home_city, age, account_status, invited_by, joined_at) values
      (${app}, 's42:c1', 'Cleo One', 'nyc', 30, 'active', null, ${new Date(START)}),
      (${app}, 's42:c2', 'Cleo Two', 'nyc', 30, 'active', null, ${new Date(START)})`;
    await sql`insert into network.members (app_id, id, name, home_city, age, account_status, invited_by, joined_at) values
      ('friends', 's42:fa', 'Fay A', 'nyc', 30, 'active', null, ${new Date(START)}),
      ('friends', 's42:fb', 'Fay B', 'nyc', 30, 'active', null, ${new Date(START)})`;
    await sql`insert into network.opportunities (app_id, id, kind, state, city, objective, created_at) values
      (${app}, 's42:booked', 'intro', 'SCHEDULED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:booked-again', 'intro', 'SCHEDULED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:onesided', 'intro', 'PROPOSED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:stored', 'intro', 'SCHEDULED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:cancelled-told', 'intro', 'CANCELLED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:cancelled-untold', 'intro', 'CANCELLED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:skipped', 'intro', 'SKIPPED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:dropped', 'intro', 'SCHEDULED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:pending', 'intro', 'SCHEDULED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:alternate', 'intro', 'SCHEDULED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:removed', 'intro', 'SCHEDULED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:completed', 'intro', 'COMPLETED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:completed-untold', 'intro', 'COMPLETED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:group', 'group', 'SCHEDULED', 'nyc', 'coffee', ${BOOKED})`;
    await sql`insert into network.opportunities (app_id, id, kind, state, city, objective, created_at) values
      ('friends', 's42:friends-booked', 'intro', 'SCHEDULED', 'nyc', 'coffee', ${BOOKED})`;
    await sql`insert into network.participations (app_id, opportunity_id, member_id, role, status) values
      (${app}, 's42:booked', 's42:a', 'participant', 'confirmed'),
      (${app}, 's42:booked', 's42:b', 'participant', 'confirmed'),
      (${app}, 's42:booked-again', 's42:a', 'participant', 'confirmed'),
      (${app}, 's42:booked-again', 's42:b', 'participant', 'confirmed'),
      (${app}, 's42:onesided', 's42:a', 'participant', 'accepted'),
      (${app}, 's42:onesided', 's42:d', 'participant', 'pending'),
      (${app}, 's42:stored', 's42:e', 'participant', 'confirmed'),
      (${app}, 's42:stored', 's42:f', 'participant', 'confirmed'),
      (${app}, 's42:cancelled-told', 's42:g', 'participant', 'accepted'),
      (${app}, 's42:cancelled-told', 's42:h', 'participant', 'accepted'),
      (${app}, 's42:cancelled-untold', 's42:i', 'participant', 'accepted'),
      (${app}, 's42:cancelled-untold', 's42:j', 'participant', 'accepted'),
      (${app}, 's42:skipped', 's42:k', 'participant', 'accepted'),
      (${app}, 's42:skipped', 's42:l', 'participant', 'accepted'),
      (${app}, 's42:dropped', 's42:m', 'participant', 'confirmed'),
      (${app}, 's42:dropped', 's42:n', 'participant', 'dropped'),
      (${app}, 's42:pending', 's42:o', 'participant', 'pending'),
      (${app}, 's42:pending', 's42:p', 'participant', 'pending'),
      (${app}, 's42:alternate', 's42:q', 'participant', 'confirmed'),
      (${app}, 's42:alternate', 's42:r', 'alternate', 'confirmed'),
      (${app}, 's42:removed', 's42:t', 'participant', 'confirmed'),
      (${app}, 's42:removed', 's42:u', 'participant', 'confirmed'),
      (${app}, 's42:completed', 's42:v', 'participant', 'attended'),
      (${app}, 's42:completed', 's42:w', 'participant', 'no_show'),
      (${app}, 's42:completed-untold', 's42:c1', 'participant', 'accepted'),
      (${app}, 's42:completed-untold', 's42:c2', 'participant', 'no_show'),
      (${app}, 's42:group', 's42:x', 'participant', 'confirmed'),
      (${app}, 's42:group', 's42:y', 'participant', 'confirmed'),
      (${app}, 's42:group', 's42:z', 'participant', 'confirmed')`;
    await sql`insert into network.participations (app_id, opportunity_id, member_id, role, status) values
      ('friends', 's42:friends-booked', 's42:fa', 'participant', 'confirmed'),
      ('friends', 's42:friends-booked', 's42:fb', 'participant', 'confirmed')`;
    await sql`insert into network.edges (app_id, from_id, to_id, type, strength, explicit, created_at) values
      (${app}, 's42:a', 's42:c', 'knows', 0.8, true, ${new Date(START)}),
      (${app}, 's42:e', 's42:f', 'introduced', 0.5, true, ${new Date(START)})`;
    const told = (id: string, bookedTold: string[]) => ({ id, bookedTold });
    const saved = { opps: [
      told("s42:booked", ["s42:a", "s42:b"]),
      told("s42:booked-again", ["s42:a", "s42:b"]),
      told("s42:onesided", ["s42:a", "s42:d"]),
      told("s42:stored", ["s42:e", "s42:f"]),
      told("s42:cancelled-told", ["s42:g", "s42:h"]),
      told("s42:cancelled-untold", []),
      told("s42:skipped", ["s42:k", "s42:l"]),
      told("s42:dropped", ["s42:m", "s42:n"]),
      told("s42:pending", ["s42:o", "s42:p"]),
      told("s42:alternate", ["s42:q", "s42:r"]),
      told("s42:removed", ["s42:t", "s42:u"]),
      told("s42:completed", ["s42:v", "s42:w"]),
      told("s42:completed-untold", []),
      told("s42:group", ["s42:x", "s42:y", "s42:z"]),
    ] };
    await sql`insert into network.network_state (id, version, state, saved_at) values
      ('ntwrk:nyc', 1, ${saved}::jsonb, ${new Date(START)})`;
  }, 120_000);
  afterAll(async () => { await sql?.close(); await admin.unsafe(`drop database if exists ${db} with (force)`); await admin.close(); });

  test("booked-plan ties only: state, status, role, keep, dedup, stored row, and bookedTold members", async () => {
    const snap = await loadSnapshot(sql, BOOKED.getTime(), { app: "ntwrk" });
    const keys = snap.edges.map(e => `${e.type}:${e.from}->${e.to}`).sort();
    expect(keys).toEqual([
      "introduced:s42:a->s42:b",
      "introduced:s42:e->s42:f",
      "introduced:s42:g->s42:h",
      "introduced:s42:v->s42:w",
      "introduced:s42:x->s42:y",
      "introduced:s42:x->s42:z",
      "introduced:s42:y->s42:z",
      "knows:s42:a->s42:c",
    ]);
    expect(snap.edges.find(e => e.type === "introduced" && e.from === "s42:a")).toMatchObject({
      strength: 0.3, explicit: false, createdAt: BOOKED.getTime(),
    });
    expect(snap.edges.find(e => e.type === "introduced" && e.from === "s42:e")).toMatchObject({ strength: 0.5 });
  }, 120_000);
});
