// A member who joined through an invitation must show in the inviter's
// connections in real mode, even though the production service never writes
// invited_by rows into network.edges (it only writes blocked rows): the invite
// lives on members.invited_by, and the real reader derives the edge from it.
// An invitee who has not accepted yet stays out of the inviter's list.
import { expect, test } from "vitest";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { HOUR } from "@thenetwork/core";
import { RealSource } from "../src/sources/real.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const START = Date.parse("2026-10-05T07:00:00Z");
const JOINED = new Date("2026-11-20T00:00:00Z");

test.skipIf(!pgAvailable)("real mode: an accepted invitee shows in the inviter's connections", async () => {
  const url = await testDb(), sql = new SQL(url);
  try {
    const app = "ntwrk";
    const inviter = "r13:inviter", friend = "r13:friend", pending = "r13:pending", other = "r13:other";
    await sql`insert into network.members (app_id, id, name, home_city, age, account_status, invited_by, joined_at) values
      (${app}, ${inviter}, 'Ivy Inviter', 'nyc', 34, 'active', null, ${new Date(START)}),
      (${app}, ${friend}, 'Finn Friend', 'nyc', 30, 'active', ${inviter}, ${JOINED}),
      (${app}, ${pending}, 'Bea Pending', 'nyc', 28, 'invited', ${inviter}, null),
      (${app}, ${other}, 'Olive Other', 'nyc', 28, 'active', null, ${new Date(START)})`;
    await sql`insert into network.edges (app_id, from_id, to_id, type, strength, explicit, created_at) values
      (${app}, ${inviter}, ${other}, 'knows', 0.8, true, ${new Date(START)})`;
    const real = new RealSource({ url, app, service: false, pollMs: HOUR, pushMs: HOUR });
    try {
      await real.init();
      if (real.state().env.error) throw Error(real.state().env.error);
      const detail = await real.member(inviter);
      expect(detail!.edges.map(e => `${e.type}:${e.from}->${e.to}`).sort()).toEqual([
        `invited_by:${inviter}->${friend}`,
        `knows:${inviter}->${other}`,
      ]);
      expect(detail!.edges.find(e => e.type === "invited_by" && e.to === friend)).toMatchObject({
        strength: 0.7, createdAt: JOINED.getTime(), origin: "graph",
      });
      expect((await real.member(friend))!.member.invitedBy).toBe(inviter);
      // A refresh re-derives the same edge: no duplicates, no churn.
      await real.control({ type: "refresh" });
      const again = await real.member(inviter);
      expect(again!.edges.map(e => `${e.type}:${e.from}->${e.to}`).sort()).toEqual([
        `invited_by:${inviter}->${friend}`,
        `knows:${inviter}->${other}`,
      ]);
    } finally { await real.dispose(); }
  } finally { await sql.close(); await dropTestDb(); }
}, 120_000);
