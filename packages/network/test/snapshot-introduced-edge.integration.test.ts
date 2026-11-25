// The engine snapshot must carry the introduction tie: when both sides accept an
// introduction and it is booked, the Network has introduced the pair (the learned
// introduced edge of the Observatory projector, strength 0.3), and the network
// ontology counts introduced as warm. The production service never writes
// introduced rows into network.edges (it only writes blocked rows), so the
// snapshot builder derives the edge from the booked opportunity's accepted
// participations. Without it the engine treats an introduced pair as strangers
// (no warm tie, no warm path through either side). A one-sided acceptance stays
// out, and a stored introduced row is kept as-is, not duplicated.
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
      (${app}, 's42:f', 'Fay F', 'nyc', 30, 'active', null, ${new Date(START)})`;
    await sql`insert into network.opportunities (app_id, id, kind, state, city, objective, created_at) values
      (${app}, 's42:booked', 'intro', 'SCHEDULED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:onesided', 'intro', 'PROPOSED', 'nyc', 'coffee', ${BOOKED}),
      (${app}, 's42:stored', 'intro', 'SCHEDULED', 'nyc', 'coffee', ${BOOKED})`;
    await sql`insert into network.participations (app_id, opportunity_id, member_id, role, status) values
      (${app}, 's42:booked', 's42:a', 'participant', 'confirmed'),
      (${app}, 's42:booked', 's42:b', 'participant', 'confirmed'),
      (${app}, 's42:onesided', 's42:a', 'participant', 'accepted'),
      (${app}, 's42:onesided', 's42:d', 'participant', 'pending'),
      (${app}, 's42:stored', 's42:e', 'participant', 'confirmed'),
      (${app}, 's42:stored', 's42:f', 'participant', 'confirmed')`;
    await sql`insert into network.edges (app_id, from_id, to_id, type, strength, explicit, created_at) values
      (${app}, 's42:a', 's42:c', 'knows', 0.8, true, ${new Date(START)}),
      (${app}, 's42:e', 's42:f', 'introduced', 0.5, true, ${new Date(START)})`;
  }, 120_000);
  afterAll(async () => { await sql?.close(); await admin.unsafe(`drop database if exists ${db} with (force)`); await admin.close(); });

  test("a booked pair is an introduced edge; a one-sided pair is not; a stored row is not duplicated", async () => {
    const snap = await loadSnapshot(sql, BOOKED.getTime(), { app: "ntwrk" });
    const keys = snap.edges.map(e => `${e.type}:${e.from}->${e.to}`).sort();
    expect(keys).toEqual([
      "introduced:s42:a->s42:b",
      "introduced:s42:e->s42:f",
      "knows:s42:a->s42:c",
    ]);
    expect(snap.edges.find(e => e.type === "introduced" && e.from === "s42:a")).toMatchObject({
      strength: 0.3, explicit: false, createdAt: BOOKED.getTime(),
    });
    expect(snap.edges.find(e => e.type === "introduced" && e.from === "s42:e")).toMatchObject({ strength: 0.5 });
  }, 120_000);
});
