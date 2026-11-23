import { expect, test } from "vitest";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

test("a skill sought during onboarding is not the seeker's own capability", async () => {
  for (const seed of [1, 2, 3]) for (const row of [
    { body: "I need a product designer.", skill: "design", ask: "I want to meet other founders.", own: false },
    { body: "I am a product designer.", skill: "design", ask: "I want to meet other founders.", own: true },
    { body: "I'm looking for someone who plays bass.", skill: "bass", ask: "Help me start a band.", own: false },
    { body: "I play bass.", skill: "bass", ask: "Help me start a band.", own: true },
    { body: "Product designer.", skill: "design", ask: "I want to meet other founders.", own: true },
    { body: "Plays bass.", skill: "bass", ask: "Help me start a band.", own: true },
    { body: "Senior product designer at Acme.", skill: "design", ask: "I want to meet other founders.", own: true },
    { body: "Weekends mostly, product designer by trade.", skill: "design", ask: "I want to meet other founders.", own: true },
    { body: "Product designer in Brooklyn, plays bass on weekends.", skill: "bass", ask: "Help me start a band.", own: true },
    { body: "I enjoy quiet walks.", skill: "design", ask: "I want to meet other founders.", own: false },
    { body: "I'm looking for someone who can help me redesign my portfolio and mentor me through the process, ideally a senior product designer.", skill: "design", ask: "I want to meet other founders.", own: false },
    { body: "I'm looking for a guitar teacher who gives weekend lessons in Brooklyn and knows fingerstyle, and who plays guitar.", skill: "guitar", ask: "Help me start a band.", own: false },
    { body: "I need someone who can help because I struggle, a product designer for my portfolio.", skill: "design", ask: "I want to meet other founders.", own: false },
    { body: "I'm looking for someone I can learn from, a guitarist for weekend lessons.", skill: "guitar", ask: "Help me start a band.", own: false },
    { body: "I need a drummer and I run rehearsals with a guitarist.", skill: "guitar", ask: "Help me start a band.", own: false },
    { body: "I'm looking for a drummer and I play bass.", skill: "bass", ask: "Help me start a band.", own: true },
    { body: "I'm looking for a bassist and I am a bassist.", skill: "bass", ask: "Help me start a band.", own: true },
    { body: "I'm looking for a mentor and I'm a product designer.", skill: "design", ask: "I want to meet other founders.", own: true },
    { body: "I'm looking for a mentor and I am a senior product designer.", skill: "design", ask: "I want to meet other founders.", own: true },
    { body: "Looking for a mentor, my job as a product designer.", skill: "design", ask: "I want to meet other founders.", own: true },
    { body: "My colleague said, “I am a product designer.”", skill: "design", ask: "I want to meet other founders.", own: false },
    { body: "My colleague said, 'I am a product designer.'", skill: "design", ask: "I want to meet other founders.", own: false },
    { body: "My colleague is a product designer.", skill: "design", ask: "I want to meet other founders.", own: false },
    { body: "My colleague said, “I am a drummer.” I play bass.", skill: "bass", ask: "Help me start a band.", own: true, otherSkill: "drums" },
  ]) {
    const x = new Mini([{ id: "a", name: "Alice Able", age: 30 }, { id: "b", name: "Boris Bell", age: 32 }], { seed, inlineJudge: holdEveryItem.inline });
    await x.onboard("a");
    for (const text of ["hi!", row.body, "Weekends, mostly.", "One-on-one is good."]) await x.say("b", text);
    x.restart();
    const tags = x.net.engineInput(x.clock.now()).facets.filter(f => f.memberId === "b" && f.kind === "skill").flatMap(f => f.tags);
    expect(tags.includes(row.skill), row.body).toBe(row.own);
    if (row.otherSkill) expect(tags, row.body).not.toContain(row.otherSkill);
    await x.say("a", row.ask);
    await x.net.tick(x.clock.now());
    expect(x.net.reviewQueue().length).toBe(row.own ? 1 : 0);
    expect(x.net.reviewQueue().every(q => q.proposal.participants.includes("b"))).toBe(true);
    expect(x.sent.some(s => s.meta.type === "probe")).toBe(false);
  }
});

test.each(["job", "work"])("an assistant profile learns the member's %s beside a cofounder reference", async claim => {
  const x = new Mini([{ id: "b", name: "Boris Bell", age: 32 }], { inlineJudge: holdEveryItem.inline });
  await x.say("b", "hi!");
  const profile = {
    memberId: "b",
    body: `Looking for a co-founder, my ${claim} as a product designer.`,
    ts: x.clock.now(),
    channel: "sms",
  } as const;
  expect(await x.net.onInbound({ ...profile, id: "cofounder-reference" })).toBe("open");
  expect(x.net.engineInput(x.clock.now()).facets.some(f => f.memberId === "b" && f.kind === "skill")).toBe(false);
  await x.net.onInbound({
    ...profile,
    id: "approved-profile",
    source: "mcp",
  });
  for (const text of ["Weekends, mostly.", "One-on-one is good."]) await x.say("b", text);
  x.restart();
  expect(x.net.engineInput(x.clock.now()).facets.some(f => f.memberId === "b" && f.kind === "skill" && f.tags.includes("design"))).toBe(true);
  expect(x.net.reviewQueue()).toEqual([]);
});
