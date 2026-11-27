import { DAY, type City, type NetworkEvent } from "@thenetwork/core";
import { publicEventCatalogFresh, publicEventFreshDays, publicEventWindowUsable } from "../../core/src/generated/publicEventCatalog.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";

interface CatalogRow {
  source: string; source_id: string; city: "nyc";
  source_url: string; title: string; venue: string; area: string; latitude: number; longitude: number;
  starts_at: Date; ends_at: Date; checked_at: Date; category: "events" | "hobby"; tags: string[];
}
interface ExternalCatalogRow {
  id: string; city: string; title: string; interest: string; description: string;
  external_url: string | null; start_at: Date; end_at: Date;
  venue_name: string; venue_area: string; lat: number; lon: number;
}
export async function lockPublicEventCatalog(tx: SQL): Promise<void> {
  await tx`select pg_advisory_xact_lock_shared(hashtext('thenetwork-public-events-nyc-parks'))`;
}
export async function readPublicEvents(sql: SQL, now: number, city?: string, eventId?: string): Promise<NetworkEvent[]> {
  const targetCity = city?.trim().toLowerCase() ?? "nyc";
  const eventKey = eventId?.match(/^([^:]+):([^:]+)$/u);
  if (eventId !== undefined && !eventKey) return [];
  const out: NetworkEvent[] = [];

  if (targetCity === "nyc" && (!eventKey || eventKey[1] !== "external")) {
    const rows = await sql<CatalogRow[]>`select p.*, source.checked_at from network.public_events p
      join network.public_event_imports source using (source)
      where p.city = 'nyc' and p.starts_at > ${new Date(now)} and source.checked_at > ${new Date(now - publicEventFreshDays * DAY)}
      ${eventKey ? sql`and p.source=${eventKey[1]!} and p.source_id=${eventKey[2]!}` : sql``}
      order by p.starts_at, p.source, p.source_id`;
    for (const row of rows) {
      const start = row.starts_at.getTime(), end = row.ends_at.getTime();
      if (!publicEventCatalogFresh(row.checked_at.getTime(), now) || !publicEventWindowUsable(now, start, end)) continue;
      out.push({
        id: `${row.source}:${row.source_id}`, title: row.title, city: row.city, area: row.area, start, end, tags: row.tags,
        category: row.category, listing: { lat: row.latitude, lng: row.longitude, venue: row.venue, url: row.source_url },
      });
    }
  }

  if (!eventKey || eventKey[1] === "external") {
    const extRows = await sql<ExternalCatalogRow[]>`select e.id, e.city, e.title, e.interest, e.description, e.external_url,
        e.start_at, e.end_at, v.name as venue_name, v.neighborhood as venue_area, v.lat, v.lon
      from platform.external_events e
      join platform.venues v on v.id = e.venue_id
      where e.city = ${targetCity}
        and e.status in ('published', 'active')
        and e.is_public = true
        and e.review_approved = true
        and e.confirmed_network_anchors >= 1
        and e.external_url is not null
        and e.start_at > ${new Date(now)}
        and v.status = 'active'
        and v.is_public = true
        ${eventKey ? sql`and e.id = ${eventKey[2]!}` : sql``}
      order by e.start_at, e.id`.catch(() => [] as ExternalCatalogRow[]);
    for (const row of extRows) {
      const start = row.start_at.getTime(), end = row.end_at.getTime();
      if (!publicEventWindowUsable(now, start, end) || !row.external_url) continue;
      out.push({
        id: `external:${row.id}`,
        title: row.title,
        description: row.description,
        city: row.city as City,
        area: row.venue_area,
        start,
        end,
        tags: ["18+", ...(row.interest ? [row.interest] : [])],
        category: "events",
        listing: { lat: Number(row.lat), lng: Number(row.lon), venue: row.venue_name, url: row.external_url },
      });
    }
  }

  return out;
}
