// Blooio webhook verification and parsing.
//
// Signature (docs: guides/webhook-signatures): header `X-Blooio-Signature: t=<unix seconds>,v1=<hex>`
// where v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). Reject anything older than 300 s.
// Always verify against the RAW body bytes, never re-serialized JSON.
//
// Payload versions handled:
//   - 2026-10-01 (latest): envelope { id, type, api_version, created_at(ms), organization_id, data }
//   - 2026-09-01 (baseline; what existing Eliza subscriptions are pinned to): same envelope, data may carry
//     legacy fields (`id` instead of `message_id`, `external_id`, `internal_id`, `chat_guid`)
//   - legacy v2 flat body: { event, message_id, external_id, internal_id, text, protocol, is_group, timestamp }
//
// Dedupe: the envelope `id` is identical on every retry and replay. `X-Blooio-Delivery` identifies one delivery
// (stable across its retries, new on replay), so it is NOT the dedupe key.

import { createHmac, timingSafeEqual } from "node:crypto";
import { toStatus, toTransport } from "./client.ts";
import type { ChannelEvent, InboundMessage } from "../types.ts";

export const SIGNATURE_HEADER = "x-blooio-signature";
export const DELIVERY_HEADER = "x-blooio-delivery";
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

export function signBlooioPayload(secret: string, rawBody: string, timestampSeconds: number): string {
  const sig = createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex");
  return `t=${timestampSeconds},v1=${sig}`;
}

export function verifyBlooioSignature(
  secret: string,
  header: string | null | undefined,
  rawBody: string,
  nowSeconds: number,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): SignatureResult {
  if (!secret || !header) return { ok: false, reason: "missing" };
  const parts = header.split(",").map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  // Several v1= entries may appear during a future rotation; accept if any matches.
  const sigs = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return { ok: false, reason: "malformed" };
  const ts = Number(t);
  if (!Number.isSafeInteger(ts)) return { ok: false, reason: "malformed" };
  if (Math.abs(nowSeconds - ts) > toleranceSeconds) return { ok: false, reason: "stale" };
  const expected = Buffer.from(createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex"), "hex");
  for (const s of sigs) {
    if (!/^[0-9a-f]{64}$/i.test(s)) continue;
    if (timingSafeEqual(Buffer.from(s, "hex"), expected)) return { ok: true, timestamp: ts };
  }
  return { ok: false, reason: "mismatch" };
}

/** Only fetch inbound media from Blooio-owned HTTPS hosts (SSRF guard, same allowlist as Eliza). */
export const MEDIA_HOST_ALLOWLIST = ["blooio.com", "backend.blooio.com", "api.blooio.com", "media.blooio.com"];
export function isAllowedMediaUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && MEDIA_HOST_ALLOWLIST.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const toMs = (v: number | undefined, fallback: number): number =>
  v === undefined ? fallback : v < 100_000_000_000 ? v * 1000 : v; // v2 used seconds, v4 uses ms

function mediaUrls(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((a) => (typeof a === "string" ? a : a && typeof a === "object" ? str((a as Obj).url) : undefined))
    .filter((u): u is string => !!u && isAllowedMediaUrl(u));
}

/**
 * Parse a verified webhook body into a normalized ChannelEvent. Returns `ignored` (never throws) for
 * well-formed events we do not act on; throws only on non-JSON input.
 */
export function parseBlooioWebhook(rawBody: string, nowMs: number): ChannelEvent {
  const body = JSON.parse(rawBody) as Obj;
  if (!body || typeof body !== "object") return { kind: "ignored", type: "unknown", reason: "not an object" };

  // Legacy v2 flat payload.
  if (typeof body.event === "string" && !("data" in body)) return parseLegacyV2(body, nowMs);

  const type = str(body.type) ?? "unknown";
  const eventId = str(body.id);
  const at = toMs(num(body.created_at), nowMs);
  const d = (body.data && typeof body.data === "object" ? body.data : {}) as Obj;

  if (type === "message.received") {
    const messageId = str(d.message_id) ?? str(d.id);
    const contact = (d.contact && typeof d.contact === "object" ? d.contact : {}) as Obj;
    const from = str(d.sender) ?? str(contact.identifier) ?? str(d.external_id);
    if (!messageId) return { kind: "ignored", eventId, type, reason: "missing message id" };
    if (!from) return { kind: "ignored", eventId, type, reason: "missing sender" };
    const group = d.group && typeof d.group === "object" ? (d.group as Obj) : null;
    const chatId = str(d.chat_id) ?? from;
    const text = typeof d.text === "string" ? d.text : "";
    const media = mediaUrls(d.attachments);
    if (!text.trim() && media.length === 0) return { kind: "ignored", eventId, type, reason: "empty message" };
    const msg: InboundMessage = {
      kind: "message",
      channel: d.channel_type === "twilio" ? "twilio" : "blooio",
      messageId,
      eventId,
      from,
      to: str(d.recipient) ?? str(d.channel_address) ?? str(d.internal_id) ?? null,
      chatId,
      isGroup: group !== null || d.is_group === true || /^grp_/i.test(chatId),
      groupId: group ? str(group.group_id) : undefined,
      text,
      mediaUrls: media,
      transport: toTransport(d.protocol) ?? "unknown",
      replyToMessageId: str(d.reply_to_message_id),
      receivedAt: at,
    };
    return msg;
  }

  if (type === "message.queued" || type === "message.sent" || type === "message.delivered" || type === "message.read" || type === "message.failed") {
    const providerMessageId = str(d.message_id) ?? str(d.id);
    if (!providerMessageId) return { kind: "ignored", eventId, type, reason: "missing message id" };
    const err = (d.error && typeof d.error === "object" ? d.error : {}) as Obj;
    return {
      kind: "status",
      channel: d.channel_type === "twilio" ? "twilio" : "blooio",
      eventId,
      providerMessageId,
      chatId: str(d.chat_id),
      status: toStatus(type.slice("message.".length)),
      transport: toTransport(d.protocol),
      errorCode: str(err.code),
      errorMessage: str(err.message),
      at,
    };
  }

  if (type === "message.reaction") {
    const contact = (d.contact && typeof d.contact === "object" ? d.contact : {}) as Obj;
    const from = str(d.sender) ?? str(contact.identifier);
    if (d.direction === "outbound" || !from) return { kind: "ignored", eventId, type, reason: "own or anonymous reaction" };
    return {
      kind: "reaction", channel: "blooio", eventId, chatId: str(d.chat_id) ?? from, from,
      reaction: str(d.reaction) ?? "", targetMessageId: str(d.target_message_id) ?? str(d.message_id), at,
    };
  }

  if (type === "typing.started" || type === "typing.stopped") {
    const contact = (d.contact && typeof d.contact === "object" ? d.contact : {}) as Obj;
    const from = str(d.sender) ?? str(contact.identifier);
    const chatId = str(d.chat_id);
    if (!from || !chatId) return { kind: "ignored", eventId, type, reason: "incomplete typing event" };
    return { kind: "typing", channel: "blooio", eventId, chatId, from, state: type === "typing.started" ? "started" : "stopped", at };
  }

  if (type.startsWith("safety.")) {
    return {
      kind: "safety", channel: "blooio", eventId, type,
      action: str(d.action), previousAction: str(d.previous_action),
      reasons: d.reasons && typeof d.reasons === "object" ? (d.reasons as Obj) : undefined,
      line: str(d.phone_number) ?? str(d.channel_address), at,
    };
  }

  return { kind: "ignored", eventId, type, reason: "unhandled event type" };
}

function parseLegacyV2(b: Obj, nowMs: number): ChannelEvent {
  const type = String(b.event);
  const messageId = str(b.message_id);
  const at = toMs(num(b.received_at) ?? num(b.timestamp), nowMs);
  if (type === "message.received") {
    const from = str(b.sender) ?? str(b.external_id);
    if (!messageId || !from) return { kind: "ignored", type, reason: "missing message id or sender" };
    const chatId = str(b.chat_id) ?? from;
    const text = typeof b.text === "string" ? b.text : "";
    const media = mediaUrls(b.attachments);
    if (!text.trim() && media.length === 0) return { kind: "ignored", type, reason: "empty message" };
    return {
      kind: "message", channel: "blooio", messageId, eventId: undefined, from, to: str(b.internal_id) ?? null, chatId,
      isGroup: b.is_group === true || /^grp_/i.test(chatId), text, mediaUrls: media,
      transport: toTransport(b.protocol) ?? "unknown", receivedAt: at,
    };
  }
  if (/^message\.(sent|delivered|read|failed|queued)$/.test(type) && messageId) {
    return { kind: "status", channel: "blooio", providerMessageId: messageId, status: toStatus(type.slice(8)), transport: toTransport(b.protocol), at };
  }
  return { kind: "ignored", type, reason: "unhandled legacy event" };
}

/**
 * Keys to dedupe a delivery on. The envelope id catches provider retries/replays; the message id also catches the
 * same inbound arriving through two subscriptions (e.g. an org-wide and a key-scoped webhook both pointing at us)
 * or through a legacy v2 body without an envelope id. An event is a duplicate if ANY key was seen.
 */
export function dedupeKeysFor(ev: ChannelEvent): string[] {
  const keys: string[] = [];
  if (ev.eventId) keys.push(`evt:${ev.eventId}`);
  if (ev.kind === "message") keys.push(`msg:${ev.channel}:${ev.messageId}`);
  if (ev.kind === "status") keys.push(`st:${ev.channel}:${ev.providerMessageId}:${ev.status}`);
  return keys;
}
