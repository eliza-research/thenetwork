/**
 * Cerebral Valley (GREEN). robots.txt allows public pages (only /api/, /auth/ disallowed) and
 * llms.txt explicitly offers https://cerebralvalley.ai/llms-full.txt "for agents that want the whole
 * site in one fetch": every upcoming event in the next 30 days, date + city + outbound URL.
 * City pages (/events/{city}) additionally carry schema.org ItemList JSON-LD with exact times.
 */
import type { City, NormalizedEvent } from "../types";
import { CITY_TZ, cityFromText, jsonLd, localDate } from "../util";

const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

function slugOrUrl(url: string) {
  const m = url.match(/cerebralvalley\.ai\/e\/([^/?#]+)/);
  return m ? m[1] : url;
}

/** Parse the "Upcoming events" section of llms-full.txt. */
export function parseCvLlmsFull(text: string, fetchedAt: string): NormalizedEvent[] {
  const start = text.indexOf("## Upcoming events");
  const end = text.indexOf("\n## ", start + 5);
  const section = text.slice(start, end > 0 ? end : undefined);
  const out: NormalizedEvent[] = [];
  const re = /^- \w{3}, (\w{3}) (\d{1,2}), (\d{4}) – \[(.+?)\]\((\S+?)\) – (.+?) – /gm;
  for (const m of section.matchAll(re)) {
    const [, mon, day, year, title, url, where] = m;
    const placeAndType = where.split(" · ");
    const place = placeAndType[0];
    const city = cityFromText(place);
    const date = `${year}-${String(MONTHS[mon]).padStart(2, "0")}-${day.padStart(2, "0")}`;
    out.push({
      id: `cerebral-valley:${slugOrUrl(url)}`,
      source: "cerebral-valley",
      sourceId: slugOrUrl(url),
      url,
      altUrls: url.includes("cerebralvalley.ai") ? [] : [url],
      title,
      startsAt: null,
      startDate: date,
      hasTime: false,
      endsAt: null,
      timezone: city ? CITY_TZ[city] : "UTC",
      city,
      venueName: null,
      address: place,
      lat: null,
      lng: null,
      price: null,
      categories: ["ai", ...placeAndType.slice(1).map((s) => s.toLowerCase())],
      online: /remote/i.test(place) ? true : null,
      tos: "green",
      fetchedAt,
    });
  }
  return out;
}

/** Parse a CV city page's ItemList JSON-LD (exact start times, 20 items). */
export function parseCvCityPage(html: string, cityHint: City, fetchedAt: string): NormalizedEvent[] {
  const list = jsonLd(html).find((o) => o["@type"] === "ItemList");
  return (list?.itemListElement ?? []).map((li: any): NormalizedEvent => {
    const it = li.item;
    const addr = it.location?.address ?? {};
    const city = cityFromText(addr.addressLocality) ?? cityHint;
    const tz = CITY_TZ[city];
    return {
      id: `cerebral-valley:${slugOrUrl(it.url)}`,
      source: "cerebral-valley",
      sourceId: slugOrUrl(it.url),
      url: it.url,
      altUrls: it.url.includes("cerebralvalley.ai") ? [] : [it.url],
      title: it.name,
      startsAt: it.startDate ? new Date(it.startDate).toISOString() : null,
      startDate: it.startDate ? localDate(it.startDate, tz) : "",
      hasTime: !!it.startDate && it.startDate.includes("T"),
      endsAt: it.endDate ? new Date(it.endDate).toISOString() : null,
      timezone: tz,
      city,
      venueName: it.location?.name && !/, [A-Z]{2}$/.test(it.location.name) ? it.location.name : null,
      address: [addr.streetAddress, addr.addressLocality].filter(Boolean).join(", ") || null,
      lat: it.location?.geo?.latitude ?? null,
      lng: it.location?.geo?.longitude ?? null,
      price: null,
      categories: ["ai", ...[].concat(it["@type"]).filter((t: string) => t !== "Event").map((t: string) => t.toLowerCase())],
      online: it.eventAttendanceMode?.includes("Online") ?? null,
      tos: "green",
      fetchedAt,
    };
  });
}
