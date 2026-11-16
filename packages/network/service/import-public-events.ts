import { DAY, RealClock, type Clock } from "@thenetwork/core";
import { publicEventAllowed, publicEventPublicationNewer } from "../../core/src/generated/publicEventCatalog.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { km, NEIGHBORHOODS, VENUES } from "../src/geo.ts";

const SOURCE = "nyc-parks";
const FEED = "https://data.cityofnewyork.us/resource/w3wp-dpdi.json";
const MAX_ROWS = 5000;
const nyOffsets = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" });
const offsetAt = (at: number) => nyOffsets.formatToParts(at).find(part => part.type === "timeZoneName")!.value.slice(3);
const YOUTH = /\b(kids?|children|family|families|teens?|toddlers?|youth|junior|school-age|summer camps?)\b/iu;
const ONLINE = /\b(virtual|online|webinar)\b/iu;
const HOBBY = /\b(arts?|crafts?|dance|exercise|fitness|hiking|music|nature|sports?|yoga|pilates)\b/u;

interface PublishedParkEvent {
  source_id: string; source_url: string; title: string; venue: string; area: string; latitude: number; longitude: number;
  starts_at: string; ends_at: string; category: "events" | "hobby"; tags: string[];
}

function localTime(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?$/.test(value)) return undefined;
  const timestamp = value.includes(".") ? value : `${value}.000`;
  const civilAsUtc = Date.parse(`${timestamp}Z`);
  if (!Number.isFinite(civilAsUtc) || new Date(civilAsUtc).toISOString() !== `${timestamp}Z`) return undefined;
  const offsets = new Set([offsetAt(civilAsUtc - DAY), offsetAt(civilAsUtc + DAY)]);
  const candidates = [...offsets].map(offset => Date.parse(`${timestamp}${offset}`))
    .filter(at => Number.isFinite(at) && offsets.has(offsetAt(at)) && Date.parse(`${timestamp}${offsetAt(at)}`) === at);
  return candidates.length === 1 ? candidates[0] : undefined;
}

const text = (value: unknown): string => typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
function listingLink(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || !("url" in raw) || typeof raw.url !== "string") return undefined;
  const url = URL.parse(raw.url);
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port
    || !["nycgovparks.org", "www.nycgovparks.org"].includes(url.hostname)
    || !/^\/events\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?$/iu.test(url.pathname)) return undefined;
  return `https://www.nycgovparks.org${url.pathname}`;
}

function parkEvent(raw: unknown, checkedAt: number): PublishedParkEvent | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const id = typeof row.guid === "number" && Number.isSafeInteger(row.guid) ? String(row.guid) : text(row.guid);
  const link = listingLink(row.link);
  const start = localTime(row.starttime), end = localTime(row.endtime);
  const title = text(row.title);
  const venue = [...new Set([text(row.location), text(row.parknames)].filter(Boolean))].join(", ");
  const categories = text(row.categories).toLowerCase();
  const tags = [...new Set(categories.split("|").map(t => t.trim()).filter(t => t && t.length <= 60))].sort().slice(0, 20);
  const [lat = NaN, lng = NaN, ...extra] = text(row.coordinates).split(",").map(value => value.trim() ? Number(value) : NaN);
  const publicPlace = !extra.length && lat >= 40.47 && lat <= 40.92 && lng >= -74.27 && lng <= -73.68 && venue.length > 0 && venue.length <= 160;
  if (!/^\d{1,18}$/.test(id) || !link || start === undefined || end === undefined || !title || title.length > 160
    || !publicEventAllowed(true, publicPlace, ONLINE.test(`${title} ${venue} ${categories}`), YOUTH.test(`${title} ${categories}`), checkedAt, start, end)) return undefined;
  const position = { lat, lng };
  const names = [text(row.location).toLowerCase(), text(row.parknames).toLowerCase()];
  const area = VENUES.find(v => names.includes(v.name.toLowerCase()))?.neighborhood
    ?? NEIGHBORHOODS.reduce((a, b) => km(a, position) <= km(b, position) ? a : b).name;
  return {
    source_id: id, source_url: link, title, venue, area, latitude: lat, longitude: lng,
    starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), category: HOBBY.test(categories) ? "hobby" : "events", tags,
  };
}

/** Run one complete scan. The app never starts this job during request handling or a tick. */
export async function importPublicEvents(sql: SQL, clock: Clock, request: typeof fetch = fetch): Promise<{ published: boolean; events: number }> {
  const checkedAt = clock.now();
  const url = new URL(FEED);
  url.search = new URLSearchParams({
    $select: "guid,link,title,location,parknames,starttime,endtime,categories,coordinates",
    $limit: String(MAX_ROWS), $order: "guid",
  }).toString();
  const response = await request(url, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`NYC Parks feed returned HTTP ${response.status}`);
  const raw: unknown = await response.json();
  if (!Array.isArray(raw) || raw.length >= MAX_ROWS || (raw.length > 0 && !raw.some(row => row && "guid" in Object(row) && "starttime" in Object(row)))) {
    throw new Error("NYC Parks feed did not return a complete event listing");
  }
  const events = new Map<string, PublishedParkEvent>();
  for (const row of raw) {
    const event = parkEvent(row, checkedAt);
    if (event && !events.has(event.source_id)) events.set(event.source_id, event);
  }
  return sql.begin(async tx => {
    await tx`set local role network_public_event_ingest`;
    await tx`select pg_advisory_xact_lock(hashtext('thenetwork-public-events-nyc-parks'))`;
    const [previous] = await tx<{ checked_at: Date }[]>`select checked_at from network.public_event_imports where source = ${SOURCE}`;
    if (!publicEventPublicationNewer(previous !== undefined, previous?.checked_at.getTime() ?? 0, checkedAt)) return { published: false, events: 0 };
    await tx`insert into network.public_event_imports (source, checked_at) values (${SOURCE}, ${new Date(checkedAt)})
      on conflict (source) do update set checked_at = excluded.checked_at`;
    await tx`delete from network.public_events where source = ${SOURCE}`;
    if (events.size) await tx`insert into network.public_events (source, city, source_id, source_url, title, venue, area, latitude, longitude, starts_at, ends_at, category, tags)
      select ${SOURCE}, 'nyc', p.source_id, p.source_url, p.title, p.venue, p.area, p.latitude, p.longitude, p.starts_at, p.ends_at, p.category, p.tags
      from jsonb_to_recordset(${tx.json([...events.values()])}::jsonb) as p(source_id text, source_url text, title text, venue text, area text,
        latitude float8, longitude float8, starts_at timestamptz, ends_at timestamptz, category text, tags text[])`;
    return { published: true, events: events.size };
  });
}

if (import.meta.main) {
  const url = process.env.NETWORK_PUBLIC_EVENTS_DATABASE_URL;
  if (!url) throw new Error("Set NETWORK_PUBLIC_EVENTS_DATABASE_URL to the catalog ingest login URL");
  const sql = new SQL({ url, max: 1 });
  try { console.log(await importPublicEvents(sql, new RealClock())); }
  finally { await sql.close(); }
}
