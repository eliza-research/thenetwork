// The LLM reader's slop.date fields (extract.ts) and PII masking (core pii.ts): a fake model returns
// the dating fields; validation rejects anything out of shape; an LLM field never overrides what the
// offline parser read in the same message and is tagged "llm"; phones, emails, addresses and long
// digit runs are masked before the model sees the text, and a 5-digit zip is kept.
import { describe, expect, test } from "bun:test";
import { maskPii, SimClock, type ChatMessage, type LLM, type Member, type NetworkContext } from "@thenetwork/core";
import { appWiring } from "../service/packs.ts";
import { llmUnderstand, understandPrompt, validateSlopFields, validateUnderstood, type Understood } from "../src/extract.ts";
import { ConsentNetwork } from "../src/network.ts";

const BASE = { consent: null, times: [], wants: [], notWanted: [], interests: [], skills: [], area: null, selfAge: null };

/** A model that answers with `reply` and keeps what it was sent. */
function fakeLLM(reply: unknown) {
  const seen: ChatMessage[][] = [];
  const llm: LLM = { chat: async (m: ChatMessage[]) => { seen.push(m); return JSON.stringify(reply); } };
  return { llm, seen };
}

describe("slop fields from the LLM reader", () => {
  test("a fake model's slop fields come back validated", async () => {
    const { llm, seen } = fakeLLM({ ...BASE, slop: { is: "woman", seeks: ["man", "nonbinary"], ageRange: [28, 36], radiusMiles: 5, cityWide: null, zip: "11211", goal: "long_term", dealbreakers: ["smoker"] } });
    const u = await llmUnderstand(llm, { app: "slop" })("girl here, into guys and enbies, late 20s to mid 30s, not too far from 11211, no smokers", {});
    expect(u?.slop).toEqual({ is: "woman", seeks: ["man", "nonbinary"], ageRange: [28, 36], radiusMiles: 5, zip: "11211", goal: "long_term", dealbreakers: ["smoker"] });
    // The prompt asks for the dating fields only on slop.
    expect(seen[0]!.map(m => m.content).join("\n")).toMatch(/"slop":/);
    expect(understandPrompt("hi", {}).map(m => m.content).join("\n")).not.toMatch(/"slop":/);
  });

  test("validation rejects bad values (the whole reply fails closed)", () => {
    const bad: unknown[] = [
      { is: "robot" }, { seeks: ["men"] }, { ageRange: [16, 30] }, { ageRange: [30, 25] }, { ageRange: [25] }, { ageRange: ["25", "30"] },
      { radiusMiles: 0 }, { radiusMiles: 2.5 }, { radiusMiles: 500 }, { zip: "1121" }, { zip: 11211 }, { goal: "marriage" },
      { dealbreakers: ["tall"] }, { cityWide: "yes" }, { race: "any" }, "woman", [],
    ];
    for (const b of bad) expect(() => validateSlopFields(b)).toThrow();
    expect(validateSlopFields(null)).toBeUndefined();
    expect(validateSlopFields({ is: null, seeks: [], ageRange: null })).toBeUndefined();
    // Not slop: a "slop" key is an unknown key.
    expect(() => validateUnderstood({ ...BASE, slop: { is: "man" } }, {})).toThrow();
    expect(validateUnderstood({ ...BASE, slop: { is: "man" } }, { app: "slop" }).slop).toEqual({ is: "man" });
  });

  test("a model with bad slop fields gives nothing (the offline reading stands)", async () => {
    const { llm } = fakeLLM({ ...BASE, slop: { ageRange: [15, 20] } });
    expect(await llmUnderstand(llm, { app: "slop", attempts: 1 })("15 to 20", {})).toBeUndefined();
  });
});

describe("LLM slop fields in the Network", () => {
  function slopNet(u: Partial<Understood>) {
    const clock = new SimClock(Date.UTC(2026, 9, 6, 16));
    const members: Member[] = [{ id: "s", name: "Sam Lee", homeCity: "nyc", state: "normal", joinedAt: 0, age: 31, unansweredProactive: 0, prefs: { categoriesOptIn: ["romance"], quietHours: [21, 9], romanceOptIn: true, formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false } }];
    const ctx: NetworkContext = { clock, send: (id, body) => ({ id: "x", ts: clock.now(), direction: "outbound", channel: "imessage", from: "network", to: id, memberId: id, body, status: "delivered" }), snapshot: () => ({ now: clock.now(), members, facets: [], intents: [], presence: [], edges: [], recentProposals: [] }), recordProposal() {}, recordMeeting: m => m.proposalId, recordBlock() {}, log() {} };
    const w = appWiring("slop");
    let reading: Partial<Understood> | undefined;
    const net = new ConsentNetwork({ app: "slop", review: "human", pack: w.pack, hooks: w.hooks, plans: false, understand: async () => (reading ? { wants: [], notWanted: [], interests: [], skills: [], ...reading } : undefined) });
    net.init(ctx);
    const say = async (body: string, r?: Partial<Understood>) => { reading = r; await net.onInbound({ id: body, memberId: "s", body, ts: clock.now(), channel: "imessage" }); clock.advance(20 * 60_000); };
    const tags = () => (net.memberList().find(m => m.id === "s")!.appTags ?? []).map(t => `${t.tag}${t.provenance ? `/${t.provenance}` : ""}`).sort();
    return { say, tags, u };
  }

  test("LLM fields fill only what the parser found nothing for, tagged llm", async () => {
    const n = slopNet({});
    await n.say("hi");
    // The parser reads "25-30"; the model claims 40-50 (ignored) and a gender and goal the parser missed (used, tagged llm).
    // (The slop parser reads "something real" as a goal itself, so the text leaves the goal to the model.)
    await n.say("I'm into guys my age, 25-30", { slop: { is: "woman", seeks: ["woman"], ageRange: [40, 50], goal: "long_term" } });
    const t = n.tags();
    expect(t).toContain("romance:age:25-30");
    expect(t.some(x => x.startsWith("romance:age:40-50"))).toBe(false);
    expect(t).toContain("romance:is:woman/llm");
    expect(t).toContain("slop:goal:long_term/llm");
    // The parser read who they seek ("into guys"): the model's "woman" is not used.
    expect(t).toContain("romance:seeks:man");
    expect(t).not.toContain("romance:seeks:woman/llm");
  });
});

describe("PII masking before a third-party model call", () => {
  test("phones, emails, addresses, handles and long digit runs are masked; a zip stays", () => {
    const t = maskPii("text me at (212) 555-0123 or 555 0199, maya.r@gmail.com, I live at 123 Bedford Ave, acct 12345678, zip 11211, ages 25-30");
    expect(t).not.toMatch(/555|gmail|Bedford|12345678/);
    expect(t).toMatch(/\[phone\]/);
    expect(t).toMatch(/\[email\]/);
    expect(t).toMatch(/\[address\]/);
    expect(t).toMatch(/\[number\]/);
    expect(t).toContain("11211");
    expect(t).toContain("25-30");
  });

  test("the reader sends the masked text", async () => {
    const { llm, seen } = fakeLLM(BASE);
    await llmUnderstand(llm)("call me 917-555-0142 or sam@example.com, zip 10003", {});
    const sent = seen[0]!.map(m => m.content).join("\n");
    expect(sent).not.toMatch(/917|555-0142|sam@example\.com/);
    expect(sent).toContain("10003");
  });
});
