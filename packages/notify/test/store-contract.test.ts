// The same rules for the in-memory store and the Postgres store (db/schema.sql). The Postgres run
// uses its own database on the local dev cluster (:54339) and is skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { MemoryNotifyStore, type NotifyStore } from "../src/index.ts";
import { PgNotifyStore } from "../src/pg-store.ts";

const T0 = Date.UTC(2026, 9, 8, 16);
const base = { app: "friends", eventType: "plan", urgency: "normal" as const, summary: "An update." };

function contract(name: string, make: () => Promise<NotifyStore>) {
  describe(`NotifyStore contract: ${name}`, () => {
    let s: NotifyStore;
    beforeAll(async () => { s = await make(); });

    test("dedupes items and keeps the first", async () => {
      const a = await s.addItem({ ...base, personId: "c1", subjectId: "x" }, T0);
      const b = await s.addItem({ ...base, personId: "c1", subjectId: "x", summary: "other" }, T0 + 1);
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      expect(b.item.id).toBe(a.item.id);
      expect(b.item.summary).toBe("An update.");
      expect(a.item.id).toMatch(/^inb_\d+$/);
    });

    test("unseen, expiry, pending people, markSeen", async () => {
      const a = (await s.addItem({ ...base, personId: "c2", subjectId: "a" }, T0)).item;
      await s.addItem({ ...base, personId: "c2", subjectId: "b", expiresAt: T0 + 10 }, T0 + 1);
      expect((await s.unseen("c2", T0 + 5)).map(i => i.subjectId)).toEqual(["a", "b"]);
      expect((await s.unseen("c2", T0 + 10)).map(i => i.subjectId)).toEqual(["a"]);
      expect(await s.peopleWithPending(T0 + 5)).toContain("c2");
      expect(await s.markSeen("c2", "claude", T0 + 20, [a.id])).toEqual([a.id]);
      expect(await s.markSeen("c2", "claude", T0 + 21, [a.id])).toEqual([]);
      const [got] = await s.getItems([a.id]);
      expect(got).toMatchObject({ seenAt: T0 + 20, seenOn: "claude" });
    });

    test("deliveries: once per id, mark items notified, cap window, outcomes", async () => {
      const a = (await s.addItem({ ...base, personId: "c3", subjectId: "a" }, T0)).item;
      const d = { deliveryId: "ntf_c3a", personId: "c3", itemIds: [a.id], target: "imessage" as const, countsTowardCap: true, sentAt: T0 + 100 };
      expect(await s.recordDelivery(d)).toBe(true);
      expect(await s.recordDelivery(d)).toBe(false);
      expect((await s.getItems([a.id]))[0]).toMatchObject({ notifiedAt: T0 + 100, deliveryId: "ntf_c3a" });
      expect(await s.peopleWithPending(T0 + 200)).not.toContain("c3");
      expect(await s.capSendsSince("c3", T0)).toEqual([T0 + 100]);
      expect(await s.capSendsSince("c3", T0 + 101)).toEqual([]);
      expect((await s.getDelivery("ntf_c3a"))!.itemIds).toEqual([a.id]);
      expect((await s.pendingDeliveries("c3")).length).toBe(1);
      expect(await s.actOnDelivery("ntf_c3a", "imessage", T0 + 300)).toBe(true);
      expect(await s.actOnDelivery("ntf_c3a", "imessage", T0 + 301)).toBe(false);
      const b = (await s.addItem({ ...base, personId: "c3", subjectId: "b" }, T0)).item;
      await s.recordDelivery({ ...d, deliveryId: "ntf_c3b", itemIds: [b.id] });
      const expired = await s.expireDeliveries(T0 + 101, T0 + 400);
      expect(expired.map(x => x.deliveryId)).toContain("ntf_c3b");
      expect((await s.getDelivery("ntf_c3b"))!.outcome).toBe("ignored");
    });

    test("tokens: unique, first redemption kept", async () => {
      const a = (await s.addItem({ ...base, personId: "c4", subjectId: "a" }, T0)).item;
      const t = { token: "T-ABCDEF", personId: "c4", itemIds: [a.id], issuedAt: T0, expiresAt: T0 + 1000 };
      expect(await s.insertToken(t)).toBe(true);
      expect(await s.insertToken({ ...t, personId: "other" })).toBe(false);
      await s.markTokenRedeemed("T-ABCDEF", "chatgpt", T0 + 1);
      await s.markTokenRedeemed("T-ABCDEF", "claude", T0 + 2);
      expect(await s.getToken("T-ABCDEF")).toMatchObject({ personId: "c4", itemIds: [a.id], redeemedAt: T0 + 1, redeemedOn: "chatgpt" });
      expect(await s.getToken("T-ZZZZZZ")).toBeUndefined();
    });

    test("signals", async () => {
      await s.setActive("c5", "claude", true);
      await s.touch("c5", "claude", T0);
      await s.recordOutcome("c5", "claude", "ignored", T0 + 1);
      await s.recordOutcome("c5", "claude", "ignored", T0 + 2);
      expect((await s.signals("c5"))[0]).toMatchObject({ surface: "claude", active: true, ignored: 2, ignoredStreak: 2, lastUsedAt: T0 });
      await s.recordOutcome("c5", "claude", "acted", T0 + 3);
      expect((await s.signals("c5"))[0]).toMatchObject({ acted: 1, ignoredStreak: 0, lastUsedAt: T0 + 3 });
    });
  });
}

contract("memory", async () => new MemoryNotifyStore());

if (pgAvailable) {
  const USER = process.env.USER ?? "postgres";
  const db = `notify_test_${process.pid}`;
  let store: PgNotifyStore | undefined;
  const admin = async (q: string) => {
    const sql = new SQL({ url: `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`, max: 1 });
    try { await sql.unsafe(q); } finally { await sql.close(); }
  };
  contract("postgres", async () => {
    await devPgUp();
    await admin(`drop database if exists ${db} with (force)`);
    await admin(`create database ${db}`);
    store = new PgNotifyStore(`postgres://${USER}@localhost:${DEV_PG_PORT}/${db}`);
    await store.migrate();
    await store.migrate(); // idempotent
    return store;
  });
  afterAll(async () => {
    await store?.close();
    await admin(`drop database if exists ${db} with (force)`);
  });
} else {
  test.skip("NotifyStore contract: postgres (no local Postgres)", () => {});
}
