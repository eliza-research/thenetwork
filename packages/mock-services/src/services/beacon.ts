import { jsonResponse, parseJsonBody, sha256Hex, strField, type ServiceContext, type ServiceResult } from "../http-helpers.ts";
import type { BeaconEventRecord, DubLinkRecord } from "../state.ts";

function sanitizeBeaconEvent(
  ctx: ServiceContext,
  raw: Record<string, unknown>,
): BeaconEventRecord {
  const nowMs = ctx.registry.clock.now();
  const id = ctx.registry.nextId(ctx.state, "bcn");
  const sessionSeed = strField(raw, "sessionHash") || strField(raw, "session_hash") || id;
  return {
    id,
    atMs: nowMs,
    brand: strField(raw, "brand", "ntwrk").toLowerCase(),
    city: strField(raw, "city", "nyc").toLowerCase(),
    event: strField(raw, "event", "page_view").toLowerCase(),
    path: strField(raw, "path", "/").slice(0, 200),
    referrer: strField(raw, "referrer", "direct").slice(0, 200),
    utmSource: strField(raw, "utmSource") || strField(raw, "utm_source") || "direct",
    utmCampaign: strField(raw, "utmCampaign") || strField(raw, "utm_campaign") || "",
    armId: strField(raw, "armId") || strField(raw, "arm_id") || "",
    qrBatchCode: strField(raw, "qrBatchCode") || strField(raw, "qr_batch_code") || "",
    desireLane: strField(raw, "desireLane") || strField(raw, "desire_lane") || "",
    sessionHash: sha256Hex(`${ctx.state.sessionId}:${sessionSeed}`).slice(0, 24),
    ...(strField(raw, "referrerCode") || strField(raw, "referrer_code")
      ? { referrerCode: strField(raw, "referrerCode") || strField(raw, "referrer_code") }
      : {}),
  };
}

export async function handleBeaconAndDubRequest(
  ctx: ServiceContext,
  req: Request,
  url: URL,
): Promise<ServiceResult | null> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const nowMs = ctx.registry.clock.now();

  if (path === "/beacon/v1/events" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const list = Array.isArray(body.events)
      ? (body.events as Array<Record<string, unknown>>)
      : [body];
    const accepted: BeaconEventRecord[] = [];
    for (const item of list.slice(0, 100)) {
      if (!item || typeof item !== "object") continue;
      if (item.minor === true || item.isMinor === true) continue;
      const ev = sanitizeBeaconEvent(ctx, item);
      ctx.state.beaconEvents.push(ev);
      accepted.push(ev);
    }
    if (ctx.state.beaconEvents.length > 50_000) {
      ctx.state.beaconEvents.splice(0, ctx.state.beaconEvents.length - 50_000);
    }
    return {
      service: "beacon",
      response: jsonResponse({ ok: true, accepted: accepted.length, ids: accepted.map((e) => e.id) }, 202),
      requestSummary: { count: list.length },
      responseSummary: { accepted: accepted.length },
    };
  }

  if (path === "/beacon/v1/query" && req.method === "GET") {
    const brand = url.searchParams.get("brand")?.toLowerCase();
    const city = url.searchParams.get("city")?.toLowerCase();
    const event = url.searchParams.get("event")?.toLowerCase();
    const utmCampaign = url.searchParams.get("utmCampaign") ?? url.searchParams.get("utm_campaign") ?? undefined;
    const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get("limit") ?? 500) || 500));

    const filtered = ctx.state.beaconEvents.filter(
      (e) =>
        (!brand || e.brand === brand) &&
        (!city || e.city === city) &&
        (!event || e.event === event) &&
        (!utmCampaign || e.utmCampaign === utmCampaign),
    );
    const byEvent: Record<string, number> = {};
    const byBrand: Record<string, number> = {};
    for (const e of filtered) {
      byEvent[e.event] = (byEvent[e.event] ?? 0) + 1;
      byBrand[e.brand] = (byBrand[e.brand] ?? 0) + 1;
    }
    return {
      service: "beacon",
      response: jsonResponse({
        total: filtered.length,
        byEvent,
        byBrand,
        events: filtered.slice(-limit),
      }),
      responseSummary: { total: filtered.length },
    };
  }

  if (path === "/ops/dub/links" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const destinationUrl = strField(body, "url");
    if (!destinationUrl) {
      return { service: "dub", response: jsonResponse({ error: "url is required" }, 400) };
    }
    const domain = strField(body, "domain", "go.ntwrk.party");
    const slug = strField(body, "key") || ctx.registry.nextId(ctx.state, "slug");
    const id = ctx.registry.nextId(ctx.state, "dub");
    const shortLink = `${ctx.baseUrl}/go/${encodeURIComponent(slug)}`;
    const link: DubLinkRecord = {
      id,
      domain,
      key: slug,
      shortLink,
      destinationUrl,
      externalId: strField(body, "externalId") || undefined,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      clicks: 0,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    };
    ctx.state.dubLinks.set(id, link);
    ctx.state.dubBySlug.set(slug, id);
    return {
      service: "dub",
      response: jsonResponse(link, 200),
      requestSummary: { slug, destinationUrl },
      responseSummary: { id, shortLink },
    };
  }

  const dubPatchMatch = /^\/ops\/dub\/links\/([^/]+)$/.exec(path);
  if (dubPatchMatch && req.method === "PATCH") {
    const id = decodeURIComponent(dubPatchMatch[1]!);
    const link = ctx.state.dubLinks.get(id);
    if (!link) {
      return { service: "dub", response: jsonResponse({ error: "link not found" }, 404) };
    }
    const body = await parseJsonBody(req);
    const nextUrl = strField(body, "url");
    if (nextUrl) link.destinationUrl = nextUrl;
    if (Array.isArray(body.tags)) link.tags = body.tags.map(String);
    link.updatedAtMs = nowMs;
    return {
      service: "dub",
      response: jsonResponse(link, 200),
      responseSummary: { id, destinationUrl: link.destinationUrl },
    };
  }

  const goMatch = /^\/go\/([^/]+)$/.exec(path);
  if (goMatch && req.method === "GET") {
    const slug = decodeURIComponent(goMatch[1]!);
    const id = ctx.state.dubBySlug.get(slug);
    const link = id ? ctx.state.dubLinks.get(id) : undefined;
    if (!link) {
      return { service: "dub", response: jsonResponse({ error: "shortlink not found" }, 404) };
    }
    link.clicks += 1;
    let brand = "ntwrk";
    let utmCampaign = "";
    let armId = "";
    let city = "nyc";
    try {
      const dest = new URL(link.destinationUrl);
      if (dest.hostname.includes("slop")) brand = "slop";
      else if (dest.hostname.includes("peon")) brand = "peon";
      else if (dest.hostname.includes("friends")) brand = "friends";
      utmCampaign = dest.searchParams.get("utm_campaign") ?? "";
      armId = dest.searchParams.get("arm_id") ?? "";
      city = dest.searchParams.get("city") ?? "nyc";
    } catch {
    }
    const ev = sanitizeBeaconEvent(ctx, {
      brand,
      city,
      event: "qr_scan",
      path: `/go/${slug}`,
      referrer: req.headers.get("referer") ?? "shortlink",
      utmSource: "dub_qr",
      utmCampaign,
      armId,
      qrBatchCode: slug,
    });
    ctx.state.beaconEvents.push(ev);
    return {
      service: "dub",
      response: new Response(null, {
        status: 302,
        headers: {
          location: link.destinationUrl,
          "cache-control": "no-store",
        },
      }),
      requestSummary: { slug },
      responseSummary: { location: link.destinationUrl, clicks: link.clicks, beaconId: ev.id },
    };
  }

  return null;
}
