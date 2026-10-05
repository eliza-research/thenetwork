import { describe, expect, test } from "bun:test";
import { dedupeKeysFor, isAllowedMediaUrl, parseBlooioWebhook, signBlooioPayload, verifyBlooioSignature } from "../src/blooio/webhook.ts";
import { fixture } from "./helpers.ts";

const SECRET = "whsec_test_secret";
const NOW = 1_791_216_000; // seconds
const NOW_MS = NOW * 1000;

describe("signature verification (X-Blooio-Signature: t=..,v1=HMAC(secret, `${t}.${raw}`))", () => {
  const raw = fixture("received.v20261001.json");

  test("accepts a correctly signed raw body", () => {
    expect(verifyBlooioSignature(SECRET, signBlooioPayload(SECRET, raw, NOW), raw, NOW)).toEqual({ ok: true, timestamp: NOW });
  });
  test("matches the documented algorithm byte for byte", () => {
    const h = new Bun.CryptoHasher("sha256", SECRET).update(`${NOW}.${raw}`).digest("hex");
    expect(signBlooioPayload(SECRET, raw, NOW)).toBe(`t=${NOW},v1=${h}`);
  });
  test("rejects a re-serialized body (must verify raw bytes)", () => {
    const header = signBlooioPayload(SECRET, raw, NOW);
    const reserialized = JSON.stringify(JSON.parse(raw));
    expect(verifyBlooioSignature(SECRET, header, reserialized, NOW)).toEqual({ ok: false, reason: "mismatch" });
  });
  test("rejects wrong secret, stale and future timestamps, malformed headers", () => {
    const header = signBlooioPayload(SECRET, raw, NOW);
    expect(verifyBlooioSignature("whsec_other", header, raw, NOW).ok).toBe(false);
    expect(verifyBlooioSignature(SECRET, header, raw, NOW + 301)).toEqual({ ok: false, reason: "stale" });
    expect(verifyBlooioSignature(SECRET, header, raw, NOW - 301)).toEqual({ ok: false, reason: "stale" });
    expect(verifyBlooioSignature(SECRET, header, raw, NOW + 299).ok).toBe(true);
    expect(verifyBlooioSignature(SECRET, null, raw, NOW)).toEqual({ ok: false, reason: "missing" });
    expect(verifyBlooioSignature(SECRET, "v1=abc", raw, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyBlooioSignature(SECRET, `t=${NOW}abc,v1=${"0".repeat(64)}`, raw, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyBlooioSignature(SECRET, `t=${NOW},v1=zz`, raw, NOW)).toEqual({ ok: false, reason: "mismatch" });
  });
  test("tolerates whitespace and accepts any matching v1 (rotation-friendly)", () => {
    const good = signBlooioPayload(SECRET, raw, NOW).split(",")[1];
    expect(verifyBlooioSignature(SECRET, `t=${NOW}, v1=${"a".repeat(64)}, ${good}`, raw, NOW).ok).toBe(true);
  });
});

describe("payload parsing", () => {
  test("2026-10-01 message.received: normalized fields, media allowlist", () => {
    const ev = parseBlooioWebhook(fixture("received.v20261001.json"), 0);
    expect(ev.kind).toBe("message");
    if (ev.kind !== "message") return;
    expect(ev).toMatchObject({
      channel: "blooio", messageId: "msg_in_0001", eventId: "evt_019fd421-b020-7a63-8f8b-152ea9c99333",
      from: "+15551234567", to: "+15550000001", chatId: "chat_019fd421-af64-7040-aeae-3e8df24a8e89",
      isGroup: false, transport: "imessage", receivedAt: 1791216000000,
    });
    expect(ev.mediaUrls).toEqual(["https://media.blooio.com/a/photo.jpg"]); // evil.example.com dropped
  });

  test("2026-09-01 payload with legacy fields (data.id instead of message_id)", () => {
    const ev = parseBlooioWebhook(fixture("received.v20260901.json"), 0);
    expect(ev).toMatchObject({ kind: "message", messageId: "msg_in_0002", from: "+15551234567", text: "STOP", transport: "sms" });
  });

  test("group message carries group id and chat id for replies", () => {
    const ev = parseBlooioWebhook(fixture("received.group.json"), 0);
    expect(ev).toMatchObject({ kind: "message", isGroup: true, groupId: "grp_xyz789", chatId: "chat_group_1", from: "+15557654321" });
  });

  test("legacy v2 flat body (seconds timestamp normalized to ms)", () => {
    const ev = parseBlooioWebhook(fixture("legacy.v2.flat.json"), 0);
    expect(ev).toMatchObject({ kind: "message", messageId: "legacy_0004", from: "+15551234567", to: "+15550000001", receivedAt: 1791216000000 });
  });

  test("status, failure, typing, reaction, safety events", () => {
    expect(parseBlooioWebhook(fixture("status.delivered.json"), 0)).toMatchObject({ kind: "status", providerMessageId: "msg_out_0001", status: "delivered", transport: "imessage" });
    expect(parseBlooioWebhook(fixture("status.read.json"), 0)).toMatchObject({ kind: "status", status: "read" });
    expect(parseBlooioWebhook(fixture("status.failed.json"), 0)).toMatchObject({ kind: "status", status: "failed", errorCode: "recipient_unreachable" });
    expect(parseBlooioWebhook(fixture("typing.started.json"), 0)).toMatchObject({ kind: "typing", state: "started", chatId: "chat_abc" });
    expect(parseBlooioWebhook(fixture("reaction.json"), 0)).toMatchObject({ kind: "reaction", reaction: "+love", from: "+15551234567" });
    expect(parseBlooioWebhook(fixture("safety.state_changed.json"), 0)).toMatchObject({ kind: "safety", action: "pause_new", previousAction: "slow", line: "+15550000001" });
  });

  test("unknown, empty, and incomplete events are ignored, not thrown", () => {
    expect(parseBlooioWebhook(JSON.stringify({ id: "e", type: "poll.voted", created_at: 1, data: {} }), 0).kind).toBe("ignored");
    expect(parseBlooioWebhook(JSON.stringify({ id: "e", type: "message.received", created_at: 1, data: { message_id: "m", sender: "+1", text: "  " } }), 0)).toMatchObject({ kind: "ignored", reason: "empty message" });
    expect(parseBlooioWebhook(JSON.stringify({ id: "e", type: "message.received", created_at: 1, data: { text: "hi", sender: "+1" } }), 0)).toMatchObject({ kind: "ignored", reason: "missing message id" });
    expect(() => parseBlooioWebhook("not json", 0)).toThrow();
  });

  test("dedupe keys: envelope id plus message id", () => {
    const ev = parseBlooioWebhook(fixture("received.v20261001.json"), NOW_MS);
    expect(dedupeKeysFor(ev)).toEqual(["evt:evt_019fd421-b020-7a63-8f8b-152ea9c99333", "msg:blooio:msg_in_0001"]);
    expect(dedupeKeysFor(parseBlooioWebhook(fixture("legacy.v2.flat.json"), 0))).toEqual(["msg:blooio:legacy_0004"]);
  });

  test("media allowlist is https + blooio hosts only", () => {
    expect(isAllowedMediaUrl("https://media.blooio.com/x")).toBe(true);
    expect(isAllowedMediaUrl("http://media.blooio.com/x")).toBe(false);
    expect(isAllowedMediaUrl("https://blooio.com.evil.io/x")).toBe(false);
    expect(isAllowedMediaUrl("https://169.254.169.254/latest")).toBe(false);
  });
});
