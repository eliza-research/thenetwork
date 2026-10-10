// Integration: the inbound inbox (platform.inbound) on its own database on the local dev cluster
// (:54339). A STOP must not wait behind an earlier message from the same sender that keeps failing
// (P3, issue 9): compliance keywords go ahead, and a handled STOP cancels the ordinary rows received
// before it. Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { SimClock } from "@thenetwork/core";
import { applySchema, devPgUp, DEV_PG_PORT } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import type { InboundMessage } from "../../blooio/src/types.ts";
import { Inbox } from "../service/inbox.ts";

const user = process.env.USER ?? "postgres";
const db = `network_inbox_${randomUUID().replaceAll("-", "")}`;
const url = `postgres://${user}@127.0.0.1:${DEV_PG_PORT}/${db}`;
const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
let admin: SQL, sql: SQL;

const msg = (from: string, id: string, text: string): InboundMessage => ({
  kind: "message", channel: "sim", messageId: id, from, to: "+12125550100", chatId: from, isGroup: false, text, mediaUrls: [], transport: "imessage" as never, receivedAt: clock.now(),
});

/** An inbox whose handler fails on the texts in `failing` and records what it handled, in order. */
function inbox(failing: Set<string>) {
  const handled: string[] = [];
  const box = new Inbox({
    sql, clock, log: () => {}, senderKey: s => `key:${s}`,
    handle: async ev => { if (failing.has(ev.text)) throw new Error("synthetic handler failure"); handled.push(ev.text); return "handled"; },
  });
  return { box, handled };
}

describe.skipIf(!pgAvailable)("inbox ordering: compliance keywords are never held back", () => {
  beforeAll(async () => {
    await devPgUp();
    admin = new SQL({ url: `postgres://${user}@127.0.0.1:${DEV_PG_PORT}/postgres`, max: 1 });
    await admin.unsafe(`create database ${db}`);
    await applySchema(url, { lockTimeout: "5s" });
    sql = new SQL({ url, max: 2 });
  }, 120_000);
  afterAll(async () => {
    await sql?.close();
    await admin?.unsafe(`drop database if exists ${db} with (force)`).catch(() => {});
    await admin?.close();
  });

  test("a STOP behind a failing row is handled at once, and the earlier row is cancelled", async () => {
    const from = "+12125557001";
    const { box, handled } = inbox(new Set(["slop Sam 25"]));
    expect(await box.receive(msg(from, "a1", "slop Sam 25"))).toBe("retry_later");
    clock.advance(1000);
    expect(await box.receive(msg(from, "a2", "STOP"))).toBe("handled");
    expect(handled).toEqual(["STOP"]);
    const [earlier] = await sql`select status, outcome, event from platform.inbound where id = 'msg:sim:a1'`;
    expect([earlier.status, earlier.outcome, earlier.event]).toEqual(["done", "cancelled_by_stop", null]);
    // A later message is a new act: handled as usual.
    clock.advance(1000);
    expect(await box.receive(msg(from, "a3", "hello again"))).toBe("handled");
    expect(handled).toEqual(["STOP", "hello again"]);
  });

  test("HELP and leave go ahead of a failing row; the failing row is not cancelled", async () => {
    const from = "+12125557002";
    const { box, handled } = inbox(new Set(["what time is dinner"]));
    expect(await box.receive(msg(from, "b1", "what time is dinner"))).toBe("retry_later");
    clock.advance(1000);
    expect(await box.receive(msg(from, "b2", "HELP"))).toBe("handled");
    clock.advance(1000);
    expect(await box.receive(msg(from, "b3", "leave slop"))).toBe("handled");
    expect(handled).toEqual(["HELP", "leave slop"]);
    const [r] = await sql`select status from platform.inbound where id = 'msg:sim:b1'`;
    expect(r.status).toBe("pending");
    // An ordinary later message still waits behind the failing one (an answer never before its question).
    clock.advance(1000);
    expect(await box.receive(msg(from, "b4", "ok thanks"))).toBe("retry_later");
    expect(handled).toEqual(["HELP", "leave slop"]);
  });
});
