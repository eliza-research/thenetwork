import { expect, test } from "vitest";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import { OutboundQueue, recipientWindowHasher } from "../../../packages/blooio/src/outbound-queue.ts";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { GameSource } from "../src/sources/game.ts";
import { RealSource } from "../src/sources/real.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("persisted proposal activity follows the seeded game review lifecycle", async () => {
  // spec/observatoryRoster.md, "Reviewed offers contribute to a member's proposal activity after approval"
  const url = await testDb();
  const sql = new SQL(url);
  const game = new GameSource({ seed: 4, personas: 80, days: 14, network: "consent",
    review: "human", city: "all", pushMs: HOUR, tickMs: HOUR });
  async function compare() {
    const expected = game.state();
    await writeRows(sql, rowsFromGame(game), { truncate: true });
    const real = new RealSource({ url, service: false, pollMs: HOUR, pushMs: HOUR });
    try {
      await real.init();
      const actual = real.state();
      expect(actual.env.error).toBeUndefined();
      expect(actual.stats.proposals).toBe(expected.stats.proposals);
      expect(Object.fromEntries(actual.members.map(m => [m.id, m.counters.proposals])))
        .toEqual(Object.fromEntries(expected.members.map(m => [m.id, m.counters.proposals])));
    } finally { await real.dispose(); }
  }
  try {
    await game.init();
    const pending = () => game.state().opportunities.filter(o => o.state === "IN_REVIEW");
    for (let hour = 0; hour < 14 * 24 && pending().length < 2; hour++) {
      expect((await game.control({ type: "step", ms: HOUR })).ok).toBe(true);
    }
    const [reject, approve] = pending();
    expect(reject).toBeDefined();
    expect(approve).toBeDefined();
    expect(game.state().members.every(m => m.counters.proposals === 0)).toBe(true);
    await compare();
    expect((await game.control({ type: "review", oppId: reject!.id, decision: "reject", reason: "weak_reason", note: "Synthetic review" })).ok).toBe(true);
    expect((await game.control({ type: "review", oppId: approve!.id, decision: "approve" })).ok).toBe(true);
    expect(game.state().members.reduce((n, m) => n + m.counters.proposals, 0)).toBe(approve!.participants.length);
    await compare();
    expect((await game.control({ type: "step", ms: 2 * DAY })).ok).toBe(true);
    expect(game.state().opportunities.some(o => o.review?.decision === "expired")).toBe(true);
    await compare();
  } finally {
    await game.dispose();
    await sql.close();
    await dropTestDb();
  }
}, 60_000);

test.skipIf(!pgAvailable)("a probe replacement moves persisted proposal activity with the roster", async () => {
  // spec/observatoryRoster.md, "Reviewed offers contribute to a member's proposal activity after approval"
  // A probe replacement swaps a participant after approval: the outgoing member keeps no credit and
  // the incoming member carries it, in game mode as in persisted real mode.
  const url = await testDb();
  const sql = new SQL(url);
  const game = new GameSource({ seed: 4, personas: 80, days: 14, network: "consent",
    review: "human", city: "all", pushMs: HOUR, tickMs: HOUR });
  async function compare() {
    const expected = game.state();
    await writeRows(sql, rowsFromGame(game), { truncate: true });
    const real = new RealSource({ url, service: false, pollMs: HOUR, pushMs: HOUR });
    try {
      await real.init();
      const actual = real.state();
      expect(actual.env.error).toBeUndefined();
      expect(actual.stats.proposals).toBe(expected.stats.proposals);
      expect(Object.fromEntries(actual.members.map(m => [m.id, m.counters.proposals])))
        .toEqual(Object.fromEntries(expected.members.map(m => [m.id, m.counters.proposals])));
    } finally { await real.dispose(); }
  }
  try {
    await game.init();
    const tracked = new Map<string, string[]>();
    let replaced: { id: string; out: string; in: string } | undefined;
    for (let hour = 0; hour < 14 * 24 && !replaced; hour++) {
      expect((await game.control({ type: "step", ms: HOUR })).ok).toBe(true);
      for (const o of game.state().opportunities.filter(o => o.state === "IN_REVIEW")) {
        if (tracked.size < 5 && o.alternates.length > 0 && !tracked.has(o.id)) {
          expect((await game.control({ type: "review", oppId: o.id, decision: "approve" })).ok).toBe(true);
          tracked.set(o.id, [...o.participants]);
        }
      }
      for (const [id, before] of tracked) {
        const now = game.state().opportunities.find(o => o.id === id);
        if (!now || now.participants.join(",") === before.join(",")) continue;
        replaced = {
          id,
          out: before.find(x => !now.participants.includes(x))!,
          in: now.participants.find(x => !before.includes(x))!,
        };
      }
    }
    expect(replaced).toBeDefined();
    await compare();
  } finally {
    await game.dispose();
    await sql.close();
    await dropTestDb();
  }
}, 120_000);

test.skipIf(!pgAvailable)("an archived invalidated review keeps proposal credit only for an exactly published offer", async () => {
  const url = await testDb();
  const sql = new SQL(url);
  const real = new RealSource({ url, service: false, pollMs: HOUR, pushMs: HOUR });
  const at = Date.UTC(2026, 9, 9, 16), booking = "legacy-reviewed-offer", different = "other-ntwrk-offer";
  const text = "Would you like to join a public walk?";
  const queue = (app: "ntwrk" | "friends") => new OutboundQueue({
    sql, app, clock: new SimClock(at), line: "fixture-line", checks: { live: () => false },
    recipientWindowKey: recipientWindowHasher("fixture-recipient-window"),
    provider: { kind: "sim", async send() { throw Error("Use collected receipts"); } },
  });
  const outbound = queue("ntwrk");
  async function offer(opportunity: string, member: string, key: string, status: "pending" | "sent" | "dry_run") {
    await sql`insert into network.messages (app_id,id,member_id,opportunity_id,direction,type,body,status,ts)
      values ('ntwrk',${key},${member},${opportunity},'outbound','probe',${text},${status === "dry_run" ? status : "collected"},${new Date(at)})`;
    if (status === "dry_run") return;
    await outbound.recordCollected(sql, [{ id: key, memberId: member, to: "+12125550140", kind: "transactional", text }]);
    if (status === "sent") await outbound.collectedReceipt(sql, [key], "accepted", at + HOUR);
  }
  try {
    await sql`insert into network.opportunities(app_id,id,kind,state,source,city,objective) values
      ('ntwrk',${booking},'intro','SKIPPED','network','nyc','A public walk'),
      ('ntwrk',${different},'intro','INVITING','network','nyc','A different activity')`;
    await sql`insert into network.review_items(app_id,opportunity_id,queued_at,deadline,decision,invalidated)
      values ('ntwrk',${booking},${new Date(at)},${new Date(at + DAY)},'approve','archived review outcome')`;
    const people = ["received", "queued", "dry", "different-app", "different-opportunity"];
    for (const member of people) {
      await sql`insert into network.members(app_id,id,name,home_city,age) values ('ntwrk',${member},'Synthetic member','nyc',30)`;
      await sql`insert into network.participations(app_id,opportunity_id,member_id,role,status)
        values ('ntwrk',${booking},${member},'participant','invited')`;
    }
    await sql`insert into network.members(app_id,id,name,home_city,age) values ('ntwrk','historical','Synthetic member','nyc',30)`;
    await sql`insert into network.participations(app_id,opportunity_id,member_id,role,status)
      values ('ntwrk',${different},'historical','participant','invited')`;
    await offer(booking, "received", "real-notice", "sent");
    await offer(booking, "queued", "queued-notice", "pending");
    await offer(booking, "dry", "dry-notice", "dry_run");
    await offer(booking, "different-app", "same-contact-key", "pending");
    const otherApp = queue("friends");
    await otherApp.recordCollected(sql, [{ id: "same-contact-key", memberId: "different-app", to: "+12125550140", kind: "transactional", text }]);
    await otherApp.collectedReceipt(sql, ["same-contact-key"], "accepted", at + HOUR);
    await offer(different, "different-opportunity", "different-plan", "sent");
    await real.init();
    expect(real.state().env.error).toBeUndefined();
    expect(Object.fromEntries(real.state().members.map(m => [m.id, m.counters.proposals])))
      .toEqual({ received: 1, queued: 0, dry: 0, "different-app": 0, "different-opportunity": 0, historical: 1 });
    expect(real.state().opportunities.some(o => o.id === booking)).toBe(true);
  } finally {
    await real.dispose();
    await sql.close();
    await dropTestDb();
  }
}, 60_000);
