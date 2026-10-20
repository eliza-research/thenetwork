/** Shared coordinates and distance calculation; app-specific travel estimates stay in each pack. */
export interface LatLng { lat: number; lng: number }
export type Borough = "Manhattan" | "Brooklyn" | "Queens" | "Bronx" | "Staten Island";

export function km(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}
