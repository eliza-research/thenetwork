// Booked dates after the reveal (PRD 32.12, 32.13, F17-F19, 40.5): running late is relayed, a
// reschedule needs the other's yes and happens once, a second ask calls the date off with a rain
// check, both saying "again" proposes a second date in the app's own category (human review first),
// outbound text never carries a photo rating or a percentile, and evening dates are indoors.
import { describe, expect, test } from "bun:test";
import { LeakGuard } from "@thenetwork/core";
import { slopVenue } from "../service/packs.ts";
import { EVENING_VENUES_NYC, eveningVenues } from "../service/venues-nyc.ts";
import { whenPhrase } from "../src/copy.ts";
import { bookDate, DAY, HOUR, say, slopNet, World } from "./world.ts";

const T = 120_000;

async function booked() {
  const w = new World();
  w.add("ana", "Ana Lopez", 29); w.add("ben", "Ben Kim", 31, "Midtown");
  const net = slopNet(w);
  const oppId = await bookDate(net, w, "ana", "ben");
  return { w, net, oppId, o: net.opps.get(oppId)! };
}

describe("running late", () => {
  test("inside 6 hours of the date, running late reaches the other member with the sender's name", async () => {
    const { w, net, o } = await booked();
    w.t = o.meetingAt! - 2 * HOUR;
    const at = w.sent.length;
    await say(net, w, "ana", "tell Ben I'm running 10 min late, so sorry!");
    await say(net, w, "ben", "be there in 5, the train is slow");
    expect(w.to("ben", at).filter(s => s.meta?.type === "relay").map(s => s.body)).toEqual(["Ana: I'm running 10 min late, so sorry!"]);
    expect(w.to("ana", at).filter(s => s.meta?.type === "relay").map(s => s.body)).toEqual(["Ben: be there in 5, the train is slow"]);
  }, T);

  test("a relayed text waits for the end of the recipient's quiet hours (a relay is logistics, not an interruption)", async () => {
    const { w, net, o } = await booked();
    w.t = o.meetingAt! - 19 * HOUR - 30 * 60_000; // 23:30 the night before
    const at = w.sent.length;
    await say(net, w, "ana", "Looking forward to tomorrow, I'll be by the clock");
    expect(w.to("ben", at).filter(s => s.meta?.type === "relay")).toEqual([]);
    expect(net.relayLog().at(-1)).toMatchObject({ status: "sent" }); // accepted, deferred
    for (let i = 0; i < 40 && !w.to("ben", at).some(s => s.meta?.type === "relay"); i++) { w.t += 15 * 60_000; await net.tick(w.t); }
    const got = w.to("ben", at).find(s => s.meta?.type === "relay")!;
    expect(got.body).toBe("Ana: Looking forward to tomorrow, I'll be by the clock");
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit" }).format(got.at));
    expect(hour).toBeGreaterThanOrEqual(8);
  }, T);
});

describe("reschedule", () => {
  test("accepted: the other member picks a new time; it replaces the old plan for both", async () => {
    const { w, net, oppId, o } = await booked();
    const old = o.meetingAt!;
    const at = w.sent.length;
    await say(net, w, "ana", "can we move it to friday?");
    const ask = w.to("ben", at).find(s => s.meta?.type === "scheduling")!;
    expect(ask.body).toStartWith(`Ana asked to move your plan (${whenPhrase(old)}). Could you do Friday`);
    expect(o.meetingAt).toBe(old); // the original plan stands until the yes
    const options = ask.meta!.timeOptions as { key: string; start: number }[];
    await say(net, w, "ben", "the first one works");
    expect(o.stage).toBe("scheduled");
    expect(o.meetingAt).toBe(options[0]!.start);
    expect(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(o.meetingAt!)).toBe("Friday");
    for (const id of ["ana", "ben"]) expect(w.last(id)!.body).toBe(net["copy"].rescheduled(whenPhrase(o.meetingAt!), `${o.venue} (${o.venueArea})`));
    // The moved plan is the booked plan again (reminders follow the new time).
    expect(w.last("ana")!.meta).toMatchObject({ type: "proposal", meetingAt: o.meetingAt, booked: { at: o.meetingAt } });
    expect(net.relayThreads().find(t => t.oppId === oppId)!.closesAt).toBe(o.meetingAt! + 7 * DAY);
    expect(w.logged("meeting_moved")).toHaveLength(1);
  }, T);

  test("declined: the original plan stands; a second ask calls it off with a rain check", async () => {
    const { w, net, o } = await booked();
    const old = o.meetingAt!;
    await say(net, w, "ana", "something came up, could we do a different day?");
    const at = w.sent.length;
    await say(net, w, "ben", "no, sorry, those don't work for me");
    expect(o.meetingAt).toBe(old);
    expect(w.to("ana", at).map(s => s.body)).toEqual([net["copy"].rescheduleKept(whenPhrase(old))]);
    expect(w.to("ben", at).map(s => s.body)).toEqual([net["copy"].rescheduleKeptAck]);
    const at2 = w.sent.length;
    await say(net, w, "ana", "can we reschedule to another day?");
    expect(o.stage).toBe("closed");
    expect(w.to("ana", at2).map(s => s.body)).toEqual([net["copy"].rescheduleRainCheck]);
    expect(w.to("ben", at2).map(s => s.body)).toEqual([net["copy"].dropNotice("Ana", false)]);
    // The plan is off, so the relay closes too.
    await say(net, w, "ana", "really sorry about that");
    expect(net.relayThreads()[0]!.closedReason).toBe("cancelled");
  }, T);

  test("\"can't make it tonight, next week instead?\" asks for a new time instead of cancelling", async () => {
    const { w, net, o } = await booked();
    await say(net, w, "ben", "can't make it tonight, next week instead?");
    expect(o.stage).toBe("scheduled");
    expect(w.last("ana")!.meta?.type).toBe("scheduling");
    expect(w.last("ana")!.body).toStartWith("Ben asked to move your plan");
    // No answer in 24 hours: the original plan stands and the asker hears so.
    const at = w.sent.length;
    w.t += 25 * HOUR; await net.tick(w.t);
    expect(w.to("ben", at).map(s => s.body)).toContain(net["copy"].rescheduleKept(whenPhrase(o.meetingAt!)));
  }, T);
});

describe("second dates", () => {
  test("the check-in asks if they'd see them again; both yes proposes a second date in romance, for human review", async () => {
    const { w, net, o } = await booked();
    w.t = o.meetingAt! + 60_000; await net.tick(w.t);
    w.t = o.meetingAt! + 3 * HOUR + 60_000; await net.tick(w.t);
    const ask = w.last("ana")!;
    expect(ask.meta?.type).toBe("feedback_request");
    expect(ask.body).toContain("would you see them again?");
    await say(net, w, "ana", "It was really fun, I'd see him again");
    await say(net, w, "ben", "yes!");
    expect(w.logged("feedback").map(l => l.detail.memberId)).toEqual(["ana", "ben"]);
    // The next daily run composes it; it waits for a person.
    w.t = o.meetingAt! + 17 * HOUR; await net.tick(w.t); // noon the next day: the daily run
    const item = net.reviewQueue().find(i => i.origin === "second_encounter")!;
    expect(item.proposal).toMatchObject({ category: "romance", kind: "second_encounter" });
    expect([...item.proposal.participants].sort()).toEqual(["ana", "ben"]);
    expect(w.logged("gate").filter(l => l.detail.reason === "category_not_allowed")).toEqual([]);
    // Nothing is sent before a reviewer approves; then the ask names who it is with (both said again).
    expect(w.sent.some(s => /both said you'd meet again/.test(s.body))).toBe(false);
    expect(net.decide(item.oppId, "approve", { reviewer: "staff@example.com" }).ok).toBe(true);
    for (let i = 0; i < 96 && !w.sent.some(s => /both said you'd meet again/.test(s.body)); i++) { w.t += 15 * 60_000; await net.tick(w.t); }
    const second = w.sent.find(s => /both said you'd meet again/.test(s.body))!;
    expect(second.body).toContain(`You and ${second.to === "ana" ? "Ben" : "Ana"} both said you'd meet again.`);
  }, T);

  test("one says no: no second date", async () => {
    const { w, net, o } = await booked();
    w.t = o.meetingAt! + 60_000; await net.tick(w.t);
    w.t = o.meetingAt! + 3 * HOUR + 60_000; await net.tick(w.t);
    await say(net, w, "ana", "It was nice but I wouldn't see him again");
    await say(net, w, "ben", "yes!");
    w.t = o.meetingAt! + 17 * HOUR; await net.tick(w.t);
    expect(net.reviewQueue().filter(i => i.origin === "second_encounter")).toEqual([]);
  }, T);
});

describe("outbound leak guard: ratings, percentiles and looks", () => {
  test("core guard: rating tags, their values and rating phrases are refused once any rating exists", () => {
    const g = new LeakGuard({ ratings: ["slop:rating:face=0.73", "appearance:overall=-1.20", "appearance:bodyType=athletic"] });
    expect(g.check("their face=0.73 is great")).not.toEqual([]);
    expect(g.check("scored 0.73")).not.toEqual([]);
    expect(g.check("you're both around -1.20")).not.toEqual([]);
    expect(g.check("they're in the 90th percentile")).toContain("rating:phrase");
    expect(g.check("top 10% of members")).toContain("rating:phrase");
    expect(g.check("I'd rate them 8/10")).toContain("rating:phrase");
    expect(g.check("Meet at Chelsea Market, Wednesday 7pm. 2 miles away.")).toEqual([]);
    // Without ratings nothing changes for other apps.
    expect(new LeakGuard({}).check("top 10% of members")).toEqual([]);
  });

  test("slop: a reviewer's edit that carries a rating, a percentile or a looks word is refused; a plain one passes", async () => {
    const w = new World();
    w.add("ana", "Ana Lopez", 29); w.add("ben", "Ben Kim", 31, "Midtown");
    w.facets.push({ id: "ben:photo:p1", memberId: "ben", kind: "trait", value: "photo rating", tags: ["slop:rating:face=0.73", "slop:rating:body=0.41", "slop:rating:overall=0.66"], scope: "agent_private", provenance: "inferred", confidence: 0.5 });
    const net = slopNet(w);
    for (const id of ["ana", "ben"]) await say(net, w, id, "hi");
    net.submitProposal({ id: "p1", kind: "intro", participants: ["ana", "ben"], alternates: [], objective: "a first date", category: "romance", city: "nyc", score: 0.9, exploration: false, explanations: {}, generator: "player", createdAt: w.t, components: { fit: 1, mutualBenefit: 1, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 1 } });
    await net.tick(w.t);
    for (const text of ["they're in the 90th percentile", "their score is 0.66", "they're gorgeous", "similar looks to you"]) {
      expect([text, net.decide("p1", "edit", { explanations: { ana: text }, reviewer: "staff@example.com" })]).toEqual([text, { ok: false, reason: "edit_leak" }]);
    }
    expect(net.decide("p1", "edit", { explanations: { ana: "you both love dumplings" }, reviewer: "staff@example.com" }).ok).toBe(true);
    // Nothing the network sent carries a rating value.
    expect(w.sent.some(s => /0\.(73|41|66)|percentile/.test(s.body))).toBe(false);
  }, T);
});

describe("evening venues", () => {
  test("every evening venue is indoor and open in the evening; no park, plaza or waterfront", () => {
    expect(EVENING_VENUES_NYC.length).toBeGreaterThan(0);
    for (const v of eveningVenues()) {
      expect([v.id, v.indoor, v.open_evening]).toEqual([v.id, true, true]);
      expect([v.id, /park|plaza|pier|waterfront|greenmarket|garden/i.test(v.name)]).toEqual([v.id, false]);
      expect(v.lat).toBeGreaterThan(40.4); expect(v.lon).toBeLessThan(-73.6);
    }
    expect(EVENING_VENUES_NYC.some(v => v.id === "bryant-park")).toBe(false);
  });

  test("a date after dark is always at an evening venue", () => {
    const ids = new Set(eveningVenues().map(v => v.id));
    const sevenPm = Date.UTC(2026, 9, 14, 23, 0); // Wednesday 19:00 in New York
    const cells = [[{ lat: 40.78, lon: -73.97 }, { lat: 40.68, lon: -73.97 }], [{ lat: 40.71, lon: -74.0 }, { lat: 40.73, lon: -73.99 }], [{ lat: 40.65, lon: -74.0 }, { lat: 40.69, lon: -73.98 }]];
    for (const c of cells) for (const activity of ["coffee", "walk", "drinks", "museum"]) expect(ids.has(slopVenue(c, activity, sevenPm)!.id)).toBe(true);
  });
});
