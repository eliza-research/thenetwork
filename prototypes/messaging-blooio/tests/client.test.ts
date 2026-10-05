import { describe, expect, test } from "bun:test";
import { BlooioApiError, BlooioClient, classifyFailure } from "../src/blooio/client.ts";
import { ChannelSendError } from "../src/types.ts";
import { fixture, mockFetch } from "./helpers.ts";

const KEY = "api_SECRET_DO_NOT_LEAK_123";
const json = (body: string | object, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("BlooioClient read-only calls", () => {
  test("GET /me with bearer auth", async () => {
    const m = mockFetch(() => json(fixture("me.json")));
    const c = new BlooioClient({ apiKey: KEY, fetch: m.fn });
    const me = await c.getMe();
    expect(me.valid).toBe(true);
    expect(me.devices?.[0].plan_kind).toBe("dedicated");
    expect(m.calls[0].url).toBe("https://api.blooio.com/v4/me");
    expect((m.calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(m.calls[0].init.method).toBe("GET");
  });

  test("phone numbers are URL-encoded in paths (+ -> %2B)", async () => {
    const m = mockFetch(() => json({ data: {} }));
    await new BlooioClient({ apiKey: KEY, fetch: m.fn }).getChannelCapabilities("+15550000001");
    expect(m.calls[0].url).toBe("https://api.blooio.com/v4/channels/%2B15550000001/capabilities");
  });

  test("errors carry status and v4 code, never the key", async () => {
    const m = mockFetch(() => json({ error: { code: "feature_not_enabled", message: "nope" } }, 403));
    const c = new BlooioClient({ apiKey: KEY, fetch: m.fn });
    const err = await c.listNumbers().catch((e) => e);
    expect(err).toBeInstanceOf(BlooioApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("feature_not_enabled");
    expect(String(err.message)).not.toContain(KEY);
    expect(JSON.stringify(c)).not.toContain(KEY);
  });
});

describe("BlooioClient.send", () => {
  test("POST /messages with Idempotency-Key, to/from/text; parses receipt", async () => {
    const m = mockFetch(() => json(fixture("send.response.202.json"), 202));
    const r = await new BlooioClient({ apiKey: KEY, fetch: m.fn }).send({ to: "+15551234567", from: "+15550000001", text: "hi", idempotencyKey: "k1" });
    expect(r).toEqual({ providerMessageId: "msg_out_0001", chatId: "chat_abc", status: "queued", transport: "pending", replayed: false });
    const call = m.calls[0];
    expect(call.url).toBe("https://api.blooio.com/v4/messages");
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>)["Idempotency-Key"]).toBe("k1");
    expect(JSON.parse(call.init.body as string)).toEqual({ text: "hi", to: "+15551234567", from: "+15550000001" });
  });

  test("chat:<id> posts into the existing chat (groups) without to/from", async () => {
    const m = mockFetch(() => json({ id: "msg_g", status: "queued" }, 201));
    await new BlooioClient({ apiKey: KEY, fetch: m.fn }).send({ to: "chat:chat_group_1", text: "hi all", mediaUrls: ["https://x.test/a.png"], idempotencyKey: "k2" });
    expect(m.calls[0].url).toBe("https://api.blooio.com/v4/chats/chat_group_1/messages");
    expect(JSON.parse(m.calls[0].init.body as string)).toEqual({ text: "hi all", attachments: ["https://x.test/a.png"] });
  });

  test("HTTP 200 on a replayed idempotency key is reported as replayed", async () => {
    const m = mockFetch(() => json(fixture("send.response.202.json"), 200));
    const r = await new BlooioClient({ apiKey: KEY, fetch: m.fn }).send({ to: "+15551234567", text: "hi", idempotencyKey: "k1" });
    expect(r.replayed).toBe(true);
  });

  test("conversation limit 429 is await_recipient, not retryable", async () => {
    const m = mockFetch(() => json(fixture("error.429.conversation.json"), 429));
    const err = await new BlooioClient({ apiKey: KEY, fetch: m.fn }).send({ to: "+15551234567", text: "hi", idempotencyKey: "k" }).catch((e) => e);
    expect(err).toBeInstanceOf(ChannelSendError);
    expect(err.failure).toBe("await_recipient");
    expect(err.code).toBe("conversation_awaiting_reply");
  });

  test("network error and 5xx are retryable; accepted-without-id is retryable (idempotency makes it safe)", async () => {
    const boom = mockFetch(() => { throw new TypeError("fetch failed"); });
    expect((await new BlooioClient({ apiKey: KEY, fetch: boom.fn }).send({ to: "+1", text: "x", idempotencyKey: "k" }).catch((e) => e)).failure).toBe("retryable");
    const noId = mockFetch(() => json({ status: "queued" }, 202));
    expect((await new BlooioClient({ apiKey: KEY, fetch: noId.fn }).send({ to: "+1", text: "x", idempotencyKey: "k" }).catch((e) => e)).failure).toBe("retryable");
  });

  test("refuses to send without an idempotency key or content", async () => {
    const m = mockFetch(() => json({}));
    const c = new BlooioClient({ apiKey: KEY, fetch: m.fn });
    await expect(c.send({ to: "+1", text: "x", idempotencyKey: "" })).rejects.toThrow("idempotencyKey");
    await expect(c.send({ to: "+1", text: "", idempotencyKey: "k" })).rejects.toThrow("text or mediaUrls");
    expect(m.calls.length).toBe(0);
  });
});

describe("failure classification", () => {
  test.each([
    [503, undefined, undefined, "retryable"],
    [500, undefined, undefined, "retryable"],
    [429, "conversation_streak_limit", undefined, "await_recipient"],
    [429, "conversation_inactive_paused", undefined, "await_recipient"],
    [403, "conversation_content_restricted", undefined, "await_recipient"],
    [429, "outbound_limit_reached", undefined, "blocked"],
    [429, undefined, 5000, "retryable"],
    [403, "safety_reply_only", undefined, "blocked"],
    [403, "inbound_only_no_prior_inbound", undefined, "blocked"],
    [401, undefined, undefined, "auth"],
    [409, undefined, undefined, "invalid"],
    [422, "invalid_content", undefined, "invalid"],
  ] as const)("%i %s -> %s", (status, code, retryAfter, expected) => {
    expect(classifyFailure(status, code, retryAfter)).toBe(expected);
  });
});
