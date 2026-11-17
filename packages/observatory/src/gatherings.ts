export interface GatheringDraft {
  month: string;
  venue: { kind: "curated" | "listing"; id: string };
  startsAt: number;
  endsAt: number;
  capacity: number;
}

export interface GatheringView extends GatheringDraft {
  id: string;
  venue: GatheringDraft["venue"] & { name: string };
  status: "draft" | "approved" | "rejected";
  revision: number;
}

export type GatheringRequest = { action: "list" } | { action: "draft"; body: unknown } | { action: "review"; id: string; body: unknown };

export type GatheringResponse = { ok: true; gatherings: GatheringView[] } | { ok: true; gathering: GatheringView } | { ok: false; error: string };

export const gatheringId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const safeNumber = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

/** The console only needs the public venue, window and review state. */
export function gatheringFromService(value: unknown): GatheringView | undefined {
  const row = record(value);
  const venue = record(row?.venue);
  if (!row || !venue || row.app !== "ntwrk" || row.city !== "nyc" || typeof row.id !== "string" || !gatheringId.test(row.id)
    || typeof row.month !== "string" || typeof venue.id !== "string" || typeof venue.name !== "string"
    || (venue.kind !== "curated" && venue.kind !== "listing") || !safeNumber(row.startsAt) || !safeNumber(row.endsAt)
    || !safeNumber(row.capacity) || !safeNumber(row.revision) || (row.status !== "draft" && row.status !== "approved" && row.status !== "rejected")) return;
  return { id: row.id, month: row.month, venue: { id: venue.id, kind: venue.kind, name: venue.name },
    startsAt: row.startsAt, endsAt: row.endsAt, capacity: row.capacity, revision: row.revision, status: row.status };
}
