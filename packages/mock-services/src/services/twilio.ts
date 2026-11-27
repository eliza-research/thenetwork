import { jsonResponse, parseFormBody, type ServiceContext, type ServiceResult } from "../http-helpers.ts";

const TWILIO_RATE_LIMIT = { limit: 100, windowMs: 60_000 };

function classifyPhoneLine(phone: string): { lineType: string; carrierName: string; riskScore: number } {
  const digits = phone.replace(/\D/g, "");
  if (digits.endsWith("0000") || digits.includes("55509")) {
    return { lineType: "nonFixedVoip", carrierName: "TextNow / VoIP", riskScore: 92 };
  }
  if (digits.endsWith("0001") || digits.includes("55508")) {
    return { lineType: "mobile", carrierName: "Mint Mobile MVNO", riskScore: 38 };
  }
  if (digits.endsWith("0002")) {
    return { lineType: "landline", carrierName: "Verizon Wireline", riskScore: 15 };
  }
  return { lineType: "mobile", carrierName: "AT&T Mobility", riskScore: 8 };
}

export async function handleTwilioRequest(
  ctx: ServiceContext,
  req: Request,
  url: URL,
): Promise<ServiceResult | null> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (!path.startsWith("/twilio/")) return null;

  const nowMs = ctx.registry.clock.now();
  const rl = ctx.chaos.checkRateLimit(ctx.state.sessionId, "twilio", req.method, path, nowMs, TWILIO_RATE_LIMIT);
  const headers: Record<string, string> = {
    "x-rate-limit-limit": String(rl.result.limit),
    "x-rate-limit-remaining": String(rl.result.remaining),
    "x-rate-limit-reset": String(rl.result.resetAtSec),
    ...(rl.result.retryAfterSec > 0 ? { "retry-after": String(rl.result.retryAfterSec) } : {}),
  };
  const rateMeta = { limit: rl.result.limit, remaining: rl.result.remaining, resetAtSec: rl.result.resetAtSec };

  if (!rl.result.allowed) {
    return {
      service: "twilio",
      response: jsonResponse({ code: 20429, message: "Too Many Requests" }, 429, headers),
      rateLimit: rateMeta,
      chaosApplied: rl.chaosRuleId,
    };
  }

  const lookupMatch = /^\/twilio\/lookups\/v2\/PhoneNumbers\/([^/]+)$/.exec(path);
  if (req.method === "GET" && lookupMatch) {
    const phone = decodeURIComponent(lookupMatch[1]!);
    const info = classifyPhoneLine(phone);
    const body = {
      phone_number: phone,
      valid: /^\+[1-9]\d{6,14}$/.test(phone),
      country_code: "US",
      line_type_intelligence: {
        type: info.lineType,
        carrier_name: info.carrierName,
        error_code: null,
      },
      sms_pumping_risk: {
        carrier_risk_category: info.riskScore >= 70 ? "high" : info.riskScore >= 30 ? "medium" : "low",
        sms_pumping_risk_score: info.riskScore,
        number_blocked: info.riskScore >= 90,
      },
    };
    return {
      service: "twilio",
      response: jsonResponse(body, 200, headers),
      requestSummary: { phone },
      responseSummary: { lineType: info.lineType, riskScore: info.riskScore },
      rateLimit: rateMeta,
    };
  }

  const msgMatch = /^\/twilio\/2010-04-01\/Accounts\/([^/]+)\/Messages\.json$/.exec(path);
  if (req.method === "POST" && msgMatch) {
    const form = await parseFormBody(req);
    const to = form.To ?? "";
    const from = form.From ?? "";
    const bodyText = form.Body ?? "";
    if (!to || !from) {
      return { service: "twilio", response: jsonResponse({ code: 21211, message: "To and From are required" }, 400, headers), rateLimit: rateMeta };
    }
    const sid = ctx.registry.nextId(ctx.state, "SM");
    const rec = {
      sid,
      account_sid: msgMatch[1],
      to,
      from,
      body: bodyText,
      status: "queued",
      date_created: new Date(nowMs).toUTCString(),
    };
    ctx.state.twilioMessages.push(rec);
    return {
      service: "twilio",
      response: jsonResponse(rec, 201, headers),
      requestSummary: { to, from, bodyLen: bodyText.length },
      responseSummary: { sid, status: "queued" },
      rateLimit: rateMeta,
    };
  }

  const callMatch = /^\/twilio\/2010-04-01\/Accounts\/([^/]+)\/Calls\.json$/.exec(path);
  if (req.method === "POST" && callMatch) {
    const form = await parseFormBody(req);
    const to = form.To ?? "";
    const from = form.From ?? "";
    if (!to || !from) {
      return { service: "twilio", response: jsonResponse({ code: 21211, message: "To and From are required" }, 400, headers), rateLimit: rateMeta };
    }
    const sid = ctx.registry.nextId(ctx.state, "CA");
    const rec = {
      sid,
      account_sid: callMatch[1],
      to,
      from,
      status: "queued",
      date_created: new Date(nowMs).toUTCString(),
    };
    ctx.state.twilioCalls.push(rec);
    return {
      service: "twilio",
      response: jsonResponse(rec, 201, headers),
      requestSummary: { to, from },
      responseSummary: { sid, status: "queued" },
      rateLimit: rateMeta,
    };
  }

  return {
    service: "twilio",
    response: jsonResponse({ code: 20404, message: `Unhandled Twilio route ${req.method} ${path}` }, 404, headers),
    rateLimit: rateMeta,
  };
}
