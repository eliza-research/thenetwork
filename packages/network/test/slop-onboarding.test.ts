// slop.date's onboarding (service/slopOnboarding.ts) on a ConsentNetwork with matching off, as the
// service runs it: the hard fields are asked and learned before activation, the read-back takes a
// correction, photos are asked once and only of adults, one resume nudge, and a profile from the
// member's AI assistant (source "mcp") never answers a probe or cancels a booked date.
import { describe, expect, test } from "bun:test";
import { copy, copyFor, brandOf, runStored, styleViolations } from "../src/index.ts";
import { APPS } from "../../platform/src/apps.ts";
import { harness } from "./harness.ts";

const slop = copyFor(brandOf(APPS.slop)).dating;
const HARD = ["romance:age:", "romance:is:", "romance:seeks:", "slop:max_miles:", "slop:zip:", "slop:goal:"];
const member = async (h: ReturnType<typeof harness>, id: string) => ((await h.state()).members as any[]).find(m => m.id === id);

/** Text a member through onboarding; returns every reply, in order. */
async function talk(h: ReturnType<typeof harness>, id: string, lines: string[]) {
  const out: string[][] = [];
  for (const l of lines) out.push(await h.say(id, l));
  return out;
}

describe("slop onboarding with matching off", () => {
  test("happy path: hard fields before activation, read-back, a correction, then done with the photo ask", async () => {
    const h = harness("slop");
    h.add("m1", "Maya Lopez", 29);
    const r = await talk(h, "m1", ["hi", "something serious", "I'm a woman, not into men, looking for women, late 20s to mid 30s", "11211", "within 5 miles", "no smokers", "brunch, a long walk, a show"]);
    // Welcome: an AI, what it remembers and how to see or delete it, STOP, then the first question.
    expect(r[0]![0]).toContain("(an AI)");
    expect(r[0]![0]).toContain("slop.date/settings");
    expect(r[0]![0]).toContain("STOP");
    expect(r[0]![0]).toContain(slop.goal);
    // The hard-field question is sent, even though matching is off.
    expect(r[1]).toEqual([slop.who]);
    expect(r[2]).toEqual([slop.where]);
    expect(r[3]).toEqual([slop.radius]);
    expect(r[4]).toEqual([slop.dealbreakers]);
    expect(r[5]).toEqual([slop.weekend]);
    // Every hard field is known before activation.
    expect((await member(h, "m1")).stage).not.toBe("active");
    const tags = await h.tags("m1");
    for (const p of HARD) expect([p, tags.some(t => t.startsWith(p))]).toEqual([p, true]);
    expect(tags).toContain("romance:seeks:woman");
    expect(tags).not.toContain("romance:seeks:man");
    expect(tags).toContain("romance:age:27-36");
    expect(tags).toContain("slop:zip:11211");
    // The read-back: plain words, one question, never a score or a tag.
    const rb = r[6]![0]!;
    expect(rb).toStartWith("Here's what I have:");
    expect(rb).toContain("looking to meet women");
    expect(rb).toContain("ages 27-36");
    expect(rb).toEndWith("Anything I got wrong?");
    expect(rb).not.toMatch(/score|rating|safety|romance:|slop:/i);
    // A correction updates the tags and reads back again.
    const fix = await h.say("m1", "actually men only");
    expect(fix[0]).toContain("looking to meet men");
    expect(await h.tags("m1")).toContain("romance:seeks:man");
    expect(await h.tags("m1")).not.toContain("romance:seeks:woman");
    const done = await h.say("m1", "looks good");
    expect(done).toEqual([`${slop.done} ${slop.photoAsk("slop.date")}`]);
    expect((await member(h, "m1")).stage).toBe("active");
    // Within 12 turns (F4: 6-12 short exchanges).
    expect(h.sent.filter(s => s.memberId === "m1").length).toBeLessThanOrEqual(12);
    // The photo ask is never sent twice.
    await talk(h, "m1", ["thanks!", "can you find me a date this weekend?"]);
    expect(h.sent.filter(s => s.body.includes("#photos")).length).toBe(1);
    // The engine sees the questions as asked and answered.
    expect(((await h.state()).asks as { reason: string; answeredAt?: number }[]).filter(a => a.reason === "slop_orientation" && a.answeredAt).length).toBe(1);
  });

  test("questions whose answers are known are skipped; a partial answer gets a narrower follow-up", async () => {
    const h = harness("slop");
    h.add("m2", "Sam Reed", 33);
    const r = await talk(h, "m2", ["hey", "I'm a man looking for women 28-34, something serious", "I'm in Williamsburg"]);
    // Goal, gender, seeking and age came in one answer: straight to where.
    expect(r[1]).toEqual([slop.where]);
    expect(r[2]).toEqual([slop.radius]);
    const h2 = harness("slop");
    h2.add("m3", "Ana Ruiz", 30);
    const r2 = await talk(h2, "m3", ["hi", "not sure yet", "women, 25-35"]);
    expect(r2[2]).toEqual([slop.whoIs]);
    expect(await h2.say("m3", "I'm nonbinary")).toEqual([slop.where]);
    const h3 = harness("slop");
    h3.add("m6", "Jae Wu", 30);
    expect((await talk(h3, "m6", ["hi", "serious", "I'm a man into men"]))[2]).toEqual([slop.whoAge]);
  });

  test("a question with no usable answer is asked once more, then dropped", async () => {
    const h = harness("slop");
    h.add("m4", "Lee Park", 40);
    const r = await talk(h, "m4", ["hi", "hmm", "idk", "fine"]);
    expect(r[1]).toEqual([slop.goal]);
    expect(r[2]).toEqual([slop.who]);
    expect(r[3]).toEqual([slop.who]);
  });

  test("the read-back allows at most 2 correction rounds, then onboarding finishes", async () => {
    const h = harness("slop");
    h.add("m5", "Kim Diaz", 31);
    await talk(h, "m5", ["hi", "casual", "I'm a woman into men, 30-40", "10001", "10 miles", "none", "climbing"]);
    expect((await h.say("m5", "that's wrong"))).toEqual([slop.fixAsk]);
    expect((await h.say("m5", "actually 32-42"))[0]).toContain("ages 32-42");
    expect((await h.say("m5", "actually 33-43"))[0]).toStartWith(slop.done);
    expect(await h.tags("m5")).toContain("romance:age:33-43");
    expect((await member(h, "m5")).stage).toBe("active");
  });
});

describe("photos: adults only, once", () => {
  test("never for a 16-year-old", async () => {
    const h = harness("slop");
    h.add("t1", "Jo Kim", 16);
    await talk(h, "t1", ["hi", "something serious", "I'm a girl into guys, 16-18", "11211", "5 miles", "none", "skating", "yes"]);
    expect(h.sent.some(s => s.body.includes("#photos"))).toBe(false);
    expect(h.sent.some(s => s.body === slop.who)).toBe(false);
    expect(await h.tags("t1")).toEqual([]);
  });

  test("never for an adult record who says they are 16 mid-way, and onboarding stops", async () => {
    const h = harness("slop");
    h.add("t2", "Ari Bell", 19);
    await talk(h, "t2", ["hi", "something serious", "actually I'm 16", "I'm a girl into guys, 16-18", "11211", "yes"]);
    expect(h.sent.some(s => s.body.includes("#photos"))).toBe(false);
    expect(h.sent.filter(s => s.body === slop.where || s.body === slop.radius)).toEqual([]);
  });

  test("unknown age: asked first; an adult answer starts onboarding and can get the photo ask", async () => {
    const h = harness("slop");
    h.add("u1", "Rae Cho", undefined);
    const r = await talk(h, "u1", ["hi", "27"]);
    expect(r[0]![0]).toContain("how old are you?");
    expect(r[1]![0]).toContain("slop.date/settings");
    expect(r[1]![0]).toEndWith(slop.goal);
    await talk(h, "u1", ["long term", "I'm a woman into women, 25-32", "11206", "walking distance", "no", "museums", "yes"]);
    expect(h.sent.filter(s => s.body.includes("#photos")).length).toBe(1);
    const h2 = harness("slop");
    h2.add("u2", "Ira Moe", undefined);
    await talk(h2, "u2", ["hi", "don't want to say", "something serious", "yes"]);
    expect(h2.sent.some(s => s.body.includes("#photos"))).toBe(false);
  });
});

describe("resume nudge", () => {
  test("one nudge after a day of silence mid-way, never a second", async () => {
    const h = harness("slop");
    h.add("r1", "Noa Gray", 35);
    await talk(h, "r1", ["hi", "something serious"]);
    const first = (await h.wait(30 * h.HOUR)).filter(s => s.memberId === "r1");
    expect(first.length).toBe(1);
    expect(first[0]!.body).toBe(slop.resume("who would you like to meet?"));
    expect(first[0]!.ts - h.sent.filter(s => s.memberId === "r1").at(-2)!.ts).toBeGreaterThanOrEqual(h.DAY);
    expect((await h.wait(72 * h.HOUR)).filter(s => s.memberId === "r1")).toEqual([]);
    // The answer still continues onboarding.
    expect(await h.say("r1", "women, I'm a woman, 30-40")).toEqual([slop.where]);
  });

  test("no nudge for a member who never answered the welcome, or who finished", async () => {
    const h = harness("slop");
    h.add("r2", "Uma Fox", 35);
    await talk(h, "r2", ["hi"]);
    h.add("r3", "Eli Stone", 41);
    await talk(h, "r3", ["hi", "casual", "man into women 35-45", "10003", "city", "none", "bikes", "yes"]);
    expect((await h.wait(96 * h.HOUR)).filter(s => s.memberId === "r2" || s.memberId === "r3")).toEqual([]);
  });
});

describe("a profile from the member's AI assistant (source mcp)", () => {
  test("before the first text: learned first, and the welcome skips what it gave", async () => {
    const h = harness("slop");
    h.add("p1", "Bo Lane", 30);
    const r = await h.say("p1", "I'm a man looking for women 27-34, something serious. I live in Bushwick, zip 11237. Love cooking and live music.", "mcp");
    expect(r.length).toBe(1);
    expect(r[0]).toContain("STOP");
    expect(r[0]).toEndWith(slop.radius);
    expect(await h.tags("p1")).toEqual(expect.arrayContaining(["romance:is:man", "romance:seeks:woman", "romance:age:27-34", "slop:zip:11237", "slop:goal:long_term"]));
  });

  test("mid-way: the open question it answered is replaced by the next one; nothing is sent otherwise", async () => {
    const h = harness("slop");
    h.add("p2", "Cy Hart", 30);
    await talk(h, "p2", ["hi", "something serious"]);
    expect(await h.say("p2", "I'm a woman who likes men, ages 30 to 38", "mcp")).toEqual([slop.where]);
    expect(await h.say("p2", "I love hiking and dogs", "mcp")).toEqual([]);
    // It is not counted as the member's answer to where.
    expect((await member(h, "p2")).onboarding.answered).toEqual(["goal"]);
  });

  test("never answers an open probe or cancels a booked date", async () => {
    const h = harness("slop");
    const onboard = async (id: string, name: string, is: string, seeks: string) => {
      h.add(id, name, 30);
      await talk(h, id, ["hi", "something serious", `I'm a ${is} looking for ${seeks}, 25-35`, "11211", "5 miles", "none", "brunch", "yes"]);
    };
    await onboard("a", "Maya Lopez", "woman", "men");
    await onboard("b", "Sam Reed", "man", "women");
    await runStored(h.net, h.store, n => n.setMatchingEnabled(true, "test"));
    for (let i = 0; i < 48 && !h.net.reviewQueue().length; i++) await h.wait(h.HOUR);
    // A person approves (review mode "human").
    await runStored(h.net, h.store, n => { for (const it of n.reviewQueue()) expect(n.review(it.oppId, "approve", { reviewer: "staff@test" })).toBe(true); });
    const probe = h.sent.find(s => s.type === "probe")!;
    expect(probe).toBeDefined();
    const id = probe.memberId, other = id === "a" ? "b" : "a";
    expect((await member(h, id)).awaiting.kind).toBe("probe");
    expect(await h.say(id, "Yes to dogs! No to smokers. I love brunch.", "mcp")).toEqual([]);
    expect((await member(h, id)).awaiting.kind).toBe("probe");
    expect(h.logs.filter(l => l.type === "probe_answer")).toEqual([]);
    // The member's own yes in the thread is the answer.
    await h.say(id, "yes, that works");
    for (let i = 0; i < 30 && h.sent.filter(s => s.type === "probe").length < 2; i++) await h.wait(h.HOUR);
    await h.say(other, "yes");
    expect((await member(h, id)).awaiting.kind).toBe("booked");
    expect(await h.say(id, "I can't stand smokers and no I won't date anyone rude", "mcp")).toEqual([]);
    expect((await member(h, id)).awaiting.kind).toBe("booked");
    expect(h.logs.filter(l => /drop|cancel/.test(l.type))).toEqual([]);
    expect(h.net.opps.get((await member(h, id)).awaiting.oppId)?.stage).toBe("scheduled");
  });
});

describe("copy", () => {
  test("every slop onboarding text passes the style rules; the welcome is a first contact", () => {
    const long = "Alexandria";
    expect(styleViolations(slop.welcome(long, slop.who, "slop.date", "Christopher"), { firstContact: true })).toEqual([]);
    expect(styleViolations(slop.welcome(long, slop.goal, "slop.date"), { firstContact: true })).toEqual([]);
    expect(styleViolations(slop.afterAge(slop.who, "slop.date"))).toEqual([]);
    for (const t of [slop.goal, slop.who, slop.whoAge, slop.whoIs, slop.whoSeeks, slop.where, slop.radius, slop.dealbreakers, slop.weekend, slop.fixAsk, slop.readBackEmpty,
      `${slop.done} ${slop.photoAsk("slop.date")}`, slop.resume("who would you like to meet?"),
      slop.readBack("you're a nonbinary person looking to meet women, men and nonbinary people, ages 27-36; near 11211, up to 25 miles away; looking for something serious; dealbreakers: smokers, heavy drinkers and someone who never wants kids")]) {
      expect([t, styleViolations(t)]).toEqual([t, []]);
    }
  });

  test("ntwrk onboarding is unchanged", async () => {
    const h = harness("ntwrk");
    h.add("n1", "Dana Fields", 34);
    const r = await talk(h, "n1", ["hi", "more friends who like climbing", "weekends, around Williamsburg", "small groups"]);
    expect(r[0]).toEqual([copy.welcome("Dana")]);
    expect(r[1]).toEqual([copy.interview.availability]);
    expect(r[2]).toEqual([copy.interview.format]);
  });
});
