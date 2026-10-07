/**
 * Cross-source dedupe: title + time + venue fuzzy match, blocked by (city, local date).
 *  1. Exact link: same platform id (luma-discover vs luma-ics share evt-…), or one row's url/altUrls
 *     names the other row's url (CV listings link out to Luma/Partiful/Eventbrite/Meetup).
 *  2. Fuzzy: title similarity (token-set Jaccard blended with char-trigram Dice), time agreement,
 *     venue agreement (geo distance or venue/address tokens). Pairs over a threshold are merged with
 *     union-find into clusters; each cluster becomes one canonical event.
 */
import type { NormalizedEvent } from "./types";

const STOP = new Set(["the", "a", "an", "and", "of", "in", "at", "for", "with", "to", "on", "by", "x", "sf", "nyc", "ny", "san", "francisco", "new", "york", "sftechweek", "techweek", "tech", "week", "2026", "event", "events"]);

export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/#\w+/g, " ")
    .replace(/([a-z])(\d{2,4})\b/g, "$1 $2") // "techonomy26" -> "techonomy 26"
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(19|20)?\d{2}\b/g, (y) => (y.length === 2 || y.length === 4 ? " " : y)) // drop year-like numbers
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(normTitle(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t)));
}

function trigrams(s: string): Map<string, number> {
  const t = `  ${normTitle(s).replace(/\s+/g, " ")} `;
  const m = new Map<string, number>();
  for (let i = 0; i < t.length - 2; i++) m.set(t.slice(i, i + 3), (m.get(t.slice(i, i + 3)) ?? 0) + 1);
  return m;
}

const GENERIC = new Set(["happy", "hour", "meetup", "networking", "dinner", "breakfast", "lunch", "brunch", "hackathon", "night", "social", "party", "workshop", "summit", "coffee", "demo", "day", "mixer", "salon", "panel", "talk", "ai", "founders", "builders"]);

/** Title head = text before the first separator (": - | – — ·"), e.g. "Agentic Zero: The Agentic Finance Summit" -> "Agentic Zero". */
const SEP = /\s*[:|–—·]\s*|\s+-\s+/;
const toks = (s: string) => normTitle(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t));
function head(s: string): string[] {
  return toks(s.replace(/#\w+/g, " ").split(SEP)[0]);
}
/** Text after the first separator ("Org presents: Talk" -> "Talk"); [] when there is no separator. */
function tail(s: string): string[] {
  const parts = s.replace(/#\w+/g, " ").split(SEP);
  return parts.length > 1 ? toks(parts.slice(1).join(" ")) : [];
}

function distinctive(toks: string[]) {
  return toks.length >= 2 && toks.some((t) => !GENERIC.has(t));
}
/** Stricter: at least two non-generic tokens ("COLM Happy Hour" has one, "Agentic Zero" has two). */
function informative(toks: string[]) {
  return toks.filter((t) => !GENERIC.has(t)).length >= 2;
}

/**
 * Prefix containment: the shorter title is a token prefix of the longer one -> 0.9.
 * Distinguishes "Matched by NEXA" ~ "Matched by NEXA - Quest Week" (same) from
 * "COLM Happy Hour" ~ "Goodfire COLM Happy Hour" (different host, different event).
 * Equal heads with *different* tails ("Founder Reset: X" vs "Founder Reset: Y") are often a
 * series, so they only score 0.75 and need time/venue evidence to merge.
 */
function prefixContain(a: string, b: string): number {
  const ta = normTitle(a.replace(/#\w+/g, " ")).split(" ").filter((t) => t.length > 1 && !STOP.has(t));
  const tb = normTitle(b.replace(/#\w+/g, " ")).split(" ").filter((t) => t.length > 1 && !STOP.has(t));
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (informative(short) && short.every((t, i) => long[i] === t)) return 0.9;
  const ha = head(a), hb = head(b), xa = tail(a), xb = tail(b);
  // "Org presents: The Talk" ~ "The Talk"
  if ((informative(ta) && xb.join(" ") === ta.join(" ")) || (informative(tb) && xa.join(" ") === tb.join(" "))) return 0.85;
  if (distinctive(ha) && ha.join(" ") === hb.join(" ")) return 0.75;
  if (distinctive(xa) && xa.join(" ") === xb.join(" ")) return 0.75;
  return 0;
}

export function titleSim(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const jacc = A.size + B.size ? inter / (A.size + B.size - inter) : 0;
  const ta = trigrams(a), tb = trigrams(b);
  let ti = 0, na = 0, nb = 0;
  for (const [k, v] of ta) { na += v; ti += Math.min(v, tb.get(k) ?? 0); }
  for (const v of tb.values()) nb += v;
  const dice = na + nb ? (2 * ti) / (na + nb) : 0;
  return Math.max(jacc, dice, prefixContain(a, b));
}

export function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const VENUE_GENERIC = new Set(["park", "st", "street", "ave", "avenue", "blvd", "rd", "road", "ca", "usa", "us", "united", "states", "california", "brooklyn", "manhattan", "floor", "suite", "room", "hall", "building", "center", "centre", "library", "sfpl", "main", "playground", "plaza", "square"]);

/** -1 = conflicting, 0 = unknown, 1 = agree. */
export function timeAgreement(a: NormalizedEvent, b: NormalizedEvent): number {
  if (a.startDate !== b.startDate) return -1;
  if (!(a.hasTime && b.hasTime && a.startsAt && b.startsAt)) return 0;
  const dm = Math.abs(Date.parse(a.startsAt) - Date.parse(b.startsAt)) / 60000;
  return dm <= 30 ? 1 : dm <= 90 ? 0 : -1;
}

export function venueAgreement(a: NormalizedEvent, b: NormalizedEvent): number {
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    const d = haversineM([a.lat, a.lng], [b.lat, b.lng]);
    // Luma obfuscates coordinates for "guests-only" addresses (~few hundred m)
    return d <= 250 ? 1 : d <= 1200 ? 0 : -1;
  }
  const vt = (e: NormalizedEvent) => new Set([...tokens(`${e.venueName ?? ""} ${e.address ?? ""}`)].filter((t) => !VENUE_GENERIC.has(t)));
  const va = vt(a), vb = vt(b);
  if (va.size < 2 || vb.size < 2) return 0;
  let inter = 0;
  for (const x of va) if (vb.has(x)) inter++;
  return inter / Math.min(va.size, vb.size) >= 0.5 ? 1 : 0;
}

const canonUrl = (u: string) => u.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/^lu\.ma\//, "luma.com/").replace(/[?#].*$/, "").replace(/\/$/, "");

export function linkMatch(a: NormalizedEvent, b: NormalizedEvent): boolean {
  if (a.source.startsWith("luma") && b.source.startsWith("luma") && a.sourceId === b.sourceId) return true;
  const ua = new Set([a.url, ...a.altUrls].map(canonUrl));
  return [b.url, ...b.altUrls].some((u) => ua.has(canonUrl(u)));
}

export interface PairScore {
  a: string;
  b: string;
  score: number;
  title: number;
  time: number;
  venue: number;
  link: boolean;
}

export function scorePair(a: NormalizedEvent, b: NormalizedEvent): PairScore {
  const link = linkMatch(a, b);
  const title = titleSim(a.title, b.title);
  const time = timeAgreement(a, b);
  const venue = venueAgreement(a, b);
  // time conflict (different day or >90 min apart) vetoes unless the link says otherwise
  let score = time === -1 ? 0 : title * 0.7 + (time === 1 ? 0.2 : time === 0 ? 0.08 : 0) + (venue === 1 ? 0.1 : venue === 0 ? 0.03 : -0.15);
  const below = DEFAULT_THRESHOLD - 0.01;
  // Title-only evidence (date-only listing, no venue): require a near-identical or prefix title.
  if (time === 0 && venue === 0 && title < 0.8) score = Math.min(score, below);
  // Titles must agree substantially no matter how well time/venue agree (same-slot happy hours).
  if (title < 0.7) score = Math.min(score, below);
  // Geo conflict (>1.2 km) vetoes: chapters of one club meet at the same hour in different places.
  if (venue === -1) score = Math.min(score, below);
  if (link) score = 1;
  return { a: a.id, b: b.id, score: Math.max(0, Math.min(1, score)), title, time, venue, link };
}

export const DEFAULT_THRESHOLD = 0.62;

/** Score all candidate pairs within (city, startDate) blocks. */
export function candidatePairs(events: NormalizedEvent[], minScore = 0.35): PairScore[] {
  const blocks = new Map<string, NormalizedEvent[]>();
  for (const e of events) {
    const k = `${e.city}|${e.startDate}`;
    (blocks.get(k) ?? blocks.set(k, []).get(k)!).push(e);
  }
  const out: PairScore[] = [];
  for (const blk of blocks.values()) {
    for (let i = 0; i < blk.length; i++)
      for (let j = i + 1; j < blk.length; j++) {
        if (blk[i].source === blk[j].source && !(blk[i].source === "cerebral-valley")) {
          // same-source pairs are only interesting for aggregator sources; skip otherwise
          continue;
        }
        const s = scorePair(blk[i], blk[j]);
        if (s.score >= minScore || s.link) out.push(s);
      }
  }
  return out.sort((x, y) => y.score - x.score);
}

/** Union-find clustering over pairs above threshold. Returns cluster id per event id. */
export function cluster(events: NormalizedEvent[], pairs: PairScore[], threshold = DEFAULT_THRESHOLD): Map<string, string> {
  const parent = new Map(events.map((e) => [e.id, e.id]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; }
    return x;
  };
  for (const p of pairs) if (p.score >= threshold) parent.set(find(p.a), find(p.b));
  return new Map(events.map((e) => [e.id, find(e.id)]));
}

const SOURCE_RANK: Record<string, number> = {
  "luma-discover": 1, "luma-ics": 2, eventbrite: 3, meetup: 3, partiful: 3, "nyc-parks": 4, "sf-recpark": 4, sfpl: 4, "cerebral-valley": 5,
};

/** Merge each cluster into one canonical event, preferring rows with exact time + geo. */
export function mergeClusters(events: NormalizedEvent[], clusters: Map<string, string>): (NormalizedEvent & { sources: string[] })[] {
  const groups = new Map<string, NormalizedEvent[]>();
  for (const e of events) (groups.get(clusters.get(e.id)!) ?? groups.set(clusters.get(e.id)!, []).get(clusters.get(e.id)!)!).push(e);
  return [...groups.values()].map((g) => {
    const best = [...g].sort((x, y) => Number(y.hasTime) - Number(x.hasTime) || Number(y.lat != null) - Number(x.lat != null) || SOURCE_RANK[x.source] - SOURCE_RANK[y.source])[0];
    return {
      ...best,
      altUrls: [...new Set(g.flatMap((e) => [e.url, ...e.altUrls]).filter((u) => u !== best.url))],
      categories: [...new Set(g.flatMap((e) => e.categories))],
      price: g.find((e) => e.price)?.price ?? null,
      lat: best.lat ?? g.find((e) => e.lat != null)?.lat ?? null,
      lng: best.lng ?? g.find((e) => e.lng != null)?.lng ?? null,
      venueName: best.venueName ?? g.find((e) => e.venueName)?.venueName ?? null,
      sources: [...new Set(g.map((e) => e.source))],
    };
  });
}
