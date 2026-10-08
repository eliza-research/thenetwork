/**
 * Civic / venue calendars (GREEN):
 *  - nyc-parks: NYC Open Data dataset w3wp-dpdi "NYC Parks Public Events – Upcoming 14 Days" via the
 *    Socrata SODA API (no key needed at low volume; app token recommended for production).
 *  - sf-recpark: SF Recreation & Parks CivicPlus calendar RSS (RSSFeed.aspx?ModID=58).
 *  - sfpl: San Francisco Public Library /events listing (server-rendered HTML; robots-allowed).
 */
import type { NormalizedEvent } from "../types";
import { CITY_TZ, decodeEntities, num, stripTags, zonedToUtc } from "../util";

export function parseNycParks(rows: any[], fetchedAt: string): NormalizedEvent[] {
  const tz = CITY_TZ.nyc;
  return rows.map((r): NormalizedEvent => {
    const [lat, lng] = (r.coordinates ?? "").split(",").map((s: string) => num(s.trim()));
    const [sd, st] = (r.starttime ?? "").split("T");
    const startsAt = sd && st ? zonedToUtc(sd, st.slice(0, 5), tz) : null;
    const [ed, et] = (r.endtime ?? "").split("T");
    return {
      id: `nyc-parks:${r.guid}`,
      source: "nyc-parks",
      sourceId: String(r.guid),
      url: (r.link?.url ?? "").replace(/^http:/, "https:"),
      altUrls: [],
      title: decodeEntities(r.title ?? ""),
      startsAt,
      startDate: sd,
      hasTime: !!startsAt,
      endsAt: ed && et ? zonedToUtc(ed, et.slice(0, 5), tz) : null,
      timezone: tz,
      city: "nyc",
      venueName: r.location ?? r.parknames ?? null,
      address: r.parknames ?? null,
      lat: lat ?? null,
      lng: lng ?? null,
      price: null,
      categories: (r.categories ?? "").split("|").map((s: string) => s.trim().toLowerCase()).filter(Boolean),
      online: false,
      tos: "green",
      fetchedAt,
    };
  });
}

function to24h(h: number, m: number, ampm?: string) {
  if (ampm) {
    const pm = /p/i.test(ampm);
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parseSfRecPark(xml: string, fetchedAt: string): NormalizedEvent[] {
  const tz = CITY_TZ.sf;
  const out: NormalizedEvent[] = [];
  for (const it of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const g = (t: string) => it[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.trim() ?? "";
    const link = g("link");
    const dateStr = g("calendarEvent:EventDates");
    const d = new Date(dateStr + " 12:00 UTC");
    if (Number.isNaN(d.getTime())) continue;
    const date = d.toISOString().slice(0, 10);
    const tm = g("calendarEvent:EventTimes").match(/(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM))?/i);
    const startsAt = tm ? zonedToUtc(date, to24h(+tm[1], +tm[2], tm[3]), tz) : null;
    const endsAt = tm?.[4] ? zonedToUtc(date, to24h(+tm[4], +tm[5], tm[6]), tz) : null;
    out.push({
      id: `sf-recpark:${link.match(/EID=(\d+)/)?.[1] ?? link}`,
      source: "sf-recpark",
      sourceId: link.match(/EID=(\d+)/)?.[1] ?? link,
      url: link,
      altUrls: [],
      title: decodeEntities(g("title")),
      startsAt,
      startDate: date,
      hasTime: !!startsAt,
      endsAt,
      timezone: tz,
      city: "sf",
      venueName: null,
      address: stripTags(g("calendarEvent:Location").replace(/(\D)(San Francisco)/, "$1, $2")) || null,
      lat: null,
      lng: null,
      price: null,
      categories: ["parks"],
      online: false,
      tos: "green",
      fetchedAt,
    });
  }
  return out;
}

/** SFPL prints times without am/pm ("9:00 - 5:00"): library hours => 1-7 are pm, 8-11 am. */
function sfplHour(h: number) {
  return h >= 1 && h <= 7 ? h + 12 : h;
}

export function parseSfpl(html: string, fetchedAt: string): NormalizedEvent[] {
  const tz = CITY_TZ.sf;
  const out: NormalizedEvent[] = [];
  const parts = html.split(/<article about="\/events\//).slice(1);
  for (const p of parts) {
    const path = p.slice(0, p.indexOf('"'));
    const dm = p.match(/date-display-range">\w+, (\d{1,2})\/(\d{1,2})\/(\d{4}), (\d{1,2}):(\d{2})(?: - (\d{1,2}):(\d{2}))?/);
    if (!dm) continue;
    const date = `${dm[3]}-${dm[1].padStart(2, "0")}-${dm[2].padStart(2, "0")}`;
    const sh = sfplHour(+dm[4]);
    const startsAt = zonedToUtc(date, `${String(sh).padStart(2, "0")}:${dm[5]}`, tz);
    let endsAt: string | null = null;
    if (dm[6]) {
      let eh = sfplHour(+dm[6]);
      if (eh < sh) eh += 12;
      endsAt = zonedToUtc(date, `${String(eh % 24).padStart(2, "0")}:${dm[7]}`, tz);
    }
    const title = stripTags(p.match(/class="event__title">([\s\S]*?)<\/h2>/)?.[1] ?? "");
    const audience = [...(p.match(/event__audience">([\s\S]*?)<div class="event__meta/)?.[1] ?? "").matchAll(/hreflang="en">([^<]+)</g)].map((x) => decodeEntities(x[1]));
    const topics = [...(p.match(/event__topics">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/)?.[1] ?? "").matchAll(/hreflang="en">([^<]+)</g)].map((x) => decodeEntities(x[1]));
    const branch = stripTags(p.match(/field--name-field-short-name field__item">([^<]+)</)?.[1] ?? "") || null;
    out.push({
      id: `sfpl:${path}`,
      source: "sfpl",
      sourceId: path,
      url: `https://sfpl.org/events/${path}`,
      altUrls: [],
      title,
      startsAt,
      startDate: date,
      hasTime: true,
      endsAt,
      timezone: tz,
      city: "sf",
      venueName: branch ? `SFPL ${branch}` : "San Francisco Public Library",
      address: null,
      lat: null,
      lng: null,
      price: { min: 0, max: 0, currency: null, free: true },
      categories: [...audience.map((a) => "audience:" + a.toLowerCase()), ...topics.map((t) => t.toLowerCase())],
      online: /virtual|online/i.test(branch ?? "") ? true : false,
      tos: "green",
      fetchedAt,
    });
  }
  return out;
}
