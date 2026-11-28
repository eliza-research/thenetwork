import { jsonResponse, parseJsonBody, sha256Hex, strField, type ServiceContext, type ServiceResult } from "../http-helpers.ts";
import type { EmailDomainState, EmailMessageRecord } from "../state.ts";

const EMAIL_RATE_LIMIT = { limit: 150, windowMs: 60_000 };

function extractDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase().trim() : "ntwrk.party";
}

function getOrCreateDomain(ctx: ServiceContext, domain: string): EmailDomainState {
  let state = ctx.state.emailDomains.get(domain);
  if (!state) {
    state = {
      domain,
      sentCount: 0,
      deliveredCount: 0,
      bouncedCount: 0,
      complaintCount: 0,
      unsubscribeCount: 0,
      reputationScore: 100,
    };
    ctx.state.emailDomains.set(domain, state);
  }
  return state;
}

function updateReputation(domain: EmailDomainState): void {
  if (domain.sentCount === 0) return;
  const bounceRate = domain.bouncedCount / domain.sentCount;
  const complaintRate = domain.complaintCount / domain.sentCount;
  const penalty = bounceRate * 400 + complaintRate * 2500;
  domain.reputationScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

async function processEmailOutcome(
  ctx: ServiceContext,
  msg: EmailMessageRecord,
  path: string,
): Promise<{ webhookIds: string[]; chaosRuleId?: string }> {
  const nowMs = ctx.registry.clock.now();
  const domain = getOrCreateDomain(ctx, extractDomain(msg.from));
  domain.sentCount += 1;

  const storm = ctx.chaos.domainFaultOf(msg.provider, path, nowMs, "email_bounce_storm")
    ?? ctx.chaos.domainFaultOf("resend", path, nowMs, "email_bounce_storm");
  const rng = ctx.registry.forkRng(ctx.state, "email_outcome", msg.id);

  const primaryTo = msg.to[0] ?? "";
  const forcedBounce = primaryTo.includes("bounce") || primaryTo.endsWith("@invalid.test");
  const forcedComplaint = primaryTo.includes("spam") || primaryTo.includes("complaint");
  const forcedUnsub = primaryTo.includes("stop") || primaryTo.includes("unsub");

  const bounceProb = storm ? storm.fault.hardBounceRate : 0.01;
  const complaintProb = storm ? storm.fault.spamComplaintRate : 0.001;

  const events: string[] = [];
  if (forcedBounce || rng.bool(bounceProb)) {
    msg.status = "bounced";
    domain.bouncedCount += 1;
    events.push("email.bounced");
  } else if (forcedComplaint || rng.bool(complaintProb)) {
    msg.status = "complained";
    domain.deliveredCount += 1;
    domain.complaintCount += 1;
    events.push("email.delivered", "email.complained");
  } else if (forcedUnsub) {
    msg.status = "unsubscribed";
    domain.deliveredCount += 1;
    domain.unsubscribeCount += 1;
    events.push("email.delivered", "email.unsubscribed");
  } else {
    msg.status = "delivered";
    domain.deliveredCount += 1;
    events.push("email.delivered");
    const openProb = 0.35 * (domain.reputationScore / 100);
    if (rng.bool(openProb)) {
      msg.opened = true;
      events.push("email.opened");
      if (rng.bool(0.28)) {
        msg.clicked = true;
        events.push("email.clicked");
      }
    }
  }
  updateReputation(domain);

  const webhookIds: string[] = [];
  const hookService =
    msg.provider === "resend" || msg.provider === "sendgrid" || msg.provider === "postmark"
      ? msg.provider
      : "resend";

  for (const evType of events) {
    const payload =
      hookService === "resend"
        ? {
            type: evType,
            created_at: new Date(nowMs).toISOString(),
            data: {
              created_at: new Date(msg.createdAtMs).toISOString(),
              email_id: msg.id,
              from: msg.from,
              to: msg.to,
              subject: msg.subject,
            },
          }
        : hookService === "postmark"
          ? {
              RecordType: evType.replace("email.", ""),
              MessageID: msg.id,
              Recipient: primaryTo,
              Subject: msg.subject,
              ReceivedAt: new Date(nowMs).toISOString(),
            }
          : {
              event: evType.replace("email.", ""),
              sg_message_id: msg.id,
              email: primaryTo,
              timestamp: Math.floor(nowMs / 1000),
            };
    const results = await ctx.webhooks.dispatch(ctx.state, hookService, evType, payload);
    for (const r of results) webhookIds.push(r.deliveryId);
  }

  return { webhookIds, chaosRuleId: storm?.rule.id };
}

export async function handleEmailRequest(
  ctx: ServiceContext,
  req: Request,
  url: URL,
): Promise<ServiceResult | null> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const match = /^\/email\/(resend|sendgrid|postmark|agentmail|smtp)(\/.*)?$/.exec(path);
  if (!match) return null;

  const provider = match[1] as EmailMessageRecord["provider"];
  const subPath = match[2] ?? "/";
  const nowMs = ctx.registry.clock.now();

  const rl = ctx.chaos.checkRateLimit(ctx.state.sessionId, provider, req.method, path, nowMs, EMAIL_RATE_LIMIT);
  const headers: Record<string, string> = {
    "x-rate-limit-limit": String(rl.result.limit),
    "x-rate-limit-remaining": String(rl.result.remaining),
    "x-rate-limit-reset": String(rl.result.resetAtSec),
    ...(rl.result.retryAfterSec > 0 ? { "retry-after": String(rl.result.retryAfterSec) } : {}),
  };
  const rateMeta = { limit: rl.result.limit, remaining: rl.result.remaining, resetAtSec: rl.result.resetAtSec };

  if (!rl.result.allowed) {
    return {
      service: provider,
      response: jsonResponse({ error: "rate_limit_exceeded", message: `${provider} rate limit exceeded` }, 429, headers),
      rateLimit: rateMeta,
      chaosApplied: rl.chaosRuleId,
    };
  }

  if (req.method !== "POST") {
    return { service: provider, response: jsonResponse({ error: "method_not_allowed" }, 405, headers), rateLimit: rateMeta };
  }

  const body = await parseJsonBody(req);
  const idempotencyKey = req.headers.get("idempotency-key")?.trim() || undefined;
  const bodyHash = sha256Hex(JSON.stringify(body));

  if (idempotencyKey) {
    const prev = ctx.state.emailIdempotency.get(`${provider}:${idempotencyKey}`);
    if (prev) {
      if (prev.bodyHash !== bodyHash) {
        return { service: provider, response: jsonResponse({ error: "idempotency_conflict" }, 409, headers), rateLimit: rateMeta };
      }
      return { service: provider, response: jsonResponse(prev.response, 200, headers), responseSummary: prev.response, rateLimit: rateMeta };
    }
  }

  let from = "ops@ntwrk.party";
  let to: string[] = [];
  let subject = "";
  let text = "";
  let html: string | undefined;

  if (provider === "resend" && subPath === "/emails") {
    from = strField(body, "from", "ops@ntwrk.party");
    to = Array.isArray(body.to) ? body.to.map(String) : typeof body.to === "string" ? [body.to] : [];
    subject = strField(body, "subject");
    text = strField(body, "text");
    html = strField(body, "html") || undefined;
  } else if (provider === "sendgrid" && subPath === "/v3/mail/send") {
    const fromObj = body.from as Record<string, unknown> | undefined;
    from = strField(fromObj ?? {}, "email", "ops@ntwrk.party");
    const pers = Array.isArray(body.personalizations) ? (body.personalizations as Array<Record<string, unknown>>) : [];
    for (const p of pers) {
      if (Array.isArray(p.to)) {
        for (const r of p.to as Array<Record<string, unknown>>) {
          if (typeof r.email === "string") to.push(r.email);
        }
      }
    }
    subject = strField(body, "subject");
    const contents = Array.isArray(body.content) ? (body.content as Array<Record<string, unknown>>) : [];
    text = strField(contents.find((c) => c.type === "text/plain") ?? contents[0] ?? {}, "value");
    html = strField(contents.find((c) => c.type === "text/html") ?? {}, "value") || undefined;
  } else if (provider === "postmark" && subPath === "/email") {
    from = strField(body, "From", "ops@ntwrk.party");
    const toRaw = strField(body, "To");
    to = toRaw ? toRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    subject = strField(body, "Subject");
    text = strField(body, "TextBody");
    html = strField(body, "HtmlBody") || undefined;
  } else if (provider === "agentmail" && /^\/v0\/inboxes\/[^/]+\/messages\/send$/.test(subPath)) {
    from = "agent@agentmail.to";
    const toRaw = body.to;
    to = Array.isArray(toRaw) ? toRaw.map(String) : typeof toRaw === "string" ? [toRaw] : [];
    subject = strField(body, "subject");
    text = strField(body, "text");
    html = strField(body, "html") || undefined;
  } else if (provider === "smtp" && (subPath === "/send" || subPath === "/")) {
    from = strField(body, "from", "ops@ntwrk.party");
    const toRaw = body.to;
    to = Array.isArray(toRaw) ? toRaw.map(String) : typeof toRaw === "string" ? [toRaw] : [];
    subject = strField(body, "subject");
    text = strField(body, "text");
    html = strField(body, "html") || undefined;
  } else {
    return { service: provider, response: jsonResponse({ error: `Unhandled ${provider} route ${subPath}` }, 404, headers), rateLimit: rateMeta };
  }

  if (to.length === 0) {
    return { service: provider, response: jsonResponse({ error: "recipient 'to' is required" }, 400, headers), rateLimit: rateMeta };
  }

  const id = ctx.registry.nextId(ctx.state, provider.slice(0, 2));
  const msg: EmailMessageRecord = {
    id,
    provider,
    from,
    to,
    subject,
    text,
    html,
    idempotencyKey,
    status: "sent",
    opened: false,
    clicked: false,
    createdAtMs: nowMs,
  };
  ctx.state.emailMessages.set(id, msg);

  const outcome = await processEmailOutcome(ctx, msg, path);

  let status = 200;
  let respBody: Record<string, unknown>;
  const extraHeaders: Record<string, string> = { ...headers };

  if (provider === "resend") {
    respBody = { id };
  } else if (provider === "sendgrid") {
    status = 202;
    extraHeaders["x-message-id"] = id;
    respBody = { message_id: id, status: "accepted" };
  } else if (provider === "postmark") {
    respBody = { To: to.join(", "), SubmittedAt: new Date(nowMs).toISOString(), MessageID: id, ErrorCode: 0, Message: "OK" };
  } else if (provider === "agentmail") {
    respBody = { message_id: id, id, status: msg.status };
  } else {
    respBody = { messageId: id, id, accepted: to };
  }

  if (idempotencyKey) {
    ctx.state.emailIdempotency.set(`${provider}:${idempotencyKey}`, { bodyHash, response: respBody });
  }

  return {
    service: provider,
    response: jsonResponse(respBody, status, extraHeaders),
    requestSummary: { from, toCount: to.length, subjectLen: subject.length },
    responseSummary: { id, status: msg.status, opened: msg.opened, clicked: msg.clicked },
    rateLimit: rateMeta,
    chaosApplied: outcome.chaosRuleId,
    ...(outcome.webhookIds.length ? { webhookTriggered: outcome.webhookIds } : {}),
  };
}
