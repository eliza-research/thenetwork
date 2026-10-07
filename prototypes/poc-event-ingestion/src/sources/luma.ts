/**
 * Luma. Two paths:
 *  - luma-discover (GREY): the JSON endpoint the public luma.com/{city} page itself calls
 *    (api.lu.ma/discover/get-paginated-events). robots.txt allows it, but it is not a documented
 *    interface; Luma ToS restricts reuse of "Site Content" except via "publicly supported interfaces".
 *  - luma-ics (GREEN): per-calendar ICS subscription feeds (the "Subscribe" button on every public
 *    Luma calendar). Calendar ids are harvested from the public city page.
 */
import { parseIcs } from "../ics";
import type { City, NormalizedEvent, Price } from "../types";
import { CITY_TZ, cityFromGeo, cityFromText, localDate, nextData, zonedToUtc } from "../util";

export const LUMA_PLACE_SLUG: Record<City, string> = { sf: "sf", nyc: "nyc" };

export function lumaPlaceIdFromHtml(html: string): string | null {
  return nextData(html)?.props?.pageProps?.initialData?.data?.place?.api_id ?? null;
}

function lumaPrice(ti: any): Price | null {
  if (!ti) return null;
  const cents = (p: any) => (p && typeof p.cents === "number" ? p.cents / 100 : null);
  return {
    min: ti.is_free ? 0 : cents(ti.price),
    max: ti.is_free ? 0 : cents(ti.max_price) ?? cents(ti.price),
    currency: ti.price?.currency?.toUpperCase?.() ?? (ti.is_free ? null : "USD"),
    free: ti.is_free ?? null,
  };
}

export function parseLumaDiscover(json: any, fetchedAt: string): NormalizedEvent[] {
  return (json.entries ?? []).map((en: any): NormalizedEvent => {
    const ev = en.event;
    const lat = ev.coordinate?.latitude ?? null;
    const lng = ev.coordinate?.longitude ?? null;
    const geo = ev.geo_address_info ?? {};
    const tz = ev.timezone ?? "UTC";
    return {
      id: `luma-discover:${ev.api_id}`,
      source: "luma-discover",
      sourceId: ev.api_id,
      url: `https://luma.com/${ev.url}`,
      altUrls: [`https://luma.com/event/${ev.api_id}`],
      title: ev.name,
      startsAt: new Date(ev.start_at).toISOString(),
      startDate: localDate(ev.start_at, tz),
      hasTime: true,
      endsAt: ev.end_at ? new Date(ev.end_at).toISOString() : null,
      timezone: tz,
      city: cityFromGeo(lat, lng) ?? cityFromText(geo.city),
      venueName: geo.address ?? null, // exact address is often "guests-only"; only sublocality is public
      address: geo.full_address ?? (geo.sublocality ? `${geo.sublocality}, ${geo.city_state}` : geo.city_state ?? null),
      lat,
      lng,
      price: lumaPrice(en.ticket_info),
      categories: [],
      online: ev.location_type === "online" ? true : ev.location_type === "offline" ? false : null,
      tos: "grey",
      fetchedAt,
    };
  });
}

/** Distinct public calendar ids seen on a city's discover results (for ICS subscription). */
export function lumaCalendarIds(json: any): { id: string; name: string; slug: string | null; n: number }[] {
  const m = new Map<string, { id: string; name: string; slug: string | null; n: number }>();
  for (const en of json.entries ?? []) {
    const c = en.calendar;
    if (!c?.api_id || c.access_level !== "public") continue;
    const cur = m.get(c.api_id) ?? { id: c.api_id, name: c.name, slug: c.slug ?? null, n: 0 };
    cur.n++;
    m.set(c.api_id, cur);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

export function parseLumaIcs(text: string, fetchedAt: string): NormalizedEvent[] {
  return parseIcs(text, zonedToUtc).map((v): NormalizedEvent => {
    const apiId = v.uid.split("@")[0];
    const urlMatch = v.description.match(/https:\/\/luma\.com\/[^\s\\]+/);
    const addrBlock = v.description.match(/Address:\n((?:[^\n]+\n?){1,4}?)(?:\n|$)/)?.[1]?.trim() ?? "";
    const hidden = !addrBlock || /check event page/i.test(addrBlock);
    const locIsUrl = v.location.startsWith("http");
    const venueName = hidden ? null : addrBlock.split("\n")[0];
    const address = !locIsUrl && v.location ? v.location : hidden ? null : addrBlock.replace(/\n/g, ", ");
    const city = cityFromGeo(v.geo?.[0] ?? null, v.geo?.[1] ?? null) ?? cityFromText(address);
    const tz = city ? CITY_TZ[city] : "UTC";
    const startIso = v.start.iso;
    return {
      id: `luma-ics:${apiId}`,
      source: "luma-ics",
      sourceId: apiId,
      url: urlMatch?.[0] ?? v.location,
      altUrls: [v.location].filter((u) => u.startsWith("http")),
      title: v.summary,
      startsAt: startIso,
      startDate: startIso ? localDate(startIso, tz) : v.start.date,
      hasTime: !v.start.dateOnly,
      endsAt: v.end?.iso ?? null,
      timezone: tz,
      city,
      venueName,
      address,
      lat: v.geo?.[0] ?? null,
      lng: v.geo?.[1] ?? null,
      price: null,
      categories: [],
      online: /zoom\.us|meet\.google|virtual|online/i.test(v.location + addrBlock) ? true : null,
      tos: "green",
      fetchedAt,
    };
  });
}
