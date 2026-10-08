// The app packs wired into the ConsentNetwork (service/packs.ts; slop pack results section 9). The
// slop world (packages/worlds, src/slop) is the snapshot: its personas join on the web, the engine
// runs slopPack, and every item still waits for a human reviewer. Offline, no keys, no Postgres.
import { describe, expect, test } from "bun:test";
import { HOUR, type MemberId } from "@thenetwork/core";
import { checkInReport, ConsentNetwork, reportKindOf, VENUES } from "../src/index.ts";
import { APPS } from "../../platform/src/apps.ts";
import { appWiring, parseAgeRange, parseDistance, parseOrientation, slopVenue, zipForArea } from "../service/packs.ts";
import { DAY, SlopWorldNet } from "./slopworld.ts";
import { Mini } from "./mini.ts";

const T = 120_000;
const EVENING = ["Chelsea Market", "Bryant Park", "Urbanspace Vanderbilt", "Lincoln Center Plaza", "Essex Market", "Time Out Market", "DeKalb Market Hall", "Industry City food hall"];
const PUBLIC = new Set([...EVENING, ...VENUES.map(v => v.name)]);

/** Every id the input names anywhere (members, facets, intents, presence, edges, asks, history). */
function idsIn(net: ConsentNetwork, now: number): Set<MemberId> {
  const i = net.packInput(now);
  return new Set([
    ...i.members.map(m => m.id), ...i.facets.map(f => f.memberId), ...i.intents.map(x => x.memberId), ...i.presence.map(p => p.memberId),
    ...i.edges.flatMap(e => [e.from, e.to]), ...(i.recentAsks ?? []).map(a => a.memberId), ...(i.interactions ?? []).flatMap(x => x.participants),
    ...(i.feedback ?? []).flatMap(f => [f.from, f.about]), ...(i.safetyHolds ?? []).map(h => h.memberId), ...(i.openOpportunities ?? []).flatMap(o => o.participants),
  ]);
}

/** Approve the first item in review and drive both members to a booked date. Returns the pair. */
async function bookFirst(w: SlopWorldNet): Promise<[MemberId, MemberId]> {
  const item = w.net.reviewQueue()[0]!;
  expect(w.net.decide(item.oppId, "approve", { reviewer: "staff@test" }).ok).toBe(true);
  const [a, b] = item.proposal.participants as [MemberId, MemberId];
  for (let i = 0; i < 30 && w.awaiting(a) !== "probe" && w.awaiting(b) !== "probe"; i++) await w.run(HOUR);
  const first = w.awaiting(a) === "probe" ? a : b, second = first === a ? b : a;
  await w.say(first, "yes, the first time works");
  for (let i = 0; i < 30 && w.awaiting(second) !== "probe"; i++) await w.run(HOUR);
  await w.say(second, "yes");
  return [first, second];
}

/** Run until the check-in after the date reached both members (at most 8 days). */
async function untilCheckIn(w: SlopWorldNet, a: MemberId, b: MemberId) {
  for (let i = 0; i < 8 * 24 && !(w.awaiting(a) === "feedback" && w.awaiting(b) === "feedback"); i++) await w.run(HOUR);
}

describe("slop.date on slopPack (the slop world behind the ConsentNetwork)", () => {
  test("the engine runs slopPack; every proposal is a verified adult pair waiting for review; minors never enter the input", async () => {
    const w = new SlopWorldNet({ minorShare: 0.15 });
    const minors = w.members.filter(m => m.age < 18).map(m => m.id);
    expect(minors.length).toBeGreaterThan(3);
    await w.joinAll();
    // An adult on the record who says they are 16 in chat: a minor from then on, out of every pack input.
    const said16 = w.members.find(m => m.age >= 25)!.id;
    await w.say(said16, "honestly I'm 16");
    await w.run(HOUR);
    const q = w.net.reviewQueue();
    expect(q.length).toBeGreaterThan(0);
    // Nobody hears anything before a reviewer approves (no probe went out).
    expect(w.sent.filter(s => s.meta.type === "probe")).toHaveLength(0);
    for (const item of q) {
      expect(item.proposal.category).toBe("romance");
      expect(item.proposal.participants).toHaveLength(2);
      for (const id of item.proposal.participants) {
        const p = w.persona(id);
        expect(p.stated.claimedAge).toBeGreaterThanOrEqual(18);
        expect(minors).not.toContain(id);
        expect(id).not.toBe(said16);
        // Founder decision 9: no ID check, so no verify:* tag is required; a failed check still excludes.
        const tags = w.snap.facets.filter(f => f.memberId === id).flatMap(f => f.tags);
        expect(tags).not.toContain("verify:age:fail");
      }
    }
    const ids = idsIn(w.net, w.clock.now());
    for (const m of [...minors, said16]) expect(ids.has(m)).toBe(false);
    expect(w.net.packInput(w.clock.now()).members.every(m => m.age >= 18)).toBe(true);
  }, T);

  test("hard-field asks go out as one message; the answer becomes the pack's tags; each field is asked at most twice", async () => {
    const w = new SlopWorldNet();
    await w.joinAll();
    await w.run(DAY);
    const asks = w.sent.filter(s => s.meta.type === "question" && String((s.meta as { ask?: { reason: string } }).ask?.reason ?? "").startsWith("slop_"));
    expect(asks.length).toBeGreaterThan(0);
    // One message for several hard fields (slop_orientation, slop_age_range, slop_distance).
    const multi = asks.find(s => /age range/.test(s.body) && /how far/.test(s.body));
    expect(multi).toBeDefined();
    const who = multi!.to;
    expect(w.awaiting(who)).toBe("interview");
    await w.say(who, "I'm a woman looking for men, 28-36, within 5 miles of 11211");
    const tags = w.net.packInput(w.clock.now()).facets.filter(f => f.memberId === who).flatMap(f => f.tags);
    expect(tags).toEqual(expect.arrayContaining(["romance:is:woman", "romance:seeks:man", "romance:age:28-36", "slop:scope:radius:5", "slop:max_miles:5", "slop:zip:11211"]));
    // Facets learned from a member are never shown: agent_private only.
    expect(w.net.packInput(w.clock.now()).facets.filter(f => f.memberId === who && f.id.includes(":app:")).every(f => f.scope === "agent_private")).toBe(true);
    // A member who never answers: each hard field is asked at most twice (maxAsksPerField), whatever the weeks.
    const silent = asks.map(s => s.to).find(id => id !== who)!;
    await w.run(22 * DAY);
    const reasons = w.log("ask_sent").filter(l => l.detail.memberId === silent).map(l => String(l.detail.reason));
    const all = w.net.exportState().asks.filter(a => a.memberId === silent).map(a => a.reason);
    expect(reasons.length).toBeGreaterThan(0);
    for (const r of new Set(all)) expect(all.filter(x => x === r).length).toBeLessThanOrEqual(2);
  }, 10 * T);

  test("probe, booked date at a public place, share-my-date, and the check-in after the date", async () => {
    const w = new SlopWorldNet();
    await w.joinAll();
    await w.run(HOUR);
    const mark = w.sent.length;
    const [a, b] = await bookFirst(w);
    const probes = w.sent.slice(mark).filter(s => s.meta.type === "probe");
    expect(probes.length).toBe(2);
    for (const p of probes) {
      expect(p.body).toMatch(/go on a date with/);
      // An age band and a distance band, never an age, a name or a zip.
      expect(p.body).toMatch(/in their (early|mid|late) \d0s|in their 18-19/);
      expect(p.body).toMatch(/(under 2 mi|about (2-5|5-10|10-25|25\+) mi) away/);
      expect(p.body).not.toMatch(/\b\d{5}\b/);
      const other = p.to === a ? b : a;
      for (const part of w.members.find(m => m.id === other)!.name.split(" ")) if (part.length > 2) expect(p.body).not.toContain(part);
    }
    const reveals = w.sent.slice(mark).filter(s => s.meta.type === "proposal");
    expect(reveals.map(r => r.to).sort()).toEqual([a, b].sort());
    for (const r of reveals) {
      expect(r.body).toMatch(/a first date with/);
      expect(r.body).toMatch(/forward this text to a friend/);
      const place = /Meet at (.+?) \(/.exec(r.body)?.[1];
      expect(place && PUBLIC.has(place)).toBe(true);
    }
    const m2 = w.sent.length;
    await untilCheckIn(w, a, b);
    const checkIns = w.sent.slice(m2).filter(s => s.meta.type === "feedback_request");
    expect(checkIns.map(c => c.to).sort()).toEqual([a, b].sort());
    expect(checkIns[0]!.body).toMatch(/How did your date with .+ go\? .*safety team/);
  }, 5 * T);

  test("a report at the check-in: a case, a block, out of matching until staff decide; hold, dismiss and ban", async () => {
    const w = new SlopWorldNet();
    await w.joinAll();
    await w.run(HOUR);
    const [a, b] = await bookFirst(w);
    await untilCheckIn(w, a, b);
    expect(w.awaiting(a)).toBe("feedback");
    await w.say(a, "He was rude the whole time and kept texting me after I left.");
    expect(w.to(a).at(-1)!.body).toMatch(/flagged this for the safety team/);
    const [r] = w.net.safetyReports();
    expect(r).toMatchObject({ kind: "harassment", reporterId: a, subjectId: b, status: "open", source: "check_in", priorReports: 0 });
    // The report keeps no words.
    expect(JSON.stringify(r)).not.toMatch(/rude|texting/);
    expect(w.net.eligible(b)).toBe(false);
    expect(w.net.safetyCases().find(c => c.memberId === b)!.events.map(e => e.kind)).toContain("report:harassment");
    // Staff dismiss: the member can be matched again (the pair stays blocked).
    expect(w.net.dismissReport(r!.id, "safety@test", "checked the messages").ok).toBe(true);
    expect(w.net.dismissReport(r!.id, "safety@test", "again")).toEqual({ ok: false, reason: "already_dismissed" });
    expect(w.net.packInput(w.clock.now()).safetyHolds?.some(h => h.memberId === b)).toBe(false);
    // Staff hold, then ban: held everywhere here, every report reads "banned".
    expect(w.net.holdMember(b, "safety@test", "second look").ok).toBe(true);
    expect(w.net.eligible(b)).toBe(false);
    expect(w.net.markBanned(b, "safety@test", "confirmed").ok).toBe(true);
    expect(w.net.safetyReports().every(x => x.subjectId !== b || x.status === "banned" || x.status === "dismissed")).toBe(true);
    // A restart keeps the reports.
    const st = JSON.parse(JSON.stringify(w.net.exportState()));
    expect(st.reports).toHaveLength(1);
  }, 5 * T);

  test("a no-show at the check-in is a no_show report", async () => {
    const w = new SlopWorldNet({ seed: 2 });
    await w.joinAll();
    await w.run(HOUR);
    const [a, b] = await bookFirst(w);
    await untilCheckIn(w, a, b);
    await w.say(b, "they never showed up");
    expect(w.net.safetyReports()[0]).toMatchObject({ kind: "no_show", reporterId: b, subjectId: a });
    // A no-show is not urgent: the member stays matchable while staff look.
    expect(w.net.packInput(w.clock.now()).safetyHolds?.some(h => h.memberId === a)).toBe(false);
  }, 5 * T);
});

describe("peon and friends packs", () => {
  test("peon runs peonPack behind review; a member aged 13-17 is never in its input", async () => {
    const w = appWiring("peon");
    const mini = new Mini([
      { id: "p1", name: "Ana Diaz", age: 30, interests: ["startups"] }, { id: "p2", name: "Bo Kim", age: 41, interests: ["startups"] },
      { id: "kid", name: "Teen Lee", age: 16, interests: ["startups"] },
    ], { app: APPS.peon, pack: w.pack, engine: w.engine, plans: w.plans, review: "human", maxNewPerDay: 20 });
    await mini.onboard("p1", "p2", "kid");
    await mini.run(DAY);
    expect(mini.net.packInput(mini.clock.now()).members.map(m => m.id).sort()).toEqual(["p1", "p2"]);
    expect(idsIn(mini.net, mini.clock.now()).has("kid")).toBe(false);
    expect(mini.sent.filter(s => s.meta.type === "probe")).toHaveLength(0);
    expect(mini.net.reviewQueue().every(i => i.proposal.category === "professional")).toBe(true);
  }, T);

  test("friends runs friendsPack with its plans config; only social and hobby; minors out of the input", async () => {
    const w = appWiring("friends");
    expect(w.pack?.id).toBe("friends");
    const mini = new Mini([
      { id: "f1", name: "Cy Ono", age: 28, interests: ["climbing"], area: "Williamsburg" }, { id: "f2", name: "Di Park", age: 33, interests: ["climbing"], area: "Greenpoint" },
      { id: "kid", name: "Teen Ray", age: 15, interests: ["climbing"], area: "Williamsburg" },
    ], { app: APPS.friends, pack: w.pack, plansConfig: w.plansConfig, review: "human", maxNewPerDay: 20 });
    await mini.onboard("f1", "f2", "kid");
    await mini.run(DAY);
    expect(idsIn(mini.net, mini.clock.now()).has("kid")).toBe(false);
    expect(mini.net.reviewQueue().every(i => ["social", "hobby"].includes(i.proposal.category ?? ""))).toBe(true);
    // Romance is never offered to a friends member (the pack has no lane; the Network refuses the category).
    expect(appWiring("friends").prefs(30).categoriesOptIn).not.toContain("romance");
    expect(appWiring("slop").prefs(16)).toEqual({ categoriesOptIn: [], romanceOptIn: false });
  }, T);
});

describe("slop answer parsing and reports (hand-written cases)", () => {
  test.each([
    ["I'm a woman looking for men", { is: "woman", seeks: ["man"] }],
    ["straight guy", { is: "man", seeks: ["woman"] }],
    ["gay man", { is: "man", seeks: ["man"] }],
    ["lesbian", { is: "woman", seeks: ["woman"] }],
    ["I'm nonbinary and open to everyone", { is: "nonbinary", seeks: ["man", "nonbinary", "woman"] }],
    ["bi woman", { is: "woman", seeks: ["man", "woman"] }],
    ["I am a man, into women and nonbinary people", { is: "man", seeks: ["nonbinary", "woman"] }],
    ["I like hiking and coffee", {}],
  ] as const)("orientation: %s", (text, want) => {
    expect(parseOrientation(text)).toEqual(want as never);
  });
  test("a bare answer to the orientation question names who they seek", () => {
    expect(parseOrientation("women", true)).toEqual({ seeks: ["woman"] });
    expect(parseOrientation("women", false)).toEqual({});
  });
  test("age ranges never go under 18; a decade needs the question", () => {
    expect(parseAgeRange("25-35", false)).toEqual([25, 35]);
    expect(parseAgeRange("between 30 and 40", false)).toEqual([30, 40]);
    expect(parseAgeRange("16 to 25", false)).toEqual([18, 25]);
    expect(parseAgeRange("30s", true)).toEqual([30, 39]);
    expect(parseAgeRange("in my 30s", false)).toBeUndefined();
    expect(parseAgeRange("12-15", false)).toBeUndefined();
  });
  test("distance: miles, the whole city, a bare number only as an answer", () => {
    expect(parseDistance("within 10 miles", false)).toEqual({ miles: 10 });
    expect(parseDistance("just my city", false)).toEqual({ city: true });
    expect(parseDistance("5", true)).toEqual({ miles: 5 });
    expect(parseDistance("5", false)).toBeUndefined();
  });
  test("a neighborhood maps to the nearest zip the pack knows; an unknown place maps to nothing", () => {
    expect(zipForArea("Williamsburg")).toBe("11211");
    expect(zipForArea("Narnia")).toBeUndefined();
  });
  test("an evening date is at a lit public place, never a park", () => {
    const thu7pm = Date.UTC(2026, 9, 15, 23);
    const v = slopVenue([{ lat: 40.7128, lon: -73.953 }, { lat: 40.6681, lon: -73.986 }], "walk", thu7pm)!;
    expect(EVENING).toContain(v.name);
    const sat2pm = Date.UTC(2026, 9, 17, 18);
    expect(VENUES.map(x => x.name)).toContain(slopVenue([{ lat: 40.7128, lon: -73.953 }], "walk", sat2pm)!.name);
  });
  test.each([
    ["he was rude and kept texting me", "harassment"],
    ["I felt unsafe, he wouldn't let me leave", "unsafe"],
    ["she asked me for money on venmo", "scam"],
    ["he looked nothing like his photos, total catfish", "lying"],
    ["they never showed up", "no_show"],
    ["he's 16, he told me at the bar", "minor"],
    ["she was 15 minutes late but fine", "other"],
    ["it was 9 when we left", "other"],
  ] as const)("report kind: %s", (text, kind) => {
    expect(reportKindOf(text)).toBe(kind);
  });
  test("a happy check-in is not a report", () => {
    expect(checkInReport("It was great, we're seeing each other again!")).toBeUndefined();
    expect(checkInReport("not my type but nice")).toBeUndefined();
    expect(checkInReport("please report him")).toBe("other");
  });
});
