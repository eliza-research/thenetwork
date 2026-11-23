// Plans in the ConsentNetwork (docs/results/2026-10-08-plans.md, iteration 2 and 1 integration
// asks). The planner itself is the engine's (packages/engine/src/plans.ts); this file holds the
// Network-side parts it needs: the curated public venue table for New York, the weekly check-in
// answer as stated windows, and the plan-only ledger for the plan allowance.
//
// MVP light touch (growth doc section 3): public places only (parks, libraries, plazas, markets,
// museums, courts), never a member's home, and no money through the Network (everyone pays their
// own way). Volunteer shifts are activities at public parks.
import { fromLocal, HOUR, localParts, type MemberId } from "@thenetwork/core";
import { plans, type AttentionLedgerEntry } from "@thenetwork/engine";
import { weeklyCheckinEvidenceMs, weeklyWindowCandidate } from "../../core/src/generated/planFormation.ts";
import { VENUES, venueAgeMin, type Venue as GeoVenue } from "./geo.ts";
import { NY } from "./outreach.ts";

export type PlanVenue = plans.Venue;

/** Venue tags (geo.ts) -> plan activities (engine activities.ts) that suit that public place. */
const TAG_ACTIVITIES: Record<string, string[]> = {
  running: ["group_run"], tennis: ["tennis"], basketball: ["pickup_basketball"], sports: ["pickleball", "pickup_basketball"],
  chess: ["chess_park"], books: ["book_club"], writing: ["writing_session"], study: ["writing_session"],
  photography: ["photo_walk"], walk: ["walking_tour", "photo_walk"], hiking: ["day_hike"], cycling: ["group_ride"],
  arts: ["sketch_session"], museums: ["sketch_session", "museum_visit"], film: ["film_screening"], dogs: ["dog_park"],
  market: ["coffee_crawl", "night_market"], food: ["coffee_crawl"], professional: ["tech_meetup"],
  outdoors: ["park_yoga", "park_cleanup"], gardens: ["community_garden"],
  games: ["library_games", "rec_center_games"], coffee: ["coffee_crawl"], picnic: ["park_picnic"],
};
const ACTIVITY_KIND: Record<string, GeoVenue["kind"]> = {
  museum_visit: "museum", library_games: "library", rec_center_games: "rec_center", park_picnic: "park",
};
/** Local opening hours by kind of place: [open, close) on weekdays and at weekends. */
const HOURS: Record<GeoVenue["kind"], { weekday: [number, number]; weekend: [number, number] }> = {
  park: { weekday: [7, 21], weekend: [7, 21] }, waterfront: { weekday: [7, 21], weekend: [7, 21] }, courts: { weekday: [7, 21], weekend: [7, 21] },
  library: { weekday: [10, 20], weekend: [10, 17] }, plaza: { weekday: [8, 21], weekend: [8, 21] }, market: { weekday: [8, 20], weekend: [8, 22] },
  museum: { weekday: [11, 21], weekend: [11, 18] }, cafe_district: { weekday: [8, 22], weekend: [8, 22] },
  rec_center: { weekday: [9, 21], weekend: [9, 17] },
};

export const PLAN_VENUES: PlanVenue[] = VENUES.map(v => ({
  id: v.id, city: "nyc" as const, area: v.neighborhood, name: v.name,
  activities: [...new Set(v.tags.flatMap(t => TAG_ACTIVITIES[t] ?? []))].filter(a => plans.activityById.has(a) && (ACTIVITY_KIND[a] ?? v.kind) === v.kind),
  priceTier: 0 as const, ageMin: venueAgeMin(v), hours: HOURS[v.kind], public: true as const, source: "curated" as const,
  allAges: v.allAges, adultPlans: v.adultPlans,
})).filter(v => v.activities.length > 0);

export const PLAN_VENUE_AGES: plans.VenueAges = plans.venueAgesIn(PLAN_VENUES);

/** Local hours of each part of the day in a stated window ("Saturday evening" = 17:00-22:00). */
const PARTS: Record<string, [number, number]> = { morning: [9, 12], afternoon: [12, 17], evening: [17, 22] };
const DAYS3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The weekly check-in answer ("free Saturday night and Tuesday after work") as this week's stated
 * windows (plans.StatedWindows): availability tags (classify.ts availabilityTags, "evening:Sat")
 * expanded over the next 7 days. Matchable, never shareable. Undefined when no window was named.
 */
export function statedWindows(tags: readonly string[], now: number, tz = NY): plans.StatedWindows | undefined {
  const lp = localParts(now, tz);
  const until = now + weeklyCheckinEvidenceMs;
  const pending = new Set(tags);
  const windows: { start: number; end: number }[] = [];
  for (let k = 0; k <= 7 && pending.size > 0; k++) {
    const d = new Date(Date.UTC(lp.year, lp.month - 1, lp.day + k));
    const day = DAYS3[d.getUTCDay()]!;
    for (const t of pending) {
      const [part, dd] = t.split(":");
      const h = PARTS[part ?? ""];
      if (!h || dd !== day) continue;
      const start = fromLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h[0], tz);
      const end = fromLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h[1], tz);
      if (!weeklyWindowCandidate(end, start, now, until)) continue;
      windows.push({ start: Math.max(start, now), end });
      pending.delete(t);
    }
  }
  // Adjacent or overlapping parts are one window ("Saturday afternoon and evening" = 12:00-22:00),
  // so an activity that crosses a part boundary fits inside one stated window.
  const joined: { start: number; end: number }[] = [];
  for (const window of windows.sort((a, b) => a.start - b.start)) {
    const last = joined[joined.length - 1];
    if (last && window.start <= last.end) last.end = Math.max(last.end, window.end); else joined.push({ ...window });
  }
  return joined.length ? { windows: joined, at: now, until } : undefined;
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
 * Each entry carries `repliedAt`: the member's first message after it (attention-MISSED-1). Without
 * it every invite read as unanswered, and the allowance stopped for good after the second one.
 */
export function planLedger(memberId: MemberId, sentAt: readonly number[], replies: readonly number[] = []): AttentionLedgerEntry[] {
  return sentAt.map((at, i) => {
    const repliedAt = replies.find(t => t > at);
    return { messageId: `plan:${memberId}:${i}`, memberId, at, kind: "digest", itemIds: [], countsAgainstCap: true, ...(repliedAt !== undefined ? { repliedAt } : {}) };
  });
}

/** A booked meeting blocks this long on each side for the booking-conflict check (plans ask 5). */
export const BOOKING_GAP = 4 * HOUR;
