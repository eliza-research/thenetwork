import { DAY, type NetworkEvent } from "@thenetwork/core";
import { publicEventCatalogFresh, publicEventFreshDays, publicEventWindowUsable } from "../../core/src/generated/publicEventCatalog.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";

interface CatalogRow {
  source: string; source_id: string; city: "nyc";
  source_url: string; title: string; venue: string; area: string; latitude: number; longitude: number;
  starts_at: Date; ends_at: Date; checked_at: Date; category: "events" | "hobby"; tags: string[];
}

/** The catalog is public and city-scoped. No app record, private feed or audit event is read here. */
export async function readPublicEvents(sql: SQL, now: number, city?: string): Promise<NetworkEvent[]> {
  if (city !== undefined && city !== "nyc") return [];
  const rows = await sql<CatalogRow[]>`select p.*, source.checked_at from network.public_events p
    join network.public_event_imports source using (source)
    where p.city = 'nyc' and p.starts_at > ${new Date(now)} and source.checked_at > ${new Date(now - publicEventFreshDays * DAY)}
    order by p.starts_at, p.source, p.source_id`;
  return rows.flatMap(row => {
    const start = row.starts_at.getTime(), end = row.ends_at.getTime();
    if (!publicEventCatalogFresh(row.checked_at.getTime(), now) || !publicEventWindowUsable(now, start, end)) return [];
    return [{
      id: `${row.source}:${row.source_id}`, title: row.title, city: row.city, area: row.area, start, end, tags: row.tags,
      category: row.category, listing: { lat: row.latitude, lng: row.longitude, venue: row.venue, url: row.source_url },
    }];
  });
}
