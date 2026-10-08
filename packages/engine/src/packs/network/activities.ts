// Activity taxonomy and public venues for plans (docs/design/2026-10-07-experience-design.md 4.3;
// growth doc section 3: public venues only, no home hosting, no money handled by the Network).
// Engine-side product knowledge. `tags` are the facet tag vocabulary the onboarding agent writes
// (the same interest tags as packages/sim/src/taxonomy.ts), and `objectives` are taxonomy.ts
// objective ids, so a stated interest or a live want maps onto activities without any new
// extraction. Nothing here reads hidden truth. 17.5 exclusions (home entry, childcare, money,
// medical, substances) never appear: every activity is low or medium risk at a public place.
import type { Category, City } from "@thenetwork/core";

export type Daypart = "weekday_evening" | "weekend_day" | "weekend_evening";
export type ActivityKind = "activity" | "volunteer" | "event";

export interface ActivityType {
  id: string; label: string; family: string;
  /** Interest / skill / pool tags that mean "likes this" (facet tags). */
  tags: string[];
  /** taxonomy.ts objective ids whose want this activity serves. */
  objectives: string[];
  /** [min, max] people. min 2 = an activity-partner plan is allowed (D15). */
  groupSize: [number, number];
  durationMin: number; costTier: 0 | 1 | 2 | 3;
  setting: "indoor" | "outdoor" | "either"; intensity: 0 | 1 | 2;
  needsBooking: boolean; ageMin: number;
  riskClass: "low" | "medium";
  dayparts: Daypart[];
  kind: ActivityKind;
  category: Category;
}

const A = (id: string, label: string, family: string, tags: string[], objectives: string[], o: Partial<ActivityType> = {}): ActivityType => ({
  id, label, family, tags, objectives, groupSize: [3, 6], durationMin: 120, costTier: 1, setting: "indoor", intensity: 0,
  needsBooking: false, ageMin: 18, riskClass: "low", dayparts: ["weekday_evening", "weekend_day", "weekend_evening"], kind: "activity", category: "social", ...o,
});
const DAY_ONLY: Daypart[] = ["weekend_day"];
const EVENINGS: Daypart[] = ["weekday_evening", "weekend_evening"];

/** About 30 activities in 9 families. Plans are category "social" (D15: never romance). */
export const ACTIVITIES: ActivityType[] = [
  // active
  A("bouldering", "bouldering", "active", ["climbing", "climbing_belay"], ["climbing_partner"], { groupSize: [2, 6], costTier: 2, intensity: 2 }),
  A("group_run", "an easy group run", "active", ["running"], ["run_club"], { groupSize: [2, 6], costTier: 0, setting: "outdoor", intensity: 1, durationMin: 60, dayparts: ["weekday_evening", "weekend_day"] }),
  A("day_hike", "a day hike", "active", ["hiking"], [], { costTier: 0, setting: "outdoor", intensity: 1, durationMin: 240, dayparts: DAY_ONLY }),
  A("group_ride", "a group bike ride", "active", ["cycling"], [], { groupSize: [2, 6], costTier: 0, setting: "outdoor", intensity: 2, dayparts: DAY_ONLY }),
  A("tennis", "tennis", "active", ["tennis", "tennis_coach"], ["tennis_partner"], { groupSize: [2, 4], costTier: 1, setting: "outdoor", intensity: 2, dayparts: ["weekday_evening", "weekend_day"] }),
  A("pickleball", "pickleball", "active", ["pickleball"], [], { groupSize: [2, 6], setting: "outdoor", intensity: 1, dayparts: ["weekday_evening", "weekend_day"] }),
  A("pickup_basketball", "pickup basketball", "active", ["basketball"], [], { costTier: 0, setting: "outdoor", intensity: 2, dayparts: ["weekday_evening", "weekend_day"] }),
  A("park_yoga", "yoga in the park", "wellness", ["yoga"], [], { costTier: 0, setting: "outdoor", intensity: 1, durationMin: 75, dayparts: DAY_ONLY }),
  A("group_sit", "a meditation drop-in", "wellness", ["meditation"], [], { costTier: 1, durationMin: 60 }),
  // music and arts
  A("live_show", "a live show", "music", ["live_music", "rock_music", "electronic_music"], ["start_band"], { costTier: 2, dayparts: EVENINGS }),
  A("jazz_night", "a jazz set", "music", ["jazz", "piano"], [], { costTier: 2, dayparts: EVENINGS }),
  A("open_mic", "an open mic night", "music", ["rock_music", "guitar", "vocals", "writing"], ["start_band"], { costTier: 0, dayparts: EVENINGS }),
  A("film_screening", "an indie film screening", "arts", ["film"], ["film_buddies"], { costTier: 1, dayparts: EVENINGS }),
  A("open_studio", "a ceramics open studio", "arts", ["ceramics", "pottery_wheel"], ["ceramics_class"], { costTier: 2, needsBooking: true }),
  A("sketch_session", "a drop-in sketch session", "arts", ["painting"], [], { costTier: 1 }),
  A("photo_walk", "a photo walk", "arts", ["photography", "photography_pro"], ["photo_walks"], { groupSize: [2, 6], costTier: 0, setting: "outdoor", dayparts: DAY_ONLY }),
  A("theater_night", "a play", "arts", ["theater"], [], { costTier: 3, dayparts: EVENINGS, needsBooking: true }),
  A("dance_class", "a drop-in dance class", "arts", ["dancing"], [], { costTier: 1, intensity: 1, dayparts: EVENINGS }),
  // ideas and play
  A("book_club", "a book club at a cafe", "ideas", ["books", "philosophy"], [], { costTier: 1 }),
  A("writing_session", "a writing session at the library", "ideas", ["writing", "writing_editor"], ["writing_group"], { groupSize: [2, 6], costTier: 0, dayparts: ["weekday_evening", "weekend_day"] }),
  A("board_game_cafe", "board games at a cafe", "play", ["board_games"], [], { costTier: 1, dayparts: EVENINGS }),
  A("chess_park", "chess in the park", "play", ["chess", "chess_strong"], ["chess_games"], { groupSize: [2, 6], costTier: 0, setting: "outdoor", dayparts: DAY_ONLY }),
  // food (restaurants and cafes; everyone pays their own way)
  A("restaurant_dinner", "dinner at a restaurant", "food", ["cooking", "chef", "hosting"], ["dinner_club", "new_friends"], { costTier: 2, dayparts: EVENINGS, needsBooking: true }),
  A("coffee_crawl", "a coffee crawl", "food", ["coffee"], [], { costTier: 1, durationMin: 90, dayparts: DAY_ONLY }),
  A("wine_bar", "a wine bar", "food", ["wine"], [], { costTier: 2, ageMin: 21, dayparts: EVENINGS }),
  A("night_market", "a night market food crawl", "food", ["cooking", "coffee"], ["new_friends"], { costTier: 1, setting: "outdoor", dayparts: ["weekend_evening"] }),
  // tech and work, as social plans (no pitching, no money)
  A("tech_meetup", "a tech meetup", "tech", ["ai", "startups", "crypto", "hardware", "climate_tech", "ml_engineering", "fundraising", "design", "hardware_eng", "climate_policy"], ["meet_founders", "climate_people", "hardware_collab"], { costTier: 0, dayparts: ["weekday_evening"], category: "social" }),
  // civic: volunteer shifts at existing organizations (growth doc section 3: fulfilling, zero resource draw)
  A("food_bank_shift", "a food bank volunteer shift", "civic", ["volunteering"], ["new_friends"], { costTier: 0, intensity: 1, durationMin: 180, kind: "volunteer", dayparts: DAY_ONLY }),
  A("park_cleanup", "a park cleanup", "civic", ["volunteering", "gardening", "urbanism", "dogs"], [], { costTier: 0, setting: "outdoor", intensity: 1, durationMin: 150, kind: "volunteer", dayparts: DAY_ONLY }),
  A("community_garden", "a community garden workday", "civic", ["gardening", "volunteering"], [], { costTier: 0, setting: "outdoor", intensity: 1, durationMin: 180, kind: "volunteer", dayparts: DAY_ONLY }),
  A("walking_tour", "a neighborhood history walk", "civic", ["urbanism", "photography"], [], { costTier: 0, setting: "outdoor", durationMin: 90, dayparts: DAY_ONLY }),
  A("dog_park", "a dog park meetup", "civic", ["dogs"], [], { groupSize: [2, 6], costTier: 0, setting: "outdoor", durationMin: 60, dayparts: DAY_ONLY }),
];
export const activityById = new Map(ACTIVITIES.map(a => [a.id, a]));

/** Activities whose tags include an event's tag (public listings become plan activities with a fixed venue and time). */
export function activitiesForTags(tags: readonly string[]): ActivityType[] {
  const ts = new Set(tags.map(t => t.toLowerCase()));
  return ACTIVITIES.filter(a => a.tags.some(t => ts.has(t)));
}

/**
 * A public venue (growth doc section 3: public places only, never a member's home). `hours` are
 * local [open, close) per weekday / weekend. `org` names the existing organization for volunteer shifts.
 */
export interface Venue {
  id: string; city: City; area: string; name: string;
  activities: string[]; priceTier: 0 | 1 | 2 | 3; ageMin: number;
  hours: { weekday: [number, number]; weekend: [number, number] };
  capacity?: number; bookingUrl?: string; org?: string;
  public: true; source: "maps" | "listing" | "curated"; freshAt?: number;
}
