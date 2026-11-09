// SD-281: the forget path (a member leaves or deletes everything; network runtime.ts) deletes the edges
// that name the member, and the save deletes their opportunities. Real mode reads the database again on
// each poll: what the database no longer has must leave the console state and reach the clients.
// Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { RealSource } from "../src/sources/real.ts";
import type { ObsDelta } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

describe.skipIf(!pgAvailable)("real mode after the forget path (Postgres)", () => {
  let url: string;
  let sql: SQL;
  let real: RealSource;

  beforeAll(async () => {
    url = await testDb();
    sql = new SQL(url);
    await sql.begin(async tx => {
      await tx`set local app.app_id = 'slop'`;
      await tx`insert into network.members (app_id, id, name, home_city, account_status, age, joined_at) values
        ('slop', 'sf1', 'Ada Stay', 'nyc', 'active', 30, now()), ('slop', 'sf2', 'Zed Leave', 'nyc', 'active', 31, now())`;
      await tx`insert into network.edges (app_id, from_id, to_id, type, strength, explicit) values ('slop', 'sf1', 'sf2', 'met', 0.9, false)`;
      await tx`insert into network.opportunities (app_id, id, kind, state, source, city, objective) values ('slop', 'sf-o1', 'intro', 'SCHEDULED', 'engine', 'nyc', 'coffee')`;
      await tx`insert into network.participations (app_id, opportunity_id, member_id, role, status) values ('slop', 'sf-o1', 'sf1', 'participant', 'confirmed'), ('slop', 'sf-o1', 'sf2', 'participant', 'confirmed')`;
    });
    real = new RealSource({ url, app: "slop", pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    await real.init();
  }, 120_000);

  afterAll(async () => {
    await real?.dispose();
    await sql?.close();
    await dropTestDb();
  });

  test("an edge and an opportunity the forget path deleted leave the state, and clients are told", async () => {
    let st = real.state();
    expect(st.edges.map(e => [e.from, e.to])).toEqual([["sf1", "sf2"]]);
    expect(st.opportunities.map(o => o.id)).toEqual(["sf-o1"]);
    const deltas: ObsDelta[] = [];
    const off = real.subscribe(d => deltas.push(d));
    // The forget path for sf2 (runtime.ts): edges and opportunities that name them go; the member row keeps the id.
    await sql.begin(async tx => {
      await tx`set local app.app_id = 'slop'`;
      await tx`delete from network.participations where app_id = 'slop' and opportunity_id = 'sf-o1'`;
      await tx`delete from network.opportunities where app_id = 'slop' and id = 'sf-o1'`;
      await tx`delete from network.edges where app_id = 'slop' and (from_id = 'sf2' or to_id = 'sf2')`;
      await tx`update network.members set name = null, home_city = null, account_status = 'removed', age = null, joined_at = null where app_id = 'slop' and id = 'sf2'`;
    });
    expect((await real.control({ type: "refresh" })).ok).toBe(true);
    off();
    st = real.state();
    expect(st.edges).toEqual([]);
    expect(st.opportunities).toEqual([]);
    expect(JSON.stringify(st)).not.toContain("Zed");
    // Clients hold the old edge: the delta tells them to read the full state again.
    expect(deltas.at(-1)!.reset).toBe(true);
  });
});
