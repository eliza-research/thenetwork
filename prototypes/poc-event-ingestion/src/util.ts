import type { City, NormalizedEvent } from "./types";

export const CITY_TZ: Record<City, string> = { sf: "America/Los_Angeles", nyc: "America/New_York" };

/** Rough city polygons as bounding boxes (SF city proper; NYC five boroughs). */
const BBOX: Record<City, [number, number, number, number]> = {
  sf: [37.703, -122.53, 37.833, -122.35],
  nyc: [40.49, -74.26, 40.92, -73.69],
};

export function cityFromGeo(lat: number | null, lng: number | null): City | null {
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  for (const c of ["sf", "nyc"] as City[]) {
    const [s, w, n, e] = BBOX[c];
    if (lat >= s && lat <= n && lng >= w && lng <= e) return c;
  }
  return null;
}

export function cityFromText(s: string | null | undefined): City | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/\bsan francisco\b|\bsf\b/.test(t)) return "sf";
  if (/\bnew york\b|\bnyc\b|\bbrooklyn\b|\bmanhattan\b|\bqueens\b|\bbronx\b|\bstaten island\b/.test(t)) return "nyc";
  return null;
}

/** Local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(iso: string, tz: string): string {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p; // en-CA gives YYYY-MM-DD
}

/** Convert a wall-clock time in tz to a UTC ISO string (DST-safe via two-pass offset). */
export function zonedToUtc(date: string, time: string, tz: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(guess));
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    const asIfUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
    guess += Date.UTC(y, mo - 1, d, h, mi) - asIfUtc;
  }
  return new Date(guess).toISOString();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'");
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** All schema.org JSON-LD objects on a page, flattened (arrays and @graph). */
export function jsonLd(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      for (const o of Array.isArray(j) ? j : [j]) out.push(...(o["@graph"] ?? [o]));
    } catch {
      /* malformed block: skip */
    }
  }
  return out;
}

export function nextData(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}

export function num(x: unknown): number | null {
  const n = typeof x === "string" ? parseFloat(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Is the event inside [from, to)? Date-only events compare by local date. */
export function inWindow(e: NormalizedEvent, fromIso: string, toIso: string): boolean {
  if (e.hasTime && e.startsAt) return e.startsAt >= fromIso && e.startsAt < toIso;
  const tz = e.timezone;
  return e.startDate >= localDate(fromIso, tz) && e.startDate < localDate(toIso, tz);
}
