// Regression: candidateReason must not pick a meeting window shorter than
// minOverlapHours from fragmented presence. geo.overlap only guarantees total
// overlap >= minOverlapHours across all intervals, so a window split into
// 20-minute pieces totals 3h while no single piece is a usable meeting slot.
// The longest-interval fallback must re-check the minimum itself.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, MINUTE, type Member, type Presence } from "@thenetwork/core";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { candidateReason } from "../src/filters.ts";
import type { Candidate, EngineInput } from "../src/types.ts";
import { World } from "../src/world.ts";

const NOW = Date.UTC(2026, 9, 5, 16);

function member(id: string): Member {
  return {
    id, name: id, homeCity: "sf", state: "normal",
    prefs: {
      categoriesOptIn: ["social", "professional", "hobby", "help", "events", "growth"],
      quietHours: [22, 8], romanceOptIn: false, formats: ["one_to_one"],
      maxTravelMinutes: 60, onlyWhenAsked: false,
    },
    joinedAt: NOW - 30 * DAY, age: 30, unansweredProactive: 0,
  };
}

function worldWith(presence: Presence[]): World {
  const input: EngineInput = {
    now: NOW,
    members: [member("a"), member("b")],
    facets: [], intents: [], presence, edges: [], recentProposals: [],
  };
  return new World(input, resolveConfig(), localEmbed);
}

function candidate(fixedWindow: { start: number; end: number }): Candidate {
  return {
    key: "test", kind: "intro", generator: "test", category: "social",
    participants: ["a", "b"], roles: { a: "peer", b: "peer" }, format: "one_to_one",
    objective: "test", fixedWindow, channels: new Set(), evidence: {},
    fit: 0, benefit: {}, warm: 0, alternates: [], exploration: false,
    safetyClass: "low", timeSensitive: false, riskText: "",
  };
}

// Both members home in sf; "a" travels to nyc for 40 minutes out of every
// hour, leaving nine 20-minute sf fragments in a 10h window: 9 x 20min = 3h
// total overlap, longest single fragment 20 minutes. Only one member travels,
// so nyc is not a common city and sf is the only overlap city.
function fragmentedPresence(): Presence[] {
  const out: Presence[] = [
    { memberId: "a", city: "sf", type: "home", areas: ["mission"] },
    { memberId: "b", city: "sf", type: "home", areas: ["mission"] },
  ];
  for (let i = 0; i < 9; i++) {
    const travelStart = NOW + (20 + i * 60) * MINUTE;
    const travelEnd = NOW + (60 + i * 60) * MINUTE;
    out.push({ memberId: "a", city: "nyc", type: "temporary", areas: [], from: travelStart, to: travelEnd });
  }
  // Close the window so the last sf fragment is 20 minutes, not 2 hours.
  out.push({ memberId: "a", city: "nyc", type: "temporary", areas: [], from: NOW + 500 * MINUTE, to: NOW + 600 * MINUTE });
  return out;
}

describe("candidateReason presence window", () => {
  test("fragmented presence totalling 3h in 20-minute pieces is no overlap", () => {
    const w = worldWith(fragmentedPresence());
    const ov = w.overlap(["a", "b"], NOW, NOW + 10 * HOUR);
    // Sanity: the bug's precondition — total overlap meets the minimum.
    expect(ov).not.toBeNull();
    expect(ov!.hours).toBe(3);
    expect(Math.max(...ov!.intervals.map(([s, e]) => e - s))).toBe(20 * MINUTE);
    const c = candidate({ start: NOW, end: NOW + 10 * HOUR });
    expect(candidateReason(w, c)).toBe("no_presence_overlap");
  });

  test("a single interval meeting the minimum still passes", () => {
    const w = worldWith([
      { memberId: "a", city: "sf", type: "home", areas: ["mission"] },
      { memberId: "b", city: "sf", type: "home", areas: ["mission"] },
    ]);
    const c = candidate({ start: NOW, end: NOW + 4 * HOUR });
    expect(candidateReason(w, c)).toBeNull();
    expect(c.window!.end - c.window!.start).toBe(4 * HOUR);
  });
});
