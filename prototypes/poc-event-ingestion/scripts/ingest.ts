/**
 * Live ingestion run for SF + NYC, next 7 days. Polite: robots.txt checked per URL, <=1 req/s/host.
 * Restricted sources (Eventbrite, Meetup, Partiful) are NOT fetched here; their single probe page
 * per city (captured during the terms review) is parsed from RAW_DIR if present, for measurement only.
 *
 *   RAW_DIR=/path/to/cache bun run scripts/ingest.ts
 */
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { politeFetch, fetchLog, RobotsDisallowed } from "../src/http";
import { parseLumaDiscover, parseLumaIcs, lumaCalendarIds, lumaPlaceIdFromHtml } from "../src/sources/luma";
import { parseCvLlmsFull, parseCvCityPage } from "../src/sources/cerebral-valley";
import { parseNycParks, parseSfRecPark, parseSfpl } from "../src/sources/civic";
import { parseEventbriteBrowse, parseMeetupFind, parsePartifulExplore } from "../src/sources/restricted";
import type { City, NormalizedEvent } from "../src/types";
import { inWindow } from "../src/util";

const RAW = process.env.RAW_DIR ?? "data/raw";
mkdirSync(RAW, { recursive: true });
mkdirSync("data", { recursive: true });
const now = new Date();
const from = now.toISOString();
const to = new Date(now.getTime() + 7 * 86400_000).toISOString();
const fetchedAt = from;
const notes: Record<string, string[]> = {};
const note = (src: string, msg: string) => ((notes[src] ??= []).push(msg), console.log(`[${src}] ${msg}`));
const all: NormalizedEvent[] = [];

async function get(url: string, src: string, init?: RequestInit): Promise<string | null> {
  try {
    const r = await politeFetch(url, init);
    if (!r.ok) { note(src, `HTTP ${r.status} for ${url}`); return null; }
    return await r.text();
  } catch (e) {
    note(src, e instanceof RobotsDisallowed ? `robots disallow ${url}` : `error ${url}: ${e}`);
    return null;
  }
}
const save = (name: string, body: string) => Bun.write(`${RAW}/${name}`, body);

// ---------- Luma ----------
const lumaCalendars: Record<City, ReturnType<typeof lumaCalendarIds>> = { sf: [], nyc: [] };
for (const city of ["sf", "nyc"] as City[]) {
  const html = await get(`https://luma.com/${city}`, "luma-discover");
  const placeId = html ? lumaPlaceIdFromHtml(html) : null;
  if (!placeId) { note("luma-discover", `no place id for ${city}`); continue; }
  let cursor: string | null = null;
  const entries: any[] = [];
  for (let page = 0; page < 10; page++) {
    const u = `https://api.lu.ma/discover/get-paginated-events?discover_place_api_id=${placeId}&pagination_limit=50${cursor ? `&pagination_cursor=${cursor}` : ""}`;
    const body = await get(u, "luma-discover");
    if (!body) break;
    const j = JSON.parse(body);
    if (page === 0) await save(`luma-discover-${city}-p0.json`, body);
    entries.push(...j.entries);
    const last = j.entries.at(-1)?.event?.start_at;
    if (!j.has_more || !last || last >= to) break;
    cursor = j.next_cursor;
  }
  const evs = parseLumaDiscover({ entries }, fetchedAt);
  note("luma-discover", `${city}: ${entries.length} entries over ${Math.ceil(entries.length / 50)} pages`);
  all.push(...evs);
  lumaCalendars[city] = lumaCalendarIds({ entries });
}

// Luma ICS: subscribe to the public calendars seen on each city page (all distinct public calendars, capped at 60).
const icsSeen = new Set<string>();
for (const city of ["sf", "nyc"] as City[]) {
  let n = 0;
  for (const cal of lumaCalendars[city].slice(0, 60)) {
    if (icsSeen.has(cal.id)) continue;
    icsSeen.add(cal.id);
    const body = await get(`https://api.lu.ma/ics/get?entity=calendar&id=${cal.id}`, "luma-ics");
    if (!body) continue;
    if (n === 0) await save(`luma-ics-${city}-${cal.id}.ics`, body);
    const evs = parseLumaIcs(body, fetchedAt);
    // ICS often hides the address ("Check event page"); use the calendar's discover city as a hint only when the
    // same event id was seen on that city's discover page.
    const discoverCity = new Map(all.filter((e) => e.source === "luma-discover").map((e) => [e.sourceId, e.city]));
    for (const e of evs) if (!e.city && discoverCity.has(e.sourceId)) e.city = discoverCity.get(e.sourceId)!;
    all.push(...evs);
    n++;
  }
  note("luma-ics", `${city}: fetched ${n} calendar feeds`);
}

// ---------- Cerebral Valley ----------
{
  const txt = await get("https://cerebralvalley.ai/llms-full.txt", "cerebral-valley");
  if (txt) {
    await save("cv-llms-full.txt", txt);
    const evs = parseCvLlmsFull(txt, fetchedAt);
    note("cerebral-valley", `llms-full.txt: ${evs.length} listings (all cities, next 30 days)`);
    all.push(...evs);
  }
  for (const [city, slug] of [["sf", "san-francisco"], ["nyc", "new-york"]] as [City, string][]) {
    const html = await get(`https://cerebralvalley.ai/events/${slug}`, "cerebral-valley");
    if (html) {
      await save(`cv-${city}.html`, html);
      all.push(...parseCvCityPage(html, city, fetchedAt));
    }
  }
}

// ---------- NYC Parks (Socrata SODA) ----------
{
  const where = encodeURIComponent(`starttime >= '${from.slice(0, 19)}' AND starttime < '${to.slice(0, 19)}'`);
  const body = await get(`https://data.cityofnewyork.us/resource/w3wp-dpdi.json?$limit=5000&$where=${where}`, "nyc-parks");
  if (body) {
    const rows = JSON.parse(body);
    await save("nyc-parks.json", body);
    note("nyc-parks", `${rows.length} rows`);
    all.push(...parseNycParks(rows, fetchedAt));
  }
}

// ---------- SF Rec & Park (CivicPlus RSS) ----------
{
  const body = await get("https://sfrecpark.org/RSSFeed.aspx?ModID=58&CID=All-calendar.xml", "sf-recpark");
  if (body) {
    await save("sf-recpark.xml", body);
    const evs = parseSfRecPark(body, fetchedAt);
    note("sf-recpark", `${evs.length} items`);
    all.push(...evs);
  }
}

// ---------- SFPL ----------
{
  let total = 0;
  for (let page = 0; page < 45; page++) {
    const html = await get(`https://sfpl.org/events?page=${page}`, "sfpl");
    if (!html) break;
    if (page === 0) await save("sfpl-p0.html", html);
    const evs = parseSfpl(html, fetchedAt);
    total += evs.length;
    all.push(...evs);
    if (!evs.length || evs.every((e) => e.startsAt! >= to)) break;
  }
  note("sfpl", `${total} rows parsed`);
}

// ---------- Restricted (probe pages only, no new fetches) ----------
const restricted: NormalizedEvent[] = [];
const probe = process.env.PROBE_DIR;
if (probe) {
  const rd = (f: string) => (existsSync(`${probe}/${f}`) ? readFileSync(`${probe}/${f}`, "utf8") : null);
  for (const f of ["www_eventbrite_com_d_ca_san_francisco_events_this_week_", "www_eventbrite_com_d_ca_san_francisco_events_this_week_page_2", "www_eventbrite_com_d_ny_new_york_events_this_week_"]) {
    const h = rd(f);
    if (h) { const r = parseEventbriteBrowse(h, fetchedAt); restricted.push(...r.events); note("eventbrite", `${f}: ${r.events.length} rows; site reports ${r.total} events this week`); }
  }
  for (const f of ["www_meetup_com_find_us_ca_san_francisco_", "www_meetup_com_find_us_ny_new_york_"]) {
    const h = rd(f);
    if (h) { const evs = parseMeetupFind(h, fetchedAt); restricted.push(...evs); note("meetup", `${f}: ${evs.length} JSON-LD events`); }
  }
  const p = rd("partiful_com_explore");
  if (p) { const evs = parsePartifulExplore(p, fetchedAt); restricted.push(...evs); note("partiful", `explore: ${evs.length} trending events (SF+NYC)`); }
}

// ---------- window + report ----------
const inWin = (e: NormalizedEvent) => e.city && inWindow(e, from, to);
const rows = all.filter(inWin);
const rrows = restricted.filter(inWin);
await Bun.write("data/events.json", JSON.stringify({ from, to, events: rows, restricted: rrows }, null, 1));
await Bun.write("data/fetch-log.json", JSON.stringify({ notes, fetchLog }, null, 1));
const table: Record<string, Record<string, number>> = {};
for (const e of [...rows, ...rrows]) ((table[e.source] ??= { sf: 0, nyc: 0 })[e.city!]++);
console.log(`window ${from} .. ${to}`);
console.table(table);
console.log(`requests: ${fetchLog.length}`);
