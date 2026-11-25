// The engine snapshot must carry the invitation tie: a member who joined through an
// invitation has invited_by on the membership, and the production service never writes
// invited_by rows into network.edges (it only writes blocked rows), so the snapshot
// builder derives the edge from members.invited_by — the same derivation the sim
// snapshot and the Observatory real reader already do. Without it the engine treats
// the inviter and the invitee as strangers (no warm tie). An invitee who has not
// accepted yet stays out, and a stored invited_by row is kept as-is, not duplicated.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { applySchema } from "../../db/dev-pg.ts";
import { loadSnapshot } from "../service/snapshot.ts";

const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const db = `network_snapshot_invited_by_${randomUUID().replaceAll("-", "")}`;
const admin = new SQL({ url: `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/postgres`, max: 1 });
const url = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/${db}`;
const START = Date.parse("2026-10-05T07:00:00Z");
const JOINED = new Date("2026-11-20T00:00:00Z");
let sql: SQL;

describe.skipIf(!pgAvailable)("snapshot invited_by edge (Postgres)", () => {
  beforeAll(async () => {
    await admin.unsafe(`create database ${db}`);
    await applySchema(url, { lockTimeout: "5s" });
    sql = new SQL({ url, max: 2 });
    const app = "ntwrk";
    await sql`insert into network.members (app_id, id, name, home_city, age, account_status, invited_by, joined_at) values
      (${app}, 's34:inviter', 'Ivy Inviter', 'nyc', 34, 'active', null, ${new Date(START)}),
      (${app}, 's34:friend', 'Finn Friend', 'nyc', 30, 'active', 's34:inviter', ${JOINED}),
      (${app}, 's34:pending', 'Bea Pending', 'nyc', 28, 'invited', 's34:inviter', null),
      (${app}, 's34:other', 'Olive Other', 'nyc', 28, 'active', null, ${new Date(START)}),
      (${app}, 's34:inviter2', 'Ivy Two', 'nyc', 34, 'active', null, ${new Date(START)}),
      (${app}, 's34:friend2', 'Finn Two', 'nyc', 30, 'active', 's34:inviter2', ${JOINED})`;
    await sql`insert into network.edges (app_id, from_id, to_id, type, strength, explicit, created_at) values
      (${app}, 's34:inviter', 's34:other', 'knows', 0.8, true, ${new Date(START)}),
      (${app}, 's34:inviter2', 's34:friend2', 'invited_by', 0.5, true, ${new Date(START)})`;
  }, 120_000);
  afterAll(async () => { await sql?.close(); await admin.unsafe(`drop database if exists ${db} with (force)`); await admin.close(); });

  test("an accepted invitee is an invited_by edge; a pending invitee is not; a stored row is not duplicated", async () => {
    const snap = await loadSnapshot(sql, JOINED.getTime(), { app: "ntwrk" });
    const keys = snap.edges.map(e => `${e.type}:${e.from}->${e.to}`).sort();
    expect(keys).toEqual([
      "invited_by:s34:inviter->s34:friend",
      "invited_by:s34:inviter2->s34:friend2",
      "knows:s34:inviter->s34:other",
    ]);
    expect(snap.edges.find(e => e.type === "invited_by" && e.to === "s34:friend")).toMatchObject({
      strength: 0.7, explicit: true, createdAt: JOINED.getTime(),
    });
    expect(snap.members.find(m => m.id === "s34:friend")?.invitedBy).toBe("s34:inviter");
    expect(snap.members.some(m => m.id === "s34:pending")).toBe(false);
  }, 120_000);
});
