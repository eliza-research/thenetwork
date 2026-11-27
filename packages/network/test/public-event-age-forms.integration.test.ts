import { expect, test } from "vitest";
import { listedEventMinimumAge } from "../../core/src/public-event-age.ts";
import { publicEventMemberAllowsMatch } from "../../core/src/generated/publicEventCatalog.ts";
import { soloEventAgeAllowed } from "../../core/src/generated/soloConcierge.ts";
import { publicEventRevision } from "../src/public-event-revision.ts";
import type { NetworkEvent } from "@thenetwork/core";
import { Mini } from "./mini.ts";

test("listedEventMinimumAge gates 18-to-20 adults out of ampersand, range, and minimum-age 21+ public events", async () => {
  const w = new Mini([
    { id: "jun", name: "Jun Park", age: 19 },
    { id: "sana", name: "Sana Lin", age: 23 },
    { id: "omar", name: "Omar Patel", age: 25 },
  ]);
  const start = w.clock.now() + 3_600_000;
  const end = start + 3_600_000;
  const link = "https://www.nycgovparks.org/events/2026/10/07/rooftop-jazz";
  const baseEvent: NetworkEvent = {
    id: "nyc-parks:rooftop-jazz",
    title: "Rooftop Jazz (21 & over)",
    city: "nyc",
    area: "Williamsburg",
    start,
    end,
    tags: ["music"],
    category: "hobby",
    listing: { venue: "McCarren Park", lat: 40.7206, lng: -73.9518, url: link },
  };
  const baseCtx = w.ctx();
  w.net.init({ ...baseCtx, snapshot: () => ({ ...baseCtx.snapshot(), events: [baseEvent] }) });
  await w.onboard("jun");
  await w.onboard("sana");
  await w.onboard("omar");

  const opps = (w.net as unknown as { opps: Map<string, unknown> }).opps;
  opps.set("opp_under_21", {
    id: "opp_under_21",
    category: "hobby",
    stage: "scheduled",
    participants: ["jun", "sana"],
    status: new Map([["jun", "yes"], ["sana", "yes"]]),
    plan: { eventId: baseEvent.id },
    publicEventRevision: publicEventRevision(baseEvent),
  });
  opps.set("opp_21_plus", {
    id: "opp_21_plus",
    category: "hobby",
    stage: "scheduled",
    participants: ["sana", "omar"],
    status: new Map([["sana", "yes"], ["omar", "yes"]]),
    plan: { eventId: baseEvent.id },
    publicEventRevision: publicEventRevision(baseEvent),
  });

  expect(w.net.approvedPublicEventLink("opp_21_plus", "sana", `Confirmed\n${link}`)).toBe(link);
  expect(w.net.approvedPublicEventLink("opp_under_21", "jun", `Confirmed\n${link}`)).toBeUndefined();

  for (const event of [
    { title: "Rooftop Jazz (21 & over)", tags: ["music"] },
    { title: "Founders Mixer — 21 & up", tags: ["networking"] },
    { title: "Late Lounge (21 and upwards)", tags: ["nightlife"] },
    { title: "Gallery Late Night (21 years and older)", tags: ["art"] },
    { title: "Supper Club", tags: ["food", "Ages 21-35"] },
    { title: "Wine Tasting", tags: ["food", "Age 21 to 35"] },
    { title: "Vinyl Listening Room", tags: ["music", "Minimum age: 21"] },
    { title: "Trivia Night", tags: ["games", "Min. age 21"] },
  ]) {
    const minimum = listedEventMinimumAge(event);
    expect(minimum).toBe(21);
    expect(publicEventMemberAllowsMatch(true, 19 >= minimum, true, true)).toBe(false);
    expect(soloEventAgeAllowed(19, minimum, false)).toBe(false);
    expect(publicEventMemberAllowsMatch(true, 21 >= minimum, true, true)).toBe(true);
  }
  expect(listedEventMinimumAge({ title: "Open Mic (18 & up)", tags: ["comedy"] })).toBe(18);
  expect(listedEventMinimumAge({ title: "Salon For Adults", tags: ["books"] })).toBe(18);
  expect(listedEventMinimumAge({ title: "Mixer", tags: ["Ages 35-21"] })).toBe(0);
  expect(listedEventMinimumAge({ title: "Ice Age 2 Outdoor Screening", tags: ["film"] })).toBe(0);
  expect(listedEventMinimumAge({ title: "9-11 Memorial Walk", tags: ["history"] })).toBe(0);
  expect(listedEventMinimumAge({ title: "10 to 12 Mile Trail Run", tags: ["running"] })).toBe(0);
});
