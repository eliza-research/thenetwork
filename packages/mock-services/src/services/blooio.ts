import { jsonResponse, parseJsonBody, sha256Hex, strField, type ServiceContext, type ServiceResult } from "../http-helpers.ts";
import type { BlooioConversationState, BlooioLineState, BlooioMessageRecord } from "../state.ts";

const BLOOIO_RATE_LIMIT = { limit: 120, windowMs: 60_000 };
const MAX_UNANSWERED_STREAK = 3;

function primaryLine(ctx: ServiceContext, requestedFrom?: string): BlooioLineState {
  if (requestedFrom && ctx.state.blooioLines.has(requestedFrom)) {
    return ctx.state.blooioLines.get(requestedFrom)!;
  }
  const first = ctx.state.blooioLines.values().next().value;
  if (first) return first;
  const fallback: BlooioLineState = {
    phoneNumber: requestedFrom || "+14155550100",
    isActive: true,
    suspended: false,
    status: "active",
    planKind: "dedicated",
    dailyOutboundCount: 0,
    dailyNewConversations: 0,
  };
  ctx.state.blooioLines.set(fallback.phoneNumber, fallback);
  return fallback;
}

function getOrCreateConversation(ctx: ServiceContext, chatId: string, recipient: string): BlooioConversationState {
  let conv = ctx.state.blooioConversations.get(chatId);
  if (!conv) {
    conv = { chatId, recipient, unansweredOutbound: 0, optedOut: false };
    ctx.state.blooioConversations.set(chatId, conv);
  }
  return conv;
}

export async function triggerBlooioInbound(
  ctx: ServiceContext,
  input: {
    from: string;
    to?: string;
    chatId?: string;
    text: string;
    protocol?: "imessage" | "sms" | "rcs";
    isGroup?: boolean;
    replyToMessageId?: string;
  },
): Promise<{ message: BlooioMessageRecord; deliveries: number }> {
  const nowMs = ctx.registry.clock.now();
  const line = primaryLine(ctx, input.to);
  const chatId = input.chatId || input.from;
  const conv = getOrCreateConversation(ctx, chatId, input.from);
  conv.unansweredOutbound = 0;
  conv.lastInboundAtMs = nowMs;
  const trimmedUpper = input.text.trim().toUpperCase();
  if (trimmedUpper === "STOP" || trimmedUpper === "STOPALL" || trimmedUpper === "UNSUBSCRIBE") {
    conv.optedOut = true;
  } else if (trimmedUpper === "START" || trimmedUpper === "UNSTOP") {
    conv.optedOut = false;
  }

  const msgId = ctx.registry.nextId(ctx.state, "bl_in");
  const msg: BlooioMessageRecord = {
    id: msgId,
    chatId,
    from: input.from,
    to: line.phoneNumber,
    text: input.text,
    attachments: [],
    protocol: input.protocol ?? "imessage",
    status: "delivered",
    createdAtMs: nowMs,
    direction: "inbound",
  };
  ctx.state.blooioMessages.set(msgId, msg);

  const eventId = ctx.registry.nextId(ctx.state, "evt");
  const envelope = {
    id: eventId,
    type: "message.received",
    api_version: "2026-10-01",
    created_at: nowMs,
    organization_id: "org_mock_thenetwork",
    data: {
      message_id: msgId,
      chat_id: chatId,
      sender: input.from,
      recipient: line.phoneNumber,
      text: input.text,
      protocol: msg.protocol,
      is_group: Boolean(input.isGroup),
      ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
    },
  };
  const results = await ctx.webhooks.dispatch(ctx.state, "blooio", "message.received", envelope);
  return { message: msg, deliveries: results.length };
}

export async function handleBlooioRequest(
  ctx: ServiceContext,
  req: Request,
  url: URL,
): Promise<ServiceResult | null> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (!path.startsWith("/blooio/")) return null;

  const nowMs = ctx.registry.clock.now();
  const rlCheck = ctx.chaos.checkRateLimit(
    ctx.state.sessionId,
    "blooio",
    `${req.method}:${path.split("/").slice(0, 4).join("/")}`,
    path,
    nowMs,
    BLOOIO_RATE_LIMIT,
  );
  const rateHeaders: Record<string, string> = {
    "x-rate-limit-limit": String(rlCheck.result.limit),
    "x-rate-limit-remaining": String(rlCheck.result.remaining),
    "x-rate-limit-reset": String(rlCheck.result.resetAtSec),
    ...(rlCheck.result.retryAfterSec > 0 ? { "retry-after": String(rlCheck.result.retryAfterSec) } : {}),
  };
  const rateMeta = {
    limit: rlCheck.result.limit,
    remaining: rlCheck.result.remaining,
    resetAtSec: rlCheck.result.resetAtSec,
  };

  if (!rlCheck.result.allowed) {
    return {
      service: "blooio",
      response: jsonResponse({ error: { code: "rate_limited", message: "Blooio rate limit exceeded" } }, 429, rateHeaders),
      rateLimit: rateMeta,
      chaosApplied: rlCheck.chaosRuleId,
    };
  }

  if (path === "/blooio/v1/api/send-message" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const to = strField(body, "identifier");
    const text = strField(body, "message");
    if (!to || !text) {
      return { service: "blooio", response: jsonResponse({ error: "invalid_request", message: "identifier and message required" }, 400, rateHeaders), rateLimit: rateMeta };
    }
    const id = ctx.registry.nextId(ctx.state, "bl_v1");
    const line = primaryLine(ctx);
    ctx.state.blooioMessages.set(id, {
      id,
      chatId: to,
      from: line.phoneNumber,
      to,
      text,
      attachments: [],
      protocol: "imessage",
      status: "queued",
      createdAtMs: nowMs,
      direction: "outbound",
    });
    return {
      service: "blooio",
      response: jsonResponse({ message_id: id, status: "queued" }, 200, rateHeaders),
      requestSummary: { to, textLen: text.length },
      responseSummary: { message_id: id, status: "queued" },
      rateLimit: rateMeta,
    };
  }

  if (!path.startsWith("/blooio/v4")) {
    return { service: "blooio", response: jsonResponse({ error: { code: "not_found", message: `Unknown path ${path}` } }, 404, rateHeaders), rateLimit: rateMeta };
  }

  const subPath = path.slice("/blooio/v4".length) || "/";
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.slice(7).trim().length === 0) {
    return { service: "blooio", response: jsonResponse({ error: { code: "unauthorized", message: "Bearer token required" } }, 401, rateHeaders), rateLimit: rateMeta };
  }

  if (req.method === "GET" && subPath === "/me") {
    const lines = [...ctx.state.blooioLines.values()];
    const data = {
      data: {
        auth_type: "api_key",
        valid: true,
        organization_id: "org_mock_thenetwork",
        organization: { organization_id: "org_mock_thenetwork", name: "The Network Sim", country_code: "US", created_at: ctx.state.startMs },
        devices: lines.map((l) => ({
          phone_number: l.phoneNumber,
          is_active: l.isActive,
          suspended: l.suspended,
          status: l.status,
          last_active: nowMs,
          plan_kind: l.planKind,
        })),
        usage: {
          inbound_messages: [...ctx.state.blooioMessages.values()].filter((m) => m.direction === "inbound").length,
          outbound_messages: [...ctx.state.blooioMessages.values()].filter((m) => m.direction === "outbound").length,
          last_message_sent: nowMs,
        },
      },
    };
    return { service: "blooio", response: jsonResponse(data, 200, rateHeaders), rateLimit: rateMeta };
  }

  if (req.method === "GET" && subPath === "/me/numbers") {
    const lines = [...ctx.state.blooioLines.values()].map((l) => ({
      phone_number: l.phoneNumber,
      is_active: l.isActive,
      suspended: l.suspended,
      status: l.status,
      last_active: nowMs,
      plan_kind: l.planKind,
    }));
    return { service: "blooio", response: jsonResponse({ data: lines }, 200, rateHeaders), rateLimit: rateMeta };
  }

  if (req.method === "GET" && subPath === "/channels") {
    const channels = [...ctx.state.blooioLines.values()].map((l, idx) => ({
      id: `ch_${idx + 1}`,
      type: "blooio",
      address: l.phoneNumber,
      status: l.status,
      capabilities: { protocols: ["imessage", "sms", "rcs"], content: ["text", "attachments"], actions: ["typing", "read"] },
      created_at: ctx.state.startMs,
    }));
    return { service: "blooio", response: jsonResponse({ data: channels, has_more: false, next_cursor: null }, 200, rateHeaders), rateLimit: rateMeta };
  }

  const capMatch = /^\/channels\/([^/]+)\/(capabilities|settings)$/.exec(subPath);
  if (req.method === "GET" && capMatch) {
    const lineAddr = decodeURIComponent(capMatch[1]!);
    const kind = capMatch[2]!;
    const line = primaryLine(ctx, lineAddr);
    const payload =
      kind === "capabilities"
        ? { data: { line: line.phoneNumber, protocols: ["imessage", "sms", "rcs"], content: ["text", "attachments"] } }
        : { data: { line: line.phoneNumber, status: line.status, daily_outbound_cap: 500, daily_new_conversations_cap: 150 } };
    return { service: "blooio", response: jsonResponse(payload, 200, rateHeaders), rateLimit: rateMeta };
  }

  if (req.method === "GET" && subPath === "/webhooks") {
    const hooks = [...ctx.state.webhooks.values()]
      .filter((w) => w.service === "blooio")
      .map((w) => ({ id: w.id, url: w.url, status: w.active ? "active" : "disabled", api_version: "2026-10-01", created_at: ctx.state.startMs }));
    return { service: "blooio", response: jsonResponse({ data: hooks, has_more: false, next_cursor: null }, 200, rateHeaders), rateLimit: rateMeta };
  }

  if (req.method === "GET" && subPath === "/webhooks/versions") {
    return { service: "blooio", response: jsonResponse({ data: ["2026-10-01", "2026-09-01"] }, 200, rateHeaders), rateLimit: rateMeta };
  }

  const statusMatch = /^\/chats\/([^/]+)\/messages\/([^/]+)\/status$/.exec(subPath);
  if (req.method === "GET" && statusMatch) {
    const msgId = decodeURIComponent(statusMatch[2]!);
    const msg = ctx.state.blooioMessages.get(msgId);
    if (!msg) {
      return { service: "blooio", response: jsonResponse({ error: { code: "not_found", message: "Message not found" } }, 404, rateHeaders), rateLimit: rateMeta };
    }
    return { service: "blooio", response: jsonResponse({ data: { id: msg.id, chat_id: msg.chatId, status: msg.status, protocol: msg.protocol } }, 200, rateHeaders), rateLimit: rateMeta };
  }

  const typingMatch = /^\/chats\/([^/]+)\/(typing|read)$/.exec(subPath);
  if (typingMatch && (req.method === "POST" || req.method === "DELETE")) {
    return { service: "blooio", response: jsonResponse({ ok: true }, 200, rateHeaders), rateLimit: rateMeta };
  }

  const chatSendMatch = /^\/chats\/([^/]+)\/messages$/.exec(subPath);
  const isDirectSend = req.method === "POST" && subPath === "/messages";
  if ((isDirectSend || (req.method === "POST" && chatSendMatch))) {
    const body = await parseJsonBody(req);
    const idempotencyKey = req.headers.get("idempotency-key")?.trim() || undefined;
    const text = strField(body, "text");
    const attachments = Array.isArray(body.attachments) ? body.attachments.map(String) : [];
    const to = chatSendMatch ? decodeURIComponent(chatSendMatch[1]!) : strField(body, "to");
    const from = strField(body, "from") || undefined;
    if (!to || (!text && attachments.length === 0)) {
      return { service: "blooio", response: jsonResponse({ error: { code: "invalid_request", message: "recipient and text/attachments required" } }, 400, rateHeaders), rateLimit: rateMeta };
    }

    const bodyHash = sha256Hex(JSON.stringify({ to, from: from ?? null, text, attachments }));
    if (idempotencyKey) {
      const prev = ctx.state.blooioIdempotency.get(idempotencyKey);
      if (prev) {
        if (prev.bodyHash !== bodyHash) {
          return {
            service: "blooio",
            response: jsonResponse({ error: { code: "idempotency_conflict", message: "Idempotency-Key reused with a different request body" } }, 409, rateHeaders),
            requestSummary: { to, idempotencyKey },
            responseSummary: { conflict: true },
            rateLimit: rateMeta,
          };
        }
        return {
          service: "blooio",
          response: jsonResponse(prev.receipt, 200, rateHeaders),
          requestSummary: { to, idempotencyKey, replayed: true },
          responseSummary: prev.receipt,
          rateLimit: rateMeta,
        };
      }
    }

    const line = primaryLine(ctx, from);
    const safetyChaos = ctx.chaos.domainFaultOf("blooio", path, nowMs, "blooio_safety");
    const effectiveLineStatus = safetyChaos ? safetyChaos.fault.action : line.status;
    const conv = getOrCreateConversation(ctx, to, to);

    if (effectiveLineStatus === "account_review") {
      return {
        service: "blooio",
        response: jsonResponse({ error: { code: "safety_account_review", message: "Line is under safety account review" } }, 403, rateHeaders),
        rateLimit: rateMeta,
        chaosApplied: safetyChaos?.rule.id ?? "line_account_review",
      };
    }
    if (effectiveLineStatus === "reply_only" && conv.lastInboundAtMs === undefined) {
      return {
        service: "blooio",
        response: jsonResponse({ error: { code: "safety_reply_only", message: "Line is restricted to replies only" } }, 403, rateHeaders),
        rateLimit: rateMeta,
        chaosApplied: safetyChaos?.rule.id ?? "line_reply_only",
      };
    }
    if (effectiveLineStatus === "new_conversations_paused" && conv.lastInboundAtMs === undefined && conv.lastOutboundAtMs === undefined) {
      return {
        service: "blooio",
        response: jsonResponse({ error: { code: "safety_new_conversations_paused", message: "New conversations are paused on this line" } }, 403, rateHeaders),
        rateLimit: rateMeta,
        chaosApplied: safetyChaos?.rule.id ?? "line_new_conversations_paused",
      };
    }

    if (conv.unansweredOutbound >= MAX_UNANSWERED_STREAK) {
      return {
        service: "blooio",
        response: jsonResponse({ error: { code: "conversation_streak_limit", message: "Wait for recipient reply before sending another message" } }, 422, rateHeaders),
        requestSummary: { to, unansweredOutbound: conv.unansweredOutbound },
        responseSummary: { code: "conversation_streak_limit" },
        rateLimit: rateMeta,
      };
    }

    const isNewConv = conv.lastOutboundAtMs === undefined && conv.lastInboundAtMs === undefined;
    if (isNewConv) line.dailyNewConversations += 1;
    line.dailyOutboundCount += 1;
    conv.unansweredOutbound += 1;
    conv.lastOutboundAtMs = nowMs;

    const msgId = ctx.registry.nextId(ctx.state, "bl_msg");
    const protocol: BlooioMessageRecord["protocol"] = to.endsWith("99") ? "sms" : "imessage";
    const record: BlooioMessageRecord = {
      id: msgId,
      chatId: to,
      from: line.phoneNumber,
      to,
      text,
      attachments,
      protocol,
      status: "queued",
      idempotencyKey,
      bodyHash,
      createdAtMs: nowMs,
      direction: "outbound",
    };
    ctx.state.blooioMessages.set(msgId, record);

    const receipt = {
      data: {
        id: msgId,
        chat_id: to,
        status: "queued",
        protocol,
        created_at: nowMs,
      },
    };
    if (idempotencyKey) {
      ctx.state.blooioIdempotency.set(idempotencyKey, { bodyHash, receipt });
    }

    const webhookIds: string[] = [];
    const statusEventId = ctx.registry.nextId(ctx.state, "evt");
    record.status = "delivered";
    const deliveries = await ctx.webhooks.dispatch(ctx.state, "blooio", "message.delivered", {
      id: statusEventId,
      type: "message.delivered",
      api_version: "2026-10-01",
      created_at: nowMs,
      organization_id: "org_mock_thenetwork",
      data: {
        message_id: msgId,
        chat_id: to,
        protocol,
      },
    });
    for (const d of deliveries) webhookIds.push(d.deliveryId);

    return {
      service: "blooio",
      response: jsonResponse(receipt, 201, rateHeaders),
      requestSummary: { to, textLen: text.length, idempotencyKey },
      responseSummary: receipt.data,
      rateLimit: rateMeta,
      ...(webhookIds.length ? { webhookTriggered: webhookIds } : {}),
    };
  }

  return {
    service: "blooio",
    response: jsonResponse({ error: { code: "not_found", message: `Unhandled Blooio v4 route ${req.method} ${subPath}` } }, 404, rateHeaders),
    rateLimit: rateMeta,
  };
}
