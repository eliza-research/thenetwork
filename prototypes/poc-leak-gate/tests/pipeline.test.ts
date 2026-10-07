// Offline tests for fixes 1-3: scrubbed LLM context, scope-aware own facts, and every decide() branch (fake LLM).
import { test, expect, describe } from "bun:test";
import type { ChatMessage, LLM } from "@thenetwork/core";
import { decide, timeoutFor, deterministicCheck, hasRawContact, renderGateContext, scrubText, send, subjectOf, type GateInput, type MemberCard } from "../src/index.ts";

const maya: MemberCard = { id: "m1", name: "Maya Okafor", facets: [
  { id: "m1:f1", kind: "interest", value: "bouldering", scope: "public" },
  { id: "m1:f2", kind: "fact", value: "is going through a divorce and doesn't want anyone to know yet (ref XE-4029-THISTLE)", scope: "agent_private", topic: "relationship" },
  { id: "m1:f3", kind: "phone", value: "+1-917-555-0133", scope: "agent_private", topic: "contact" },
  { id: "m1:f4", kind: "email", value: "member+m1@example.com", scope: "agent_private", topic: "contact" },
  { id: "m1:f5", kind: "address", value: "lives at 412 Juniper St, Apt 3B", scope: "agent_private", topic: "location" },
  { id: "m1:f6", kind: "routine", value: "swims at the Alder St rec center pool at 6:10am on Tuesdays and Thursdays (37.7599, -122.4148)", scope: "agent_private", topic: "location" },
  { id: "m1:f7", kind: "fact", value: "is openly gay and helps run a queer hiking group", scope: "public", topic: "sexuality" },
  { id: "m1:f8", kind: "preference", value: "Open to dating; interested in women, ages 25-35", scope: "agent_private", topic: "dating" },
] };
const sam: MemberCard = { id: "m2", name: "Sam Chen", facets: [
  { id: "m2:f1", kind: "interest", value: "bouldering", scope: "public" },
  { id: "m2:f2", kind: "fact", value: "was laid off last month and is on unemployment", scope: "agent_private", topic: "finance" },
  { id: "m2:f3", kind: "phone", value: "+1-646-555-0199", scope: "agent_private", topic: "contact" },
  { id: "m2:f4", kind: "address", value: "lives at 88 Linden Ave, Apt 2C", scope: "agent_private", topic: "location" },
  { id: "m2:f5", kind: "fact", value: "has a DUI from a few years ago", scope: "agent_private", topic: "legal" },
] };
const theo: MemberCard = { id: "m3", name: "Theo Alvarez", facets: [{ id: "m3:f1", kind: "fact", value: "is behind on rent", scope: "agent_private", topic: "finance" }] };
const base: Omit<GateInput, "draft"> = {
  recipientId: "m2", participantIds: ["m2", "m1"], members: [sam, maya, theo],
  directory: [{ id: "m1", name: "Maya Okafor" }, { id: "m2", name: "Sam Chen" }, { id: "m3", name: "Theo Alvarez" }],
  canaries: [{ memberId: "m1", token: "XE-4029-THISTLE" }, { memberId: "m2", token: "QQ-1111-OWN" }],
  allowedPlaces: ["Lantern Coffee", "1180 Valencia St"],
};
const inp = (draft: string, over: Partial<GateInput> = {}): GateInput => ({ ...base, ...over, draft });

/** Fake LLM: fixed JSON verdict; records prompts so tests can inspect what the model was shown. */
function fake(v: { leak?: boolean; topics?: string[]; romance?: boolean } = {}, seen: ChatMessage[][] = []): LLM {
  return { chat: async (m: ChatMessage[]) => { seen.push(m); return JSON.stringify({ reasoning: "t", quote: v.leak ? "x" : "", category: v.leak ? "inference" : "none", leak: !!v.leak, sensitive_topics_about_others: v.topics ?? [], romance_framing: !!v.romance }); } };
}

describe("fix 1: raw contact details never reach the LLM prompt", () => {
  test("scrubText replaces phones, emails, street addresses, units, coordinates, ref codes", () => {
    const s = scrubText("call +1-917-555-0133 or member+m1@example.com, 412 Juniper St, Apt 3B, at 37.7599, -122.4148, ref XE-4029-THISTLE, on Alder St");
    expect(s).toContain("[PHONE]"); expect(s).toContain("[EMAIL]"); expect(s).toContain("[STREET_ADDRESS]");
    expect(s).toContain("[COORDINATES]"); expect(s).toContain("[REF_CODE]"); expect(s).toContain("[STREET]");
    expect(hasRawContact(s)).toBe(false);
  });
  test("the c2 prompt contains placeholders, not raw values (venue address excepted)", async () => {
    const seen: ChatMessage[][] = [];
    await decide(inp("Sam, Maya also boulders. Coffee Thursday?"), { llm: fake({}, seen) });
    const user = seen[0]!.find(m => m.role === "user")!.content;
    for (const raw of ["917-555-0133", "member+m1@example.com", "412 Juniper", "Apt 3B", "Alder St", "37.7599", "XE-4029", "646-555-0199", "88 Linden"]) expect(user).not.toContain(raw);
    expect(user).toContain("[PHONE]");
    expect(user).toContain("swims at the [STREET] rec center pool at 6:10am on Tuesdays and Thursdays");
    expect(user).toContain("1180 Valencia St"); // public venue stays
  });
  test("c1 (legacy) still renders raw values, so the before/after is measurable", () => {
    expect(renderGateContext(inp("x"), "c1")).toContain("412 Juniper St");
  });
});

describe("fix 2: scope-aware own facts", () => {
  test("c2 labels each fact's owner and visibility relative to the recipient", () => {
    const ctx = renderGateContext(inp("x"), "c2");
    expect(ctx).toMatch(/owner: Sam \(RECIPIENT\) \| visibility: the recipient's own private fact; fine to say back to Sam\] was laid off/);
    expect(ctx).toMatch(/owner: Maya \(co-participant\) \| visibility: SHAREABLE with Sam\] bouldering/);
    expect(ctx).toMatch(/owner: Maya \(co-participant\) \| visibility: HIDDEN from Sam\] is going through a divorce/);
    expect(ctx).toMatch(/owner: Theo Alvarez \(NOT a participant\) \| visibility: HIDDEN from Sam \(name hidden too\)\] is behind on rent/);
  });
  test("the recipient's own phone, address and canary are not deterministic hits", () => {
    for (const d of ["Sam, we have your number as 646-555-0199, right?", "Sam, want to meet near your place at 88 Linden Ave?", "Sam, your ref is QQ-1111-OWN"])
      expect(deterministicCheck(inp(d)).core).toBe(false);
    expect(deterministicCheck(inp("Maya's number is 917-555-0133")).core).toBe(true);
  });
  test("lexicon ignores the recipient's own topic in a recipient-only sentence, not when about someone else", () => {
    expect(deterministicCheck(inp("Thinking of you during the layoff, Sam. Coffee with Maya might be a nice break.")).lexicon).toBe(false);
    expect(deterministicCheck(inp("Maya just went through layoffs at her company.")).lexicon).toBe(true);
  });
  test("post-test3 fix: an ambiguous name inside a place name is not a non-participant", () => {
    const withHaven = inp("Sam, Maya is a fellow Mott Haven neighbor.", { directory: [...base.directory, { id: "m9", name: "Haven Belell" }] });
    expect(deterministicCheck(withHaven).findings.map(f => f.rule)).not.toContain("nonparticipant_name");
    expect(deterministicCheck({ ...withHaven, draft: "Haven said no, so it's just you two." }).findings.map(f => f.rule)).toContain("nonparticipant_name");
  });
  test("subject attribution", () => {
    expect(subjectOf("Thinking of you during the layoff.", inp(""))).toBe("recipient");
    expect(subjectOf("Since you're both in recovery, a dry bar works.", inp(""))).toBe("others");
    expect(subjectOf("Maya mentioned it to you.", inp(""))).toBe("others");
  });
});

describe("fix 3: decide() branches", () => {
  test("clean -> SEND with a LeakCheckedMessage that send() accepts", async () => {
    const r = await decide(inp("Sam, Maya also boulders. Coffee at Lantern Coffee Thursday?"), { llm: fake() });
    expect(r.decision).toBe("SEND");
    expect(r.reason).toBe("ok");
    const sent: string[] = [];
    if (r.decision === "SEND") await send(r.message, { deliver: async (to, body) => { sent.push(`${to}:${body}`); } });
    expect(sent.length).toBe(1);
  });
  test("deterministic hit -> BLOCK without calling the LLM", async () => {
    let called = false;
    const r = await decide(inp("text Maya at 917-555-0133"), { llm: { chat: async () => { called = true; return "{}"; } } });
    expect(r.decision).toBe("BLOCK");
    expect(r.reasons[0]!.code).toBe("deterministic");
    expect(called).toBe(false);
    expect("message" in r).toBe(false);
  });
  test("LLM leak -> HOLD_REVIEW", async () => {
    const r = await decide(inp("Maya could use a distraction while things settle at home."), { llm: fake({ leak: true }) });
    expect(r.decision).toBe("HOLD_REVIEW");
    expect(r.reasons[0]!.code).toBe("llm_leak");
  });
  test("LLM unparseable output -> HOLD_REVIEW (llm_error)", async () => {
    const r = await decide(inp("Sam, Maya also boulders."), { llm: { chat: async () => "not json" } });
    expect(r.decision).toBe("HOLD_REVIEW");
    expect(r.reasons.map(x => x.code)).toContain("llm_error");
  });
  test("LLM throws (network) -> HOLD_REVIEW (llm_error)", async () => {
    const r = await decide(inp("Sam, Maya also boulders."), { llm: { chat: async () => { throw new Error("ECONNRESET"); } } });
    expect(r.decision).toBe("HOLD_REVIEW");
    expect(r.reasons.map(x => x.code)).toContain("llm_error");
  });
  test("LLM timeout (configurable) -> HOLD_REVIEW (llm_timeout)", async () => {
    const slow: LLM = { chat: () => new Promise(res => setTimeout(() => res(JSON.stringify({ reasoning: "", leak: false })), 300)) };
    const t0 = performance.now();
    const r = await decide(inp("Sam, Maya also boulders."), { llm: slow, timeoutMs: 25 });
    expect(performance.now() - t0).toBeLessThan(250);
    expect(r.decision).toBe("HOLD_REVIEW");
    expect(r.reasons[0]!.code).toBe("llm_timeout");
    expect(r.llm?.timedOut).toBe(true);
  });
  test("default mode is async with a 15 s deadline; live is 8 s", () => {
    expect(timeoutFor({})).toBe(15000);
    expect(timeoutFor({ mode: "async" })).toBe(15000);
    expect(timeoutFor({ mode: "live" })).toBe(8000);
    expect(timeoutFor({ mode: "live", timeoutMs: 99 })).toBe(99);
  });
  test("live mode: a hedged second request rescues a stalled first call", async () => {
    let n = 0;
    const firstStalls: LLM = { chat: () => (++n === 1 ? new Promise(() => {}) : Promise.resolve(JSON.stringify({ reasoning: "fine", leak: false }))) };
    const r = await decide(inp("Sam, Maya also boulders."), { llm: firstStalls, mode: "live", timeoutMs: 200, hedgeAfterMs: 20 });
    expect(n).toBe(2);
    expect(r.decision).toBe("SEND");
  });
  test("live mode: both calls stalled still fails closed at the deadline", async () => {
    const stall: LLM = { chat: () => new Promise(() => {}) };
    const r = await decide(inp("Sam, Maya also boulders."), { llm: stall, mode: "live", timeoutMs: 60, hedgeAfterMs: 20 });
    expect(r.decision).toBe("HOLD_REVIEW");
    expect(r.reasons[0]!.code).toBe("llm_timeout");
  });
  test("async mode never hedges", async () => {
    let n = 0;
    const slow: LLM = { chat: () => { n++; return new Promise(res => setTimeout(() => res(JSON.stringify({ reasoning: "", leak: false })), 60)); } };
    await decide(inp("Sam, Maya also boulders."), { llm: slow, timeoutMs: 1000, hedgeAfterMs: 10 });
    expect(n).toBe(1);
  });
  test("a fast LLM inside the deadline is not a timeout", async () => {
    const r = await decide(inp("Sam, Maya also boulders."), { llm: fake(), timeoutMs: 1000 });
    expect(r.decision).toBe("SEND");
  });
  test("sensitive-word lexicon -> HOLD_REVIEW only, never BLOCK", async () => {
    const r = await decide(inp("Maya's marriage is ending, so be kind."), { llm: fake() });
    expect(r.decision).toBe("HOLD_REVIEW");
    expect(r.reasons.map(x => x.code)).toEqual(["lexicon"]);
  });
  test("dating/sexuality/legal/addiction about a non-recipient -> HOLD_REVIEW even when shareable", async () => {
    const r = await decide(inp("Sam, Maya helps run a queer hiking group and also boulders."), { llm: fake() });
    expect(r.decision).toBe("HOLD_REVIEW");
    expect(r.reasons.map(x => x.code)).toContain("sensitive_topic_other");
    expect(r.reasons.map(x => x.code)).not.toContain("lexicon"); // shareable, so not a lexicon hit
  });
  test("review topic via the LLM's topic tag (no lexicon word)", async () => {
    const r = await decide(inp("Sam, Maya keeps things low-key with the courts these days."), { llm: fake({ topics: ["legal"] }) });
    expect(r.decision).toBe("HOLD_REVIEW");
    expect(r.reasons[0]!.code).toBe("sensitive_topic_other");
  });
  test("non-review topics tagged by the LLM do not hold", async () => {
    const r = await decide(inp("Sam, Maya also boulders."), { llm: fake({ topics: ["health", "work"] }) });
    expect(r.decision).toBe("SEND");
  });
  test("the recipient's own review-topic fact is not a review hold", async () => {
    const r = await decide(inp("Sam, I know the DUI still weighs on you. No pressure on Thursday."), { llm: fake() });
    expect(r.reasons.map(x => x.code)).not.toContain("sensitive_topic_other");
    expect(r.decision).toBe("SEND");
  });
  test("romance framing without a shareable opt-in -> HOLD_REVIEW", async () => {
    const r = await decide(inp("Sam, I think you and Maya would have real chemistry over natural wine."), { llm: fake() });
    expect(r.decision).toBe("HOLD_REVIEW");
    expect(r.reasons[0]!.code).toBe("romance_no_optin");
  });
  test("friendly 'you two might click' alone is not deterministic romance framing (left to the LLM tag)", async () => {
    expect((await decide(inp("Thought you two might click over bouldering."), { llm: fake() })).decision).toBe("SEND");
    expect((await decide(inp("Thought you two might click over natural wine sometime."), { llm: fake({ romance: true }) })).decision).toBe("HOLD_REVIEW");
  });
  test("the recipient's own dating life in a recipient-only sentence is not romance framing", async () => {
    expect((await decide(inp("Sam, no pressure on your dating front. Maya also boulders, coffee Thursday?"), { llm: fake() })).decision).toBe("SEND");
  });
  test("romance framing via the LLM tag", async () => {
    const r = await decide(inp("Sam, Maya would love a candlelit wine bar with you."), { llm: fake({ romance: true }) });
    expect(r.decision).toBe("HOLD_REVIEW");
    expect(r.reasons.map(x => x.code)).toContain("romance_no_optin");
  });
  test("romance framing WITH a recipient-visible opt-in -> SEND", async () => {
    const mayaOpt: MemberCard = { ...maya, facets: maya.facets.map(f => (f.id === "m1:f8" ? { ...f, scope: "network" as const } : f)) };
    const r = await decide(inp("Sam, I think you and Maya would have real chemistry over natural wine.", { members: [sam, mayaOpt, theo] }), { llm: fake({ romance: true }) });
    expect(r.reasons).toEqual([]);
    expect(r.decision).toBe("SEND");
  });
  test("calendar 'date' and friendship 'connect' are not romance framing", async () => {
    const r = await decide(inp("Sam, does that date work? I think you and Maya will connect over bouldering."), { llm: fake() });
    expect(r.decision).toBe("SEND");
  });
  test("precedence: BLOCK beats every hold reason; all signals are still reported", async () => {
    const r = await decide(inp("Maya's marriage is ending; her number is 917-555-0133"), { llm: fake({ leak: true }), alwaysRunLLM: true });
    expect(r.decision).toBe("BLOCK");
    expect(r.reasons.map(x => x.code)).toEqual(expect.arrayContaining(["deterministic", "llm_leak", "lexicon"]));
  });
});
