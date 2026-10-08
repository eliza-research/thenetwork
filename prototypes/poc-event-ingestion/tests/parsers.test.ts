import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseLumaDiscover, parseLumaIcs, lumaCalendarIds } from "../src/sources/luma";
import { parseCvLlmsFull, parseCvCityPage } from "../src/sources/cerebral-valley";
import { parseNycParks, parseSfRecPark, parseSfpl } from "../src/sources/civic";
import { parseEventbriteBrowse, parseMeetupFind, parsePartifulExplore } from "../src/sources/restricted";
import type { NormalizedEvent } from "../src/types";
import { zonedToUtc } from "../src/util";

const fx = (f: string) => readFileSync(`${import.meta.dir}/../fixtures/${f}`, "utf8");
const T = "2026-10-06T17:00:00.000Z";

function wellFormed(evs: NormalizedEvent[]) {
  expect(evs.length).toBeGreaterThan(0);
  for (const e of evs) {
    expect(e.id).toStartWith(e.source + ":");
    expect(e.title.length).toBeGreaterThan(0);
    expect(e.url).toMatch(/^https:\/\//);
    expect(e.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (e.hasTime) expect(e.startsAt).toMatch(/Z$/);
  }
}

describe("source parsers (recorded fixtures)", () => {
  test("luma discover: time, geo, price, city", () => {
    const evs = parseLumaDiscover(JSON.parse(fx("luma-discover-sf.json")), T);
    wellFormed(evs);
    expect(evs.every((e) => e.hasTime && e.lat != null && e.price !== null)).toBe(true);
    expect(evs.filter((e) => e.city === "sf").length).toBeGreaterThan(0);
    expect(lumaCalendarIds(JSON.parse(fx("luma-discover-sf.json"))).length).toBeGreaterThan(0);
  });
  test("luma ics: unfolds lines, reads GEO + address block", () => {
    const evs = parseLumaIcs(fx("luma-calendar.ics"), T);
    wellFormed(evs);
    const mcp = evs.find((e) => e.title === "MCP Night by WorkOS")!;
    expect(mcp.venueName).toBe("Exploratorium");
    expect(mcp.city).toBe("sf");
    expect(mcp.lat).toBeCloseTo(37.8017, 3);
    expect(mcp.url).toBe("https://luma.com/quvg7kzs");
  });
  test("cerebral valley llms-full: date-only listings with outbound URL", () => {
    const evs = parseCvLlmsFull(fx("cv-llms-full-excerpt.txt"), T);
    wellFormed(evs);
    expect(evs.some((e) => e.city === "sf")).toBe(true);
    expect(evs.every((e) => !e.hasTime)).toBe(true);
    expect(evs.some((e) => e.altUrls[0]?.includes("luma.com"))).toBe(true);
  });
  test("cerebral valley city page JSON-LD: exact times", () => {
    const evs = parseCvCityPage(fx("cv-sf-itemlist.html"), "sf", T);
    wellFormed(evs);
    expect(evs[0].hasTime).toBe(true);
  });
  test("nyc parks (SODA): local wall time -> UTC, categories, coordinates", () => {
    const evs = parseNycParks(JSON.parse(fx("nyc-parks.json")), T);
    wellFormed(evs);
    expect(evs.every((e) => e.city === "nyc" && e.lat != null && e.categories.length > 0)).toBe(true);
  });
  test("sf rec & park RSS: 12h times in Pacific", () => {
    const evs = parseSfRecPark(fx("sf-recpark.xml"), T);
    wellFormed(evs);
    const dance = evs.find((e) => e.title.includes("Dance") && e.startDate === "2026-10-06");
    if (dance) expect(dance.startsAt).toBe("2026-10-07T00:30:00.000Z"); // 5:30 PM PDT
  });
  test("sfpl HTML: am/pm inference and audience categories", () => {
    const evs = parseSfpl(fx("sfpl-events.html"), T);
    wellFormed(evs);
    expect(evs.every((e) => e.categories.some((c) => c.startsWith("audience:")))).toBe(true);
  });
  test("restricted parsers work on probe fixtures (for partnership readiness only)", () => {
    const eb = parseEventbriteBrowse(fx("eventbrite-browse.html"), T);
    wellFormed(eb.events);
    expect(eb.total).toBeGreaterThan(100);
    expect(eb.events.every((e) => e.tos === "restricted")).toBe(true);
    wellFormed(parseMeetupFind(fx("meetup-find.html"), T));
    wellFormed(parsePartifulExplore(fx("partiful-explore.html"), T));
  });
});

describe("time zones", () => {
  test("zonedToUtc handles PDT/PST and EDT/EST", () => {
    expect(zonedToUtc("2026-10-06", "17:30", "America/Los_Angeles")).toBe("2026-10-07T00:30:00.000Z");
    expect(zonedToUtc("2026-12-06", "17:30", "America/Los_Angeles")).toBe("2026-12-07T01:30:00.000Z");
    expect(zonedToUtc("2026-10-06", "09:30", "America/New_York")).toBe("2026-10-06T13:30:00.000Z");
  });
});
