import { jsonResponse, numField, parseFormBody, parseJsonBody, strField, type ServiceContext, type ServiceResult } from "../http-helpers.ts";

export async function handleOpsRequest(
  ctx: ServiceContext,
  req: Request,
  url: URL,
): Promise<ServiceResult | null> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const nowMs = ctx.registry.clock.now();

  if (path === "/turnstile/v0/siteverify" && req.method === "POST") {
    const form = await parseFormBody(req);
    const token = form.response ?? "";
    const forceFail = token === "fail" || token.startsWith("invalid_");
    const hostname = form.hostname || "ntwrk.party";
    const body = {
      success: !forceFail && token.length > 0,
      challenge_ts: new Date(nowMs).toISOString(),
      hostname,
      "error-codes": forceFail || !token ? ["invalid-input-response"] : [],
    };
    return {
      service: "turnstile",
      response: jsonResponse(body, 200),
      requestSummary: { hasToken: token.length > 0 },
      responseSummary: { success: body.success },
    };
  }

  if (!path.startsWith("/ops/")) return null;

  const idempotencyKey = req.headers.get("idempotency-key")?.trim() || undefined;
  if (idempotencyKey && req.method === "POST") {
    const cached = ctx.state.opsIdempotency.get(`${path}:${idempotencyKey}`);
    if (cached) {
      return {
        service: path.startsWith("/ops/luma/") ? "luma" : "ops",
        response: jsonResponse(cached, 200),
        responseSummary: { replayed: true },
      };
    }
  }

  if (path === "/ops/luma/public/v1/event/create" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const id = ctx.registry.nextId(ctx.state, "evt_luma");
    const rec = {
      api_id: id,
      id,
      name: strField(body, "name", "Community Gathering"),
      start_at: strField(body, "start_at", new Date(nowMs + 86_400_000).toISOString()),
      end_at: strField(body, "end_at", new Date(nowMs + 93_600_000).toISOString()),
      url: `https://lu.ma/${id}`,
    };
    ctx.state.opsRecords.set(id, { id, provider: "luma", kind: "event", idempotencyKey, payload: rec, createdAtMs: nowMs });
    if (idempotencyKey) ctx.state.opsIdempotency.set(`${path}:${idempotencyKey}`, rec);
    return { service: "luma", response: jsonResponse(rec, 200), responseSummary: { api_id: id } };
  }

  if (path === "/ops/luma/public/v1/event/rsvp" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const eventId = strField(body, "event_api_id") || strField(body, "event_id") || "evt_luma_1";
    const guestEmail = strField(body, "email", "guest@example.test");
    const guestName = strField(body, "name", "Sim Guest");
    const approvalStatus = strField(body, "approval_status", "approved");
    const webhookPayload = {
      type: "guest.registered",
      data: {
        api_id: ctx.registry.nextId(ctx.state, "gst"),
        event_api_id: eventId,
        user_email: guestEmail,
        user_name: guestName,
        approval_status: approvalStatus,
        registered_at: new Date(nowMs).toISOString(),
      },
    };
    const deliveries = await ctx.webhooks.dispatch(ctx.state, "luma", "guest.registered", webhookPayload);
    return {
      service: "luma",
      response: jsonResponse({ ok: true, deliveries: deliveries.length, data: webhookPayload.data }, 200),
      webhookTriggered: deliveries.map((d) => d.deliveryId),
    };
  }

  if (path === "/ops/rentahuman/api/mcp" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const rpcId = body.id ?? ctx.registry.nextId(ctx.state, "rpc");
    const method = strField(body, "method", "tools/call");
    const params = (body.params as Record<string, unknown> | undefined) ?? {};
    const toolName = strField(params, "name", "create_bounty");
    const bountyId = ctx.registry.nextId(ctx.state, "rah");
    const resp = {
      jsonrpc: "2.0",
      id: rpcId,
      result: {
        bounty_id: bountyId,
        tool: toolName,
        method,
        status: "open",
        created_at: new Date(nowMs).toISOString(),
      },
    };
    ctx.state.opsRecords.set(bountyId, { id: bountyId, provider: "rentahuman", kind: toolName, idempotencyKey, payload: body, createdAtMs: nowMs });
    if (idempotencyKey) ctx.state.opsIdempotency.set(`${path}:${idempotencyKey}`, resp);
    return { service: "ops", response: jsonResponse(resp, 200), responseSummary: { bounty_id: bountyId } };
  }

  if (path === "/ops/printful/orders" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const id = ctx.registry.nextId(ctx.state, "pf");
    const resp = { code: 200, result: { id, status: "draft", external_id: body.external_id ?? id } };
    ctx.state.opsRecords.set(id, { id, provider: "printful", kind: "print_order", idempotencyKey, payload: body, createdAtMs: nowMs });
    if (idempotencyKey) ctx.state.opsIdempotency.set(`${path}:${idempotencyKey}`, resp);
    return { service: "ops", response: jsonResponse(resp, 200), responseSummary: { id } };
  }

  if (path === "/ops/fourover/orders" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const id = ctx.registry.nextId(ctx.state, "fo");
    const resp = { order_id: id, id, status: "queued" };
    ctx.state.opsRecords.set(id, { id, provider: "fourover", kind: "print_order", idempotencyKey, payload: body, createdAtMs: nowMs });
    if (idempotencyKey) ctx.state.opsIdempotency.set(`${path}:${idempotencyKey}`, resp);
    return { service: "ops", response: jsonResponse(resp, 200), responseSummary: { order_id: id } };
  }

  if (path === "/ops/lob/v1/postcards" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const id = ctx.registry.nextId(ctx.state, "psc");
    const resp = { id, object: "postcard", expected_delivery_date: new Date(nowMs + 4 * 86_400_000).toISOString().slice(0, 10) };
    ctx.state.opsRecords.set(id, { id, provider: "lob", kind: "postcard", idempotencyKey, payload: body, createdAtMs: nowMs });
    if (idempotencyKey) ctx.state.opsIdempotency.set(`${path}:${idempotencyKey}`, resp);
    return { service: "ops", response: jsonResponse(resp, 200), responseSummary: { id } };
  }

  if (/^\/ops\/elevenlabs\/v1\/text-to-speech\/[^/]+$/.test(path) && req.method === "POST") {
    const body = await parseJsonBody(req);
    const text = strField(body, "text", "audio");
    const syntheticMp3 = Buffer.from(`ID3\x03\x00\x00\x00\x00\x00\x00MOCK_AUDIO:${text.slice(0, 64)}`);
    return {
      service: "ops",
      response: new Response(syntheticMp3, {
        status: 200,
        headers: { "content-type": "audio/mpeg", "content-length": String(syntheticMp3.byteLength) },
      }),
      responseSummary: { bytes: syntheticMp3.byteLength },
    };
  }

  if (path === "/ops/hedra/web-app/public/generations" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const id = ctx.registry.nextId(ctx.state, "hedra");
    const resp = { id, status: "queued", asset_url: `${ctx.baseUrl}/s3/sim-media/${id}.mp4` };
    ctx.state.opsRecords.set(id, { id, provider: "hedra", kind: "video", idempotencyKey, payload: body, createdAtMs: nowMs });
    if (idempotencyKey) ctx.state.opsIdempotency.set(`${path}:${idempotencyKey}`, resp);
    return { service: "ops", response: jsonResponse(resp, 200), responseSummary: { id } };
  }

  if (path === "/ops/kling/v1/videos/text2video" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const id = ctx.registry.nextId(ctx.state, "kling");
    const resp = { code: 0, message: "SUCCEED", data: { task_id: id, task_status: "submitted" } };
    ctx.state.opsRecords.set(id, { id, provider: "kling", kind: "video", idempotencyKey, payload: body, createdAtMs: nowMs });
    if (idempotencyKey) ctx.state.opsIdempotency.set(`${path}:${idempotencyKey}`, resp);
    return { service: "ops", response: jsonResponse(resp, 200), responseSummary: { task_id: id } };
  }

  if (path === "/ops/stripe/v1/transfers" && req.method === "POST") {
    const form = await parseFormBody(req);
    const id = ctx.registry.nextId(ctx.state, "tr");
    const amount = numField(form, "amount", 0);
    const resp = {
      id,
      object: "transfer",
      amount,
      currency: form.currency || "usd",
      destination: form.destination || "acct_mock",
      created: Math.floor(nowMs / 1000),
    };
    ctx.state.opsRecords.set(id, { id, provider: "stripe_connect", kind: "transfer", idempotencyKey, payload: resp, createdAtMs: nowMs });
    if (idempotencyKey) ctx.state.opsIdempotency.set(`${path}:${idempotencyKey}`, resp);
    return { service: "ops", response: jsonResponse(resp, 200), responseSummary: { id, amount } };
  }

  if (path === "/ops/tremendous/api/v2/orders" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const id = ctx.registry.nextId(ctx.state, "trm");
    const resp = { order: { id, external_id: body.external_id ?? id, status: "EXECUTED" } };
    ctx.state.opsRecords.set(id, { id, provider: "tremendous", kind: "payout", idempotencyKey, payload: body, createdAtMs: nowMs });
    if (idempotencyKey) ctx.state.opsIdempotency.set(`${path}:${idempotencyKey}`, resp);
    return { service: "ops", response: jsonResponse(resp, 200), responseSummary: { id } };
  }

  return null;
}
