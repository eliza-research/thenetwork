// Plans in the ConsentNetwork (docs/results/2026-10-08-plans.md, iteration 2 and 1 integration
// asks). The planner itself is the engine's (packages/engine/src/plans.ts); this file holds the
// Network-side parts it needs: the curated public venue table for New York, the weekly check-in
// answer as stated windows, and the plan-only ledger for the plan allowance.
//
// MVP light touch (growth doc section 3): public places only (parks, libraries, plazas, markets,
// museums, courts), never a member's home, and no money through the Network (everyone pays their
// own way). Volunteer shifts are activities at public parks.
import { DAY, HOUR, type MemberId } from "@thenetwork/core";
import { outreach as engineOutreach, plans, type AttentionLedgerEntry } from "@thenetwork/engine";
import { VENUES, type Venue as GeoVenue } from "./geo.ts";
import { NY } from "./outreach.ts";

export type PlanVenue = plans.Venue;

/** Venue tags (geo.ts) -> plan activities (engine activities.ts) that suit that public place. */
const TAG_ACTIVITIES: Record<string, string[]> = {
  running: ["group_run"], tennis: ["tennis"], basketball: ["pickup_basketball"], sports: ["pickleball", "pickup_basketball"],
  chess: ["chess_park"], books: ["book_club"], writing: ["writing_session"], study: ["writing_session"],
  photography: ["photo_walk"], walk: ["walking_tour", "photo_walk"], hiking: ["day_hike"], cycling: ["group_ride"],
  arts: ["sketch_session"], museums: ["sketch_session"], film: ["film_screening"], dogs: ["dog_park"],
  market: ["coffee_crawl", "night_market"], food: ["coffee_crawl"], professional: ["tech_meetup"],
  outdoors: ["park_yoga", "park_cleanup"], gardens: ["community_garden"],
};
/** Local opening hours by kind of place: [open, close) on weekdays and at weekends. */
const HOURS: Record<GeoVenue["kind"], { weekday: [number, number]; weekend: [number, number] }> = {
  park: { weekday: [7, 21], weekend: [7, 21] }, waterfront: { weekday: [7, 21], weekend: [7, 21] }, courts: { weekday: [7, 21], weekend: [7, 21] },
  library: { weekday: [10, 20], weekend: [10, 17] }, plaza: { weekday: [8, 21], weekend: [8, 21] }, market: { weekday: [8, 20], weekend: [8, 22] },
  museum: { weekday: [11, 21], weekend: [11, 18] }, cafe_district: { weekday: [8, 22], weekend: [8, 22] },
};

/**
 * The curated public venue table for New York (plans iteration 1, ask 9), built from geo.ts VENUES:
 * every place is public, free to enter (price tier 0), adults only for plans (age 18; the engine
 * adds an activity's own minimum, e.g. 21 for a wine bar, which has no venue here).
 */
export const PLAN_VENUES: PlanVenue[] = VENUES.map(v => ({
  id: v.id, city: "nyc" as const, area: v.neighborhood, name: v.name,
  activities: [...new Set(v.tags.flatMap(t => TAG_ACTIVITIES[t] ?? []))].filter(a => plans.activityById.has(a)),
  priceTier: 0 as const, ageMin: 18, hours: HOURS[v.kind], public: true as const, source: "curated" as const,
})).filter(v => v.activities.length > 0);

/** Local hours of each part of the day in a stated window ("Saturday evening" = 17:00-22:00). */
const PARTS: Record<string, [number, number]> = { morning: [9, 12], afternoon: [12, 17], evening: [17, 22] };
const DAYS3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The weekly check-in answer ("free Saturday night and Tuesday after work") as this week's stated
 * windows (plans.StatedWindows): availability tags (classify.ts availabilityTags, "evening:Sat")
 * expanded over the next 7 days. Matchable, never shareable. Undefined when no window was named.
 */
export function statedWindows(tags: readonly string[], now: number, tz = NY): plans.StatedWindows | undefined {
  const lp = engineOutreach.localParts(now, tz);
  const windows: { start: number; end: number }[] = [];
  for (let k = 0; k <= 7; k++) {
    const d = new Date(Date.UTC(lp.year, lp.month - 1, lp.day + k));
    const day = DAYS3[d.getUTCDay()]!;
    for (const t of tags) {
      const [part, dd] = t.split(":");
      const h = PARTS[part ?? ""];
      if (!h || dd !== day) continue;
      const start = engineOutreach.fromLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h[0], tz);
      const end = engineOutreach.fromLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h[1], tz);
      if (end > now) windows.push({ start: Math.max(start, now), end });
    }
  }
  return windows.length ? { windows: windows.sort((a, b) => a.start - b.start), at: now, until: now + 7 * DAY } : undefined;
}

/** Activities a member named in a check-in ("into live music"): interest tags -> plan activity ids. */
export function activityHints(interests: readonly string[]): string[] {
  const ts = new Set(interests);
  return plans.ACTIVITIES.filter(a => a.tags.some(t => ts.has(t))).map(a => a.id);
}

/**
 * The plan-only ledger (founder decision 2026-10-08, the plan allowance): one entry per plan invite
 * sent to this member. Passed to attention.composeMessage with plans.planAllowanceConfig, so the
 * allowance (1 per 7 days) is counted on plan invites only and the intro cap never sees them.
 */
export function planLedger(memberId: MemberId, sentAt: readonly number[]): AttentionLedgerEntry[] {
  return sentAt.map((at, i) => ({ messageId: `plan:${memberId}:${i}`, memberId, at, kind: "digest", itemIds: [], countsAgainstCap: true }));
}

/** A booked meeting blocks this long on each side for the booking-conflict check (plans ask 5). */
export const BOOKING_GAP = 4 * HOUR;
