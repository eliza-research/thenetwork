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
import type { TurnRequest, TurnResponse } from "../../core/src/svc/contract.ts";
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

// ------------------------------------------------------------------ signed turns (/internal/turn) and the webhook path together
const turnReq = (from: string, id: string, text: string): TurnRequest => ({ messageId: id, channel: "blooio", from, to: "+12125550100", text, transport: "imessage", receivedAt: clock.now() });
const handled = (replies: { id: string; body: string; kind: "reply" | "compliance" }[] = []): TurnResponse => ({
  outcome: "handled", replies: replies.map(r => r.body), replyIds: replies.map(r => r.id), delivery: "collected", replyKind: "reply", accountEligible: true, app: "ntwrk", memberId: null, reason: "handled",
});

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

  test("a webhook STOP is handled on the same drain while a signed turn of the sender is unresolved (it waited up to 10 minutes)", async () => {
    const from = "+12125557101";
    const { box, handled: seen } = inbox(new Set());
    const r = await box.signed(turnReq(from, "s1", "hi there"), "h-s1", async () => { throw new Error("synthetic turn failure"); });
    expect(r).toEqual({ status: 409, body: { error: "turn_unresolved", retryable: false } });
    // An ordinary webhook row still waits behind the unresolved turn; the STOP after it does not, and cancels it.
    clock.advance(1000);
    expect(await box.receive(msg(from, "s2", "what's up"))).toBe("retry_later");
    clock.advance(1000);
    expect(await box.receive(msg(from, "s3", "STOP"))).toBe("handled");
    expect(seen).toEqual(["STOP"]);
    expect((await sql`select outcome from platform.inbound where id = 'msg:sim:s2'`)[0].outcome).toBe("cancelled_by_stop");
  });

  test("a STOP turn that throws before its consent change releases the claim (turn_failed, retryable) and the gateway's retry succeeds", async () => {
    const from = "+12125557102";
    const { box } = inbox(new Set());
    const first = await box.signed(turnReq(from, "k1", "STOP"), "h-k1", async () => { throw new Error("ledger down"); });
    expect(first).toEqual({ status: 409, body: { error: "turn_failed", retryable: true } });
    expect((await sql`select count(*)::int as n from platform.inbound where id = 'msg:blooio:k1'`)[0].n).toBe(0);
    const again = await box.signed(turnReq(from, "k1", "STOP"), "h-k1", async t => {
      t.consent = { state: "opted_out", scope: "all", app: null, at: clock.now() };
      return { ...handled([{ id: "sys:k1", body: "You're unsubscribed.", kind: "compliance" }]), consent: t.consent };
    });
    expect(again.status).toBe(200);
  });

  test("a STOP turn that throws after its consent change answers handled with the consent and the fixed confirmation", async () => {
    const from = "+12125557103";
    const { box } = inbox(new Set());
    const r = await box.signed(turnReq(from, "k2", "STOP"), "h-k2", async t => {
      t.app = "ntwrk";
      t.consent = { state: "opted_out", scope: "all", app: null, at: clock.now() };
      t.confirmation = { id: "sys:in:blooio:k2", body: "You're unsubscribed from every app." };
      throw new Error("a later app's unit failed");
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ outcome: "handled", replies: ["You're unsubscribed from every app."], replyIds: ["sys:in:blooio:k2"], replyKind: "compliance",
      consent: { state: "opted_out", scope: "all", app: null }, accountEligible: false });
    // The replay returns the same answer; the stored replies match what the receipt will acknowledge.
    expect((await box.signed(turnReq(from, "k2", "STOP"), "h-k2", async () => { throw new Error("must not run"); })).body).toEqual(r.body);
    const [row] = await sql`select status, replies from platform.inbound where id = 'msg:blooio:k2'`;
    expect([row.status, (row.replies as any[]).map(x => x.id)]).toEqual(["done", ["sys:in:blooio:k2"]]);
  });

  test("a retry of a turn that is still running is told to retry (turn_busy), not to give up", async () => {
    const from = "+12125557104";
    const { box } = inbox(new Set());
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const running = box.signed(turnReq(from, "c1", "tell me more"), "h-c1", async () => { await gate; return handled(); });
    await Bun.sleep(50);
    expect(await box.signed(turnReq(from, "c1", "tell me more"), "h-c1", async () => handled())).toEqual({ status: 409, body: { error: "turn_busy", retryable: true } });
    release();
    expect((await running).status).toBe(200);
    expect((await box.signed(turnReq(from, "c1", "tell me more"), "h-c1", async () => handled())).status).toBe(200);
  });

  test("a slow turn renews its lease: a later turn of the sender does not seal it after its effects, and it completes", async () => {
    const from = "+12125557105";
    const box = new Inbox({ sql, clock, log: () => {}, senderKey: s => `key:${s}`, handle: async () => "handled", leaseRenewMs: 20 });
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const slow = box.signed(turnReq(from, "l1", "find me a climbing partner"), "h-l1", async () => { await gate; return handled(); });
    await Bun.sleep(30);
    // Three minutes pass on the service clock (past the 2-minute lease) while the worker is alive and renewing.
    clock.advance(3 * 60_000);
    await Bun.sleep(80);
    expect(await box.signed(turnReq(from, "l2", "also tennis"), "h-l2", async () => handled())).toEqual({ status: 409, body: { error: "turn_busy", retryable: true } });
    release();
    expect((await slow).status).toBe(200);
    expect((await sql`select status from platform.inbound where id = 'msg:blooio:l1'`)[0].status).toBe("done");
  });

  test("work a failed turn committed outside its own transactions is undone (the one-time notice row), so a retry gets it again", async () => {
    const from = "+12125557106";
    const { box } = inbox(new Set());
    const undone: string[] = [];
    const r = await box.signed(turnReq(from, "n1", "hi, who is this?"), "h-n1", async t => {
      (t.onFail ??= []).push(async () => { undone.push("eliza_notice"); });
      throw new Error("join failed after the notice");
    });
    expect(r.status).toBe(409);
    expect(undone).toEqual(["eliza_notice"]);
  });
});
