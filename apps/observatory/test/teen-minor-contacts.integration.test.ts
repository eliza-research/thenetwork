import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { DAY, earliestDayKeyOf } from "@thenetwork/core";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { GameSource } from "../src/sources/game.ts";
import { RealSource } from "../src/sources/real.ts";
import { PgAudit } from "../src/staff.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 300_000;
const CONTACTS = "direction = 'outbound' and not system and status !~ '^(refused|suppressed|blocked|parked|held)'";
const TEEN_GENERATORS = "('friend_circle', 'activity_partner', 'request', 'plan', 'friends_repeat', 'crew')";
const LOGIN = `obs_friends_${process.pid}`;

describe.skipIf(!pgAvailable)("real mode: minor contacts in friends.help teen items (CONTRACT 8.4, 8.5; amendment A3)", () => {
  let url: string;
  let g: GameSource;
  let real: RealSource;
  let sql: SQL;
  let audit: PgAudit;
  let opp: string;
  let teens: [string, string];
  let pairRows: number;
  let t0: number, tLast: number;
  const count = async () => {
    await real.control({ type: "refresh" });
    return real.state().stats.scorecard!.find(m => m.key === "minors_contacted")!.value as number;
  };
  const friends = <R>(q: (tx: SQL) => Promise<R>) => sql.begin(async tx => { await tx.unsafe("set local app.app_id = 'friends'"); return q(tx); });
  const event = (at: number, type: string, payload: Record<string, unknown>) =>
    friends(tx => tx`insert into network.events (at, actor_type, actor_id, type, payload) values (${new Date(at)}, 'admin', null, ${type}, ${payload}::jsonb)`);
  const switchAudit = (at: number, on: boolean) => audit.write({
    at, actor: "admin-1@example.org", roles: ["admin"], action: "config", targetType: "config",
    targetId: "teen_intros_friends:nyc", ok: true, app: "friends", detail: { phase: "result", teenIntros: on, network: "friends:nyc" },
  });
  const switchEvent = (at: number, on: boolean) => event(at, "teen_intros_switch", { on, actor: "admin-1@example.org" });
  const message = (id: string, to: string, at: number, type: string, body: string) =>
    friends(tx => tx`insert into network.messages (id, member_id, direction, body, status, type, opportunity_id, ts)
      values (${id}, ${to}, 'outbound', ${body}, 'delivered', ${type}, ${opp}, ${new Date(at)})`);

  beforeAll(async () => {
    url = await testDb();
    g = new GameSource({ pushMs: 3_600_000, tickMs: 3_600_000, seed: 1, app: "friends" });
    await g.init();
    await g.control({ type: "step", ms: 5 * DAY });
    const now = g.state().clock.now;
    sql = new SQL(url);
    await writeRows(sql, rowsFromGame(g), { truncate: true });
    const [pick] = await sql.unsafe(`select o.id from network.opportunities o
      where o.app_id = 'friends' and o.category in ('social', 'hobby') and o.generator in ${TEEN_GENERATORS}
        and (select count(*) from network.participations p where p.app_id = o.app_id and p.opportunity_id = o.id and p.role = 'participant') = 2
        and not exists (select 1 from network.participations p where p.app_id = o.app_id and p.opportunity_id = o.id and p.role = 'alternate')
        and exists (select 1 from network.messages x where x.app_id = o.app_id and x.opportunity_id = o.id and x.direction = 'outbound' and not x.system)
        and not exists (select 1 from network.messages x where x.app_id = o.app_id and x.opportunity_id = o.id and x.direction = 'outbound' and not x.system
          and x.member_id not in (select p.member_id from network.participations p where p.app_id = o.app_id and p.opportunity_id = o.id and p.role = 'participant'))
      order by o.id limit 1`);
    expect(pick).toBeDefined();
    opp = pick.id;
    const members = await sql`select member_id from network.participations where app_id = 'friends' and opportunity_id = ${opp} and role = 'participant' order by member_id`;
    teens = [members[0]!.member_id, members[1]!.member_id];
    const [span] = await sql.unsafe(`select min(ts) as a, max(ts) as b from network.messages where app_id = 'friends' and opportunity_id = '${opp}' and ${CONTACTS}`);
    t0 = new Date(span.a).getTime(); tLast = new Date(span.b).getTime();
    const day = earliestDayKeyOf(now);
    const births = [day - 160100, day - 170300];
    for (const [i, id] of teens.entries()) {
      const person = crypto.randomUUID(), birth = births[i]!;
      await sql`insert into platform.people (id, lowest_age, birth_date, birth_lower, birth_upper, birth_youngest, birth_first_exact)
        values (${person}, ${16 + i}, ${birth}, ${birth - 1}, ${birth}, ${birth}, true)`;
      await sql`update network.members set person_id = ${person}, age = ${16 + i} where app_id = 'friends' and id = ${id}`;
    }
    const [pairs] = await sql.unsafe(`select count(*)::int as n from network.messages x where x.app_id = 'friends' and ${CONTACTS} and x.member_id in ('${teens[0]}', '${teens[1]}')
      and x.opportunity_id in (select o.id from network.opportunities o where o.app_id = 'friends' and o.category in ('social', 'hobby') and o.generator in ${TEEN_GENERATORS}
        and not exists (select 1 from network.participations p where p.app_id = o.app_id and p.opportunity_id = o.id and p.member_id not in ('${teens[0]}', '${teens[1]}'))
        and (select count(*) from network.participations p where p.app_id = o.app_id and p.opportunity_id = o.id) = 2)`);
    pairRows = pairs.n;
    expect(pairRows).toBeGreaterThan(0);
    audit = new PgAudit(url);
    vi.setSystemTime(new Date(now));
    await sql.unsafe(`drop role if exists ${LOGIN}`);
    await sql.unsafe(`create role ${LOGIN} login in role network_observatory_friends`);
    real = new RealSource({ url, app: "friends", appUrl: url.replace(/\/\/[^@]+@/, `//${LOGIN}@`), pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    await real.init();
  }, T);
  afterAll(async () => {
    try {
      await real?.dispose(); await g?.dispose(); await audit?.close(); await sql?.close(); await dropTestDb();
      const admin = new SQL(url.replace(/\/[^/]+$/, "/postgres"));
      await admin.unsafe(`drop role if exists ${LOGIN}`);
      await admin.close();
    } finally { vi.useRealTimers(); }
  });

  test("a social item of 16 and 17 from a generator that is not a teen friendship generator is counted at every contact", async () => {
    const on = await count();
    const [{ generator }] = await sql`select generator from network.opportunities where app_id = 'friends' and id = ${opp}`;
    // Contacts to replacement candidates outside the current pair already count in the baseline.
    const [pair] = await sql.unsafe(`select count(*)::int as n from network.messages
      where app_id = 'friends' and opportunity_id = '${opp}' and ${CONTACTS}
        and member_id in ('${teens[0]}', '${teens[1]}')`);
    expect(pair.n).toBeGreaterThan(0);
    await sql`update network.opportunities set generator = 'second_encounter' where app_id = 'friends' and id = ${opp}`;
    try {
      expect(await count()).toBe(on + pair.n);
    } finally {
      await sql`update network.opportunities set generator = ${generator} where app_id = 'friends' and id = ${opp}`;
    }
    expect(await count()).toBe(on);
  }, T);

  test("the console reads under the app's own login, with no unreadable teen evidence", async () => {
    await count();
    expect(real.state().env.appIsolation).toBe("rls_role");
    expect(real.state().env.error).toBeUndefined();
    expect((real.state().stats.alerts ?? []).map(a => a.key)).not.toContain("teen_evidence_unreadable");
  }, T);

  test("nothing recorded means on: the 16+17 item is not counted; the last stored stop event before the message decides; a staff audit row alone changes nothing", async () => {
    const h = 3_600_000;
    const on = await count();
    await switchAudit(t0 - 8 * h, false);
    expect(await count()).toBe(on);
    await switchEvent(t0 - 6 * h, false);
    const stopped = await count();
    expect(stopped - on).toBe(pairRows);
    await switchEvent(t0 - 5 * h, true);
    expect(await count()).toBe(on);
    await switchEvent(t0 - 4 * h, false);
    expect(await count()).toBe(stopped);
    await switchEvent(t0 - 3 * h, true);
    expect(await count()).toBe(on);
  }, T);

  test("after a stop: a notice that names nobody in the item that held the rule is not counted; a probe in it counts", async () => {
    await message("teen-notice-1", teens[0], tLast + 60_000, "cancellation", "That plan is off. Nothing else to do.");
    const on = await count();
    await switchEvent(tLast + 30_000, false);
    expect(await count()).toBe(on);
    await message("teen-probe-after-stop", teens[0], tLast + 120_000, "probe", "Want to meet up for a walk this weekend?");
    expect(await count()).toBe(on + 1);
  }, T);

  test("a minor signal makes the member not teen ready from then on; a staff doubt clear of the signal makes them ready again", async () => {
    const on = await count();
    await event(t0 - 60_000, "minor_signal", { memberId: teens[1], person: true });
    const signalled = await count();
    expect(signalled - on).toBe(pairRows + 1);
    await event(t0 - 30_000, "safety_action", { action: "clear_teen_doubt", memberId: teens[1], actor: "safety@example.org" });
    expect(await count()).toBe(on);
  }, T);

  test("a probe to a candidate of unknown age who is not a participant of the 16+17 item is counted, whatever the generator", async () => {
    const [cand] = await sql`select m.id from network.members m where m.app_id = 'friends' and m.person_id is null
      and m.id not in (select p.member_id from network.participations p where p.app_id = 'friends' and p.opportunity_id = ${opp})
      order by m.id limit 1`;
    expect(cand).toBeDefined();
    const at = t0 + 1_000;
    const before = await count();
    await message("teen-candidate-probe", cand.id, at, "probe", "Someone nearby likes the same things. Want an intro?");
    expect(await count()).toBe(before + 1);
    const [{ generator }] = await sql`select generator from network.opportunities where app_id = 'friends' and id = ${opp}`;
    await sql`update network.opportunities set generator = 'second_encounter' where app_id = 'friends' and id = ${opp}`;
    const other = await count();
    await friends(tx => tx`delete from network.messages where id = 'teen-candidate-probe'`);
    expect(other - await count()).toBe(1);
    await sql`update network.opportunities set generator = ${generator} where app_id = 'friends' and id = ${opp}`;
    expect(await count()).toBe(before);
  }, T);
});
