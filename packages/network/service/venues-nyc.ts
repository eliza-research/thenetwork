// Public places in New York for a slop.date first date after dark (packages/network/service/packs.ts
// slopVenue). Busy, lit, indoor places that are open in the evening. Never a home, a park, a
// waterfront or an open-air market after dark: those are in geo.ts VENUES, for daytime dates only.
// Coordinates are approximate (a building, never an address a member gave). Curating the full list
// (50-100 places, hours checked, reviewed by a person) is an Ops task (PRD 37.2 P6).

export interface EveningVenue {
  id: string; name: string;
  /** A neighborhood in geo.ts NEIGHBORHOODS (what the booked text names after the venue). */
  neighborhood: string;
  lat: number; lon: number;
  kind: "food_hall" | "market_hall" | "cafe" | "bar" | "bookstore" | "museum";
  /** Indoors (a date after dark is never outside). */
  indoor: boolean;
  /** Open on weekday evenings until at least 9pm. */
  open_evening: boolean;
  borough: "Manhattan" | "Brooklyn" | "Queens" | "Bronx" | "Staten Island";
}

export const EVENING_VENUES_NYC: readonly EveningVenue[] = [
  { id: "chelsea-market", name: "Chelsea Market", neighborhood: "Chelsea", lat: 40.7424, lon: -74.006, kind: "food_hall", indoor: true, open_evening: true, borough: "Manhattan" },
  { id: "urbanspace-vanderbilt", name: "Urbanspace Vanderbilt", neighborhood: "Midtown", lat: 40.7537, lon: -73.9767, kind: "food_hall", indoor: true, open_evening: true, borough: "Manhattan" },
  { id: "essex-market", name: "Essex Market", neighborhood: "Lower East Side", lat: 40.7188, lon: -73.9883, kind: "market_hall", indoor: true, open_evening: true, borough: "Manhattan" },
  { id: "time-out-market", name: "Time Out Market", neighborhood: "DUMBO", lat: 40.7033, lon: -73.9903, kind: "food_hall", indoor: true, open_evening: true, borough: "Brooklyn" },
  { id: "dekalb-market-hall", name: "DeKalb Market Hall", neighborhood: "Fort Greene", lat: 40.6905, lon: -73.9835, kind: "food_hall", indoor: true, open_evening: true, borough: "Brooklyn" },
  { id: "industry-city", name: "Industry City food hall", neighborhood: "Sunset Park", lat: 40.6553, lon: -74.0076, kind: "food_hall", indoor: true, open_evening: true, borough: "Brooklyn" },
];

/** The places a date after dark may be at: indoor and open in the evening. */
export const eveningVenues = (): EveningVenue[] => EVENING_VENUES_NYC.filter(v => v.indoor && v.open_evening);
