import { describe, expect, test } from "bun:test";
import { HOUR, MINUTE } from "../../../packages/core/src/clock.ts";
import { IdempotencyConflictError } from "../src/outbound-queue.ts";
import { ChannelSendError, type ChannelAdapter, type SendRequest } from "../src/types.ts";
import { world } from "./helpers.ts";

const ALICE = "+15551110001";
const LA = "America/Los_Angeles";
const consentAll = (w: ReturnType<typeof world>, ...who: string[]) => who.forEach((a) => w.consent.record("sim", a, "opted_in", "invite_acceptance"));
/** The person just texted us, so a "reply" to them is a real reply. */
const engaged = (w: ReturnType<typeof world>, ...who: string[]) => who.forEach((a) => w.queue.onRecipientEngaged("sim", a));

describe("idempotent outbound", () => {
  test("same key twice delivers once", async () => {
    const w = world();
    consentAll(w, ALICE);
    const a = w.queue.enqueue({ idempotencyKey: "brief-1:alice", channel: "sim", to: ALICE, text: "hi", kind: "proactive", timeZone: LA });
    const b = w.queue.enqueue({ idempotencyKey: "brief-1:alice", channel: "sim", to: ALICE, text: "hi", kind: "proactive", timeZone: LA });
    expect(b.deduped).toBe(true);
    expect(b.record).toBe(a.record);
    await w.queue.drain();
    await w.queue.drain();
    expect(w.bus.inbox.get(ALICE)?.length).toBe(1);
    expect(w.bus.sendCalls).toBe(1);
  });

  test("same key with a different payload is a conflict", () => {
    const w = world();
    w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: ALICE, text: "a", kind: "reply" });
    expect(() => w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: ALICE, text: "b", kind: "reply" })).toThrow(IdempotencyConflictError);
  });

  test("a retry after a lost response reuses the provider key: no double text", async () => {
    const w = world();
    engaged(w, ALICE);
    // Adapter that delivers but then 'loses' the response on the first attempt.
    const sim = w.bus.adapter();
    let first = true;
    const flaky: ChannelAdapter = {
      kind: "sim",
      async send(req: SendRequest) {
        const r = await sim.send(req);
        if (first) { first = false; throw new ChannelSendError("socket hang up", "retryable"); }
        return r;
      },
    };
    w.queue.o.adapters.sim = flaky;
    const { record } = w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: ALICE, text: "hi", kind: "reply" });
    await w.queue.drain();
    expect(record.status).toBe("retry_scheduled");
    w.clock.advance(31_000);
    await w.queue.drain();
    expect(record.status).toBe("sent");
    expect(w.bus.inbox.get(ALICE)?.length).toBe(1); // delivered once despite two attempts
    expect(record.attempts).toBe(2);
  });

  test("delivery and read receipts advance status; out-of-order receipts never regress", async () => {
    const w = world();
    engaged(w, ALICE);
    const { record } = w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: ALICE, text: "hi", kind: "reply" });
    await w.queue.drain();
    await w.bus.readAll(ALICE); // read arrives before delivered
    await w.bus.flush(); // late 'delivered'
    expect(record.status).toBe("read");
    expect(record.readAt).toBeDefined();
    expect(record.deliveredAt).toBeDefined();
  });
});

describe("policy at dispatch time", () => {
  test("STOP received while a proactive message waits wins", async () => {
    const w = world();
    consentAll(w, ALICE);
    w.clock.set(Date.parse("2026-10-06T05:00:00Z")); // 22:00 PDT, quiet
    const { record } = w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: ALICE, text: "saturday hike?", kind: "proactive", timeZone: LA });
    await w.queue.drain();
    expect(record.status).toBe("deferred_quiet_hours");
    await w.bus.inbound(ALICE, "STOP");
    expect(w.bus.last(ALICE)?.text).toContain("unsubscribed"); // compliance reply goes out despite quiet hours
    w.clock.set(Date.parse("2026-10-06T16:00:00Z"));
    await w.queue.drain();
    expect(record.status).toBe("suppressed_opt_out");
    expect(w.bus.inbox.get(ALICE)?.length).toBe(1);
  });

  test("proactive without recorded consent is suppressed; replies to the member's message are not", async () => {
    const w = world();
    engaged(w, ALICE);
    const p = w.queue.enqueue({ idempotencyKey: "p", channel: "sim", to: ALICE, text: "x", kind: "proactive", timeZone: LA }).record;
    const r = w.queue.enqueue({ idempotencyKey: "r", channel: "sim", to: ALICE, text: "y", kind: "reply" }).record;
    await w.queue.drain();
    expect(p.status).toBe("suppressed_no_consent");
    expect(r.status).toBe("sent");
  });

  test("quiet hours defer proactive to 09:00 local per recipient zone; replies go now", async () => {
    const w = world();
    const NY = "+15552220002";
    consentAll(w, ALICE, NY);
    w.clock.set(Date.parse("2026-10-06T02:00:00Z")); // 19:00 PDT, 22:00 EDT
    const la = w.queue.enqueue({ idempotencyKey: "la", channel: "sim", to: ALICE, text: "x", kind: "proactive", timeZone: LA }).record;
    const ny = w.queue.enqueue({ idempotencyKey: "ny", channel: "sim", to: NY, text: "x", kind: "proactive", timeZone: "America/New_York" }).record;
    engaged(w, NY);
    const reply = w.queue.enqueue({ idempotencyKey: "reply", channel: "sim", to: NY, text: "sure!", kind: "reply" }).record;
    await w.queue.drain();
    expect(la.status).toBe("sent");
    expect(ny.status).toBe("deferred_quiet_hours");
    expect(new Date(ny.nextAttemptAt).toISOString()).toBe("2026-10-06T13:00:00.000Z");
    expect(reply.status).toBe("sent");
    w.clock.set(ny.nextAttemptAt);
    await w.queue.drain();
    expect(ny.status).toBe("sent");
  });

  test("proactive/transactional without a time zone is rejected at enqueue", () => {
    const w = world();
    expect(() => w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: ALICE, text: "x", kind: "proactive" })).toThrow("timeZone");
  });

  test("Blooio conversation limit holds the message until the recipient engages (no timer retries)", async () => {
    const w = world();
    engaged(w, ALICE);
    w.bus.failNext(ALICE, new ChannelSendError("limit", "await_recipient", 429, "conversation_awaiting_reply"));
    const { record } = w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: ALICE, text: "4th opener", kind: "reply" });
    await w.queue.drain();
    expect(record.status).toBe("held_awaiting_reply");
    w.clock.advance(2 * HOUR);
    await w.queue.drain();
    expect(record.status).toBe("held_awaiting_reply");
    expect(w.bus.sendCalls).toBe(1);
    await w.bus.inbound(ALICE, "hey!");
    await w.queue.drain();
    expect(record.status).toBe("sent");
  });

  test("5xx retries with exponential backoff then fails after maxAttempts", async () => {
    const w = world({ maxAttempts: 3 });
    engaged(w, ALICE);
    w.bus.failNext(ALICE, new ChannelSendError("503", "retryable", 503), 5);
    const { record } = w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: ALICE, text: "x", kind: "reply" });
    await w.queue.drain();
    const t1 = record.nextAttemptAt - w.clock.now();
    w.clock.advance(t1);
    await w.queue.drain();
    const t2 = record.nextAttemptAt - w.clock.now();
    expect(t2).toBe(2 * t1);
    w.clock.advance(t2);
    await w.queue.drain();
    expect(record.status).toBe("failed");
    expect(record.attempts).toBe(3);
  });

  test("terminal failure falls back to SMS adapter (same opt-out rules)", async () => {
    const smsSent: SendRequest[] = [];
    const sms: ChannelAdapter = { kind: "twilio", async send(r) { smsSent.push(r); return { providerMessageId: `tw_${smsSent.length}`, status: "sent", transport: "sms" }; } };
    const w = world({ extraAdapters: { twilio: sms } });
    engaged(w, ALICE);
    w.bus.failNext(ALICE, new ChannelSendError("not reachable on iMessage", "invalid", 422, "recipient_unreachable"));
    const { record } = w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: ALICE, text: "x", kind: "reply", fallbackChannel: "twilio" });
    await w.queue.drain();
    expect(record.status).toBe("fell_back");
    await w.queue.drain();
    expect(smsSent.length).toBe(1);
    expect(smsSent[0].idempotencyKey).toBe("tn:k:fallback:twilio");
  });

  test("a policy block (line safety) never falls back to SMS (plugin-prototypes-16)", async () => {
    const smsSent: SendRequest[] = [];
    const sms: ChannelAdapter = { kind: "twilio", async send(r) { smsSent.push(r); return { providerMessageId: `tw_${smsSent.length}`, status: "sent", transport: "sms" }; } };
    const w = world({ extraAdapters: { twilio: sms } });
    consentAll(w, ALICE);
    w.bus.failNext(ALICE, new ChannelSendError("banned line", "blocked", 403, "safety_reply_only"));
    const { record } = w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: ALICE, text: "x", kind: "proactive", timeZone: LA, fallbackChannel: "twilio" });
    await w.queue.drain();
    await w.queue.drain();
    expect(record.status).toBe("blocked");
    expect(smsSent.length).toBe(0);
    expect(w.alerts).toEqual(["k:safety_reply_only"]);
  });

  test("failed delivery receipt also triggers fallback", async () => {
    const smsSent: SendRequest[] = [];
    const sms: ChannelAdapter = { kind: "twilio", async send(r) { smsSent.push(r); return { providerMessageId: "tw_1", status: "sent" }; } };
    const w = world({ extraAdapters: { twilio: sms } });
    engaged(w, ALICE);
    const { record } = w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: ALICE, text: "x", kind: "reply", fallbackChannel: "twilio" });
    await w.queue.drain();
    await w.gateway.handle({ kind: "status", channel: "sim", eventId: "e1", providerMessageId: record.providerMessageId!, status: "failed", errorCode: "recipient_unreachable", at: w.clock.now() });
    expect(record.status).toBe("fell_back");
    await w.queue.drain();
    expect(smsSent.length).toBe(1);
  });

  test("per-recipient hourly cap and per-line new-conversation cap", async () => {
    // New-chat cap counts first contacts the line starts; ALICE texted first, so she is not one.
    const w = world({ perRecipientPerHour: 2, newChatsPerLinePerDay: 2 });
    engaged(w, ALICE);
    for (let i = 0; i < 3; i++) w.queue.enqueue({ idempotencyKey: `r${i}`, channel: "sim", to: ALICE, text: `m${i}`, kind: "reply" });
    await w.queue.drain();
    expect(w.bus.inbox.get(ALICE)?.length).toBe(2);
    expect(w.queue.get("r2")?.status).toBe("retry_scheduled");

    const people = ["+15553330001", "+15553330002", "+15553330003"];
    consentAll(w, ...people);
    people.forEach((p, i) => w.queue.enqueue({ idempotencyKey: `n${i}`, channel: "sim", to: p, text: `hello ${i}`, kind: "proactive", timeZone: LA }));
    await w.queue.drain();
    expect(people.map((p) => w.bus.inbox.get(p)?.length ?? 0)).toEqual([1, 1, 0]);
    w.clock.advance(25 * HOUR);
    await w.queue.drain();
    expect(w.bus.inbox.get(people[2])?.length).toBe(1);
  });

  test("Blooio safety pause_new holds new chats but not existing ones", async () => {
    const w = world();
    const LINE = w.bus.line;
    const known = "+15554440001", fresh = "+15554440002";
    consentAll(w, known, fresh);
    await w.bus.inbound(known, "hi there"); // makes `known` an existing conversation
    await w.gateway.handle({ kind: "safety", channel: "blooio", eventId: "s1", type: "safety.state_changed", action: "pause_new", line: LINE, at: w.clock.now() });
    const a = w.queue.enqueue({ idempotencyKey: "a", channel: "sim", to: known, from: LINE, text: "x", kind: "proactive", timeZone: LA }).record;
    const b = w.queue.enqueue({ idempotencyKey: "b", channel: "sim", to: fresh, from: LINE, text: "x", kind: "proactive", timeZone: LA }).record;
    await w.queue.drain();
    expect(a.status).toBe("sent");
    expect(b.status).toBe("retry_scheduled");
    await w.gateway.handle({ kind: "safety", channel: "blooio", eventId: "s2", type: "safety.state_changed", action: "none", line: LINE, at: w.clock.now() });
    w.clock.advance(61 * MINUTE);
    await w.queue.drain();
    expect(b.status).toBe("sent");
  });
});
