// An SF member's map pin must land in San Francisco, resolved in its own city's table: the
// NYC-only lookup pinned every SF member in Midtown (and SF "Financial District"/"Chinatown"
// members on top of their NYC namesakes). NYC pins must stay byte-identical.
import { describe, expect, test } from "vitest";
import { km, memberPoint, SF_NEIGHBORHOODS } from "../src/geo.ts";

const DOGPATCH = { lat: 37.7621, lng: -122.3971 };
const SF_FIDI = { lat: 37.7914, lng: -122.4021 };
const SF_CHINATOWN = { lat: 37.792, lng: -122.4086 };
const SF_CENTER = { lat: 37.7749, lng: -122.4194 };
const LA_CENTER = { lat: 34.0522, lng: -118.2437 };

describe("memberPoint pins an SF member in San Francisco", () => {
  test("sf-0001 in Dogpatch lands near the Dogpatch centroid, not Midtown", () => {
    const p = memberPoint("sf-0001", "Dogpatch", "sf");
    expect(km(p, DOGPATCH)).toBeLessThan(1.5);
    expect(p.lat).toBeGreaterThan(37.6);
    expect(p.lat).toBeLessThan(37.82);
    expect(p).not.toEqual({ lat: 40.75674082789489, lng: -73.97645606777881 });
  });

  test("colliding names resolve in the member's own city", () => {
    expect(km(memberPoint("sf-0044", "Financial District", "sf"), SF_FIDI)).toBeLessThan(1.5);
    expect(km(memberPoint("sf-0018", "Chinatown", "sf"), SF_CHINATOWN)).toBeLessThan(1.5);
    // The NYC namesakes stay where they were.
    expect(memberPoint("ny-0005", "Financial District", "nyc")).toEqual({ lat: 40.701008203523806, lng: -74.00525802926815 });
    expect(memberPoint("ny-0085", "Chinatown", "nyc")).toEqual({ lat: 40.71238725697266, lng: -74.00507008347786 });
  });

  test("an unknown SF area falls back to the SF center, never to Midtown", () => {
    expect(km(memberPoint("sf-9999", "No Such Place", "sf"), SF_CENTER)).toBeLessThan(1.5);
    expect(km(memberPoint("sf-9999", undefined, "sf"), SF_CENTER)).toBeLessThan(1.5);
  });

  test("an LA member falls back to the LA center", () => {
    expect(km(memberPoint("la-0001", undefined, "la"), LA_CENTER)).toBeLessThan(1.5);
  });

  test("every SF table entry is a real SF centroid with a jittered pin nearby", () => {
    expect(SF_NEIGHBORHOODS).toHaveLength(34);
    expect(new Set(SF_NEIGHBORHOODS.map(n => n.name)).size).toBe(34);
    for (const n of SF_NEIGHBORHOODS) {
      expect(n.lat).toBeGreaterThan(37.6);
      expect(n.lat).toBeLessThan(37.82);
      expect(n.lng).toBeGreaterThan(-122.55);
      expect(n.lng).toBeLessThan(-122.35);
      expect(km(memberPoint("sf-probe", n.name, "sf"), n)).toBeLessThan(1.5);
    }
  });
});

describe("memberPoint keeps NYC pins byte-identical", () => {
  test("NYC controls are unchanged with and without the city argument", () => {
    expect(memberPoint("ny-0001", "Mott Haven", "nyc")).toEqual({ lat: 40.80566646388137, lng: -73.92623919714757 });
    expect(memberPoint("ny-0001", "Mott Haven")).toEqual({ lat: 40.80566646388137, lng: -73.92623919714757 });
    expect(memberPoint("ny-0005", "Financial District")).toEqual({ lat: 40.701008203523806, lng: -74.00525802926815 });
    expect(memberPoint("ny-0085", "Chinatown")).toEqual({ lat: 40.71238725697266, lng: -74.00507008347786 });
  });

  test("the legacy no-city call keeps the old NYC-only fallback (only map.ts called it, and it now passes the city)", () => {
    expect(memberPoint("sf-0001", "Dogpatch")).toEqual({ lat: 40.75674082789489, lng: -73.97645606777881 });
  });
});
