/**
 * Parsers for sources whose Terms of Service forbid automated extraction (RESTRICTED).
 * They exist ONLY to (a) read the single probe page per city captured during the terms review and
 * (b) be ready if a data partnership / licensed API grants access. Production jobs must not call them
 * against live pages.
 *   - Eventbrite ToS: "you agree not to, scrape, crawl, or employ any automated means to extract data
 *     from the Sites." Public v3 search API was removed (returns 404); API ToS forbids competing uses.
 *   - Meetup ToS: no extraction "for a commercial purpose not permitted by these Terms ... (web scraping)".
 *     The GraphQL API needs OAuth + a Meetup Pro subscription.
 *   - Partiful ToS: no "data mining, robots, scraping, or similar data gathering". No public discovery
 *     beyond ~5 "trending" picks per city on /explore.
 */
import type { City, NormalizedEvent } from "../types";
import { CITY_TZ, cityFromGeo, cityFromText, jsonLd, localDate, nextData, num, zonedToUtc } from "../util";

export function parseEventbriteBrowse(html: string, fetchedAt: string): { events: NormalizedEvent[]; total: number | null } {
  const i = html.indexOf("__SERVER_DATA__ = ");
  if (i < 0) return { events: [], total: null };
  const json = (() => {
    // raw_decode equivalent: find the matching closing brace
    const s = html.slice(i + "__SERVER_DATA__ = ".length);
    let depth = 0, inStr = false, esc = false;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return JSON.parse(s.slice(0, k + 1));
    }
    return null;
  })();
  const ev = json?.search_data?.events;
  const events = (ev?.results ?? []).map((r: any): NormalizedEvent => {
    const a = r.primary_venue?.address ?? {};
    const lat = num(a.latitude), lng = num(a.longitude);
    const tz = r.timezone ?? "UTC";
    const startsAt = r.start_date && r.start_time ? zonedToUtc(r.start_date, r.start_time, tz) : null;
    const tp = r.ticket_availability;
    return {
      id: `eventbrite:${r.id}`,
      source: "eventbrite",
      sourceId: String(r.id),
      url: r.url,
      altUrls: [],
      title: r.name,
      startsAt,
      startDate: r.start_date,
      hasTime: !!startsAt,
      endsAt: r.end_date && r.end_time ? zonedToUtc(r.end_date, r.end_time, tz) : null,
      timezone: tz,
      city: cityFromGeo(lat, lng) ?? cityFromText(a.city),
      venueName: r.primary_venue?.name ?? null,
      address: a.localized_address_display ?? null,
      lat, lng,
      price: tp ? { min: num(tp.minimum_ticket_price?.major_value), max: num(tp.maximum_ticket_price?.major_value), currency: tp.minimum_ticket_price?.currency ?? null, free: tp.is_free ?? null } : null,
      categories: (r.tags ?? []).filter((t: any) => /^Eventbrite(Category|Format)$/.test(t.prefix)).map((t: any) => t.display_name.toLowerCase()),
      online: r.is_online_event ?? null,
      tos: "restricted",
      fetchedAt,
    };
  });
  return { events, total: ev?.pagination?.object_count ?? null };
}

export function parseMeetupFind(html: string, fetchedAt: string): NormalizedEvent[] {
  return jsonLd(html).filter((o) => o["@type"] === "Event").map((o): NormalizedEvent => {
    const loc = o.location ?? {};
    const lat = num(loc.geo?.latitude), lng = num(loc.geo?.longitude);
    const city = cityFromGeo(lat, lng) ?? cityFromText(loc.address?.addressLocality);
    const tz = city ? CITY_TZ[city] : "UTC";
    const id = (o.url ?? "").match(/events\/(\d+)/)?.[1] ?? o.url;
    const offer = [].concat(o.offers ?? [])[0] as any;
    return {
      id: `meetup:${id}`,
      source: "meetup",
      sourceId: id,
      url: o.url,
      altUrls: [],
      title: o.name,
      startsAt: o.startDate ? new Date(o.startDate).toISOString() : null,
      startDate: o.startDate ? localDate(o.startDate, tz) : "",
      hasTime: !!o.startDate,
      endsAt: o.endDate ? new Date(o.endDate).toISOString() : null,
      timezone: tz,
      city,
      venueName: loc.name ?? null,
      address: [loc.address?.streetAddress, loc.address?.addressLocality].filter(Boolean).join(", ") || null,
      lat, lng,
      price: offer ? { min: num(offer.price), max: num(offer.price), currency: offer.priceCurrency ?? null, free: num(offer.price) === 0 } : null,
      categories: [],
      online: o.eventAttendanceMode?.includes("Online") ?? null,
      tos: "restricted",
      fetchedAt,
    };
  });
}

export function parsePartifulExplore(html: string, fetchedAt: string): NormalizedEvent[] {
  const secs = nextData(html)?.props?.pageProps?.trendingSections ?? {};
  const out: NormalizedEvent[] = [];
  for (const [region, sec] of Object.entries<any>(secs)) {
    const city: City | null = region === "SF" ? "sf" : region === "NYC" ? "nyc" : null;
    if (!city) continue;
    for (const it of sec.items ?? []) {
      const e = it.event;
      if (!e) continue;
      const m = e.locationInfo?.mapsInfo;
      out.push({
        id: `partiful:${e.id}`,
        source: "partiful",
        sourceId: e.id,
        url: `https://partiful.com/e/${e.id}`,
        altUrls: [],
        title: e.title,
        startsAt: e.startDate ? new Date(e.startDate).toISOString() : null,
        startDate: e.startDate ? localDate(e.startDate, e.timezone ?? CITY_TZ[city]) : "",
        hasTime: !!e.startDate,
        endsAt: e.endDate ? new Date(e.endDate).toISOString() : null,
        timezone: e.timezone ?? CITY_TZ[city],
        city,
        venueName: m?.name ?? null,
        address: m?.addressLines?.join(", ") ?? null,
        lat: null, lng: null,
        price: null,
        categories: [],
        online: null,
        tos: "restricted",
        fetchedAt,
      });
    }
  }
  return out;
}
