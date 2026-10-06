/** Field coverage + counts per source/city for RESULTS.md. */
import { readFileSync } from "node:fs";
import type { NormalizedEvent } from "../src/types";
const d = JSON.parse(readFileSync("data/events.json", "utf8"));
const merged: (NormalizedEvent & { sources: string[] })[] = JSON.parse(readFileSync("data/events-deduped.json", "utf8"));
const rows: NormalizedEvent[] = [...d.events, ...d.restricted];
const uniq = new Map<string, NormalizedEvent>();
for (const e of rows) uniq.set(e.id, e);
const pct = (xs: NormalizedEvent[], f: (e: NormalizedEvent) => boolean) => (xs.length ? Math.round((100 * xs.filter(f).length) / xs.length) + "%" : "-");
const by: Record<string, NormalizedEvent[]> = {};
for (const e of uniq.values()) (by[e.source] ??= []).push(e);
const out: any[] = [];
for (const [src, xs] of Object.entries(by)) {
  out.push({
    source: src, tos: xs[0].tos, sf: xs.filter((e) => e.city === "sf").length, nyc: xs.filter((e) => e.city === "nyc").length,
    time: pct(xs, (e) => e.hasTime), end: pct(xs, (e) => !!e.endsAt), venue: pct(xs, (e) => !!(e.venueName || e.address)), latlng: pct(xs, (e) => e.lat != null),
    price: pct(xs, (e) => !!e.price), cats: pct(xs, (e) => e.categories.length > 0),
  });
}
console.table(out);
// kid-focused / low relevance filter for a professional-social network
const kid = (e: NormalizedEvent) => e.categories.some((c) => /audience:(babies|children|teens|kids)|kids|children|family|toddler|storytime/.test(c)) && !e.categories.some((c) => /audience:adults/.test(c));
for (const c of ["sf", "nyc"]) {
  const m = merged.filter((e) => e.city === c);
  const green = m.filter((e) => e.tos === "green" || e.sources.some((s) => ["luma-ics", "cerebral-valley", "nyc-parks", "sf-recpark", "sfpl"].includes(s)));
  const greenAdult = green.filter((e) => !kid(e));
  const pro = green.filter((e) => e.sources.some((s) => s.startsWith("luma") || s === "cerebral-valley"));
  const days: Record<string, number> = {};
  for (const e of green) days[e.startDate] = (days[e.startDate] ?? 0) + 1;
  console.log(c, { unique: m.length, uniqueGreenReachable: green.length, greenAdult: greenAdult.length, greenTechSocial: pro.length, perDayGreen: days });
}
const lumaOnly = merged.filter((e) => e.sources.length === 1 && e.sources[0] === "luma-discover");
console.log("unique events reachable ONLY via grey luma-discover:", lumaOnly.length, { sf: lumaOnly.filter((e) => e.city === "sf").length, nyc: lumaOnly.filter((e) => e.city === "nyc").length });
const restrictedOnly = merged.filter((e) => e.sources.every((s) => ["eventbrite", "meetup", "partiful", "luma-discover"].includes(s)));
console.log("unique events only in grey/restricted sources:", { sf: restrictedOnly.filter((e) => e.city === "sf").length, nyc: restrictedOnly.filter((e) => e.city === "nyc").length });
// steady-state view: drop Cerebral Valley (its llms-full snapshot is capped at the first 760 global rows,
// which this week covers only Oct 6-8 because of SF/NY Tech Week)
for (const c of ["sf", "nyc"]) {
  const m = merged.filter((e) => e.city === c && e.sources.some((s) => ["luma-ics", "nyc-parks", "sf-recpark", "sfpl"].includes(s)));
  const bySrc: Record<string, number> = {};
  for (const e of m.filter((e) => !kid(e))) for (const s of e.sources) bySrc[s] = (bySrc[s] ?? 0) + 1;
  console.log(c, "green excl. CV:", m.length, "adult:", m.filter((e) => !kid(e)).length, bySrc);
}
