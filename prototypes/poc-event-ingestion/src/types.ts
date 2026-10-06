export type City = "sf" | "nyc";
export type SourceName =
  | "luma-discover"
  | "luma-ics"
  | "cerebral-valley"
  | "nyc-parks"
  | "sf-recpark"
  | "sfpl"
  | "eventbrite"
  | "meetup"
  | "partiful";

/** green = public feed/API offered for this use; grey = public & robots-allowed but not an advertised interface; restricted = ToS forbids automated extraction. */
export type TosStatus = "green" | "grey" | "restricted";

export interface Price {
  min: number | null;
  max: number | null;
  currency: string | null;
  free: boolean | null;
}

/** One normalized event row (P14 "normalized events table", minimal metadata + link back). */
export interface NormalizedEvent {
  id: string; // `${source}:${sourceId}`
  source: SourceName;
  sourceId: string;
  url: string; // canonical link back to the source page
  altUrls: string[]; // other URLs this listing points to (e.g. a CV listing that links to Luma)
  title: string;
  startsAt: string | null; // ISO-8601 UTC when a time is known
  startDate: string; // YYYY-MM-DD in the event's local time zone (always present)
  hasTime: boolean;
  endsAt: string | null;
  timezone: string;
  city: City | null;
  venueName: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  price: Price | null;
  categories: string[];
  online: boolean | null;
  tos: TosStatus;
  fetchedAt: string;
}
