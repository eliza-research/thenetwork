// Judgment passes 1-3: prompt construction (explanation before verdict), parsing, privacy of
// member-facing text, and hard filters that no model verdict can override.
import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "@thenetwork/core";
import { runEngine } from "../src/engine.ts";
import { buildJudgeMessages, JUDGE_SYSTEM, JUDGE_SYSTEM_V3, parseVerdict } from "../src/judge.ts";
import { basisOf, boundaryRelevance, checkMemberFacing, keyOrderOk, parsePassVerdict, redactPrivate } from "../src/judgeCommon.ts";
import { buildPublicView, screenConfigOf, summarizeConnectedSources } from "../src/judgeContext.ts";
import * as Deep from "../src/judgeDeep.ts";
import { buildDeepMessages, DEEP_PROMPT_VERSION, DEEP_SYSTEM, gateMemberFacing, hardGate, parseDeepVerdict } from "../src/judgeDeep.ts";
import * as Screen from "../src/judgeScreen.ts";
import { parseScreenVerdict, SCREEN_PROMPT_VERSION, SCREEN_SYSTEM, screenMessages } from "../src/judgeScreen.ts";
import { privateVocabulary } from "../src/explain.ts";
import { baseMember, cand, facet, FakeLLM, mkWorld, sailingPair, verdictJson } from "./helpers.ts";

const order = (s: string, keys: string[]) => keys.map(k => s.lastIndexOf(`"${k}"`));
const increasing = (xs: number[]) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]!));

const screenJson = (o: Record<string, unknown> = {}) => JSON.stringify({
  reasoning: "P1.intents[0] wants to learn sailing; P2.matchable_do_not_quote[0] teaches it.", cited_facts: [],
  dealbreaker: false, dealbreaker_reason: "", verdict: "yes", match_probability: 0.8, accept_probability: { P1: 0.8, P2: 0.7 }, member_why: "You both like the bay.", ...o,
});
const deepJson = (o: Record<string, unknown> = {}) => JSON.stringify({
  evidence_review: "P1.facts[0] stated, fresh.", steelman_for: "Both want sailing.", steelman_against: "Cold intro.",
  rubric: { mutual_benefit: 4, reciprocity: 4, intent_timing: 4, logistics: 5, stage_fit: 3, values_energy: 4, novelty: 4, evidence_quality: 4, risk_safety: 5 },
  would_thank_us: { P1: "yes", P2: "yes" }, reasoning: "For outweighs against.", cited_facts: [],
  verdict: "yes", question_to_ask: null, match_probability: 0.75, member_why: { P1: "You both love being out on the water.", P2: "You both love being out on the water." }, ...o,
});
/** Answers each pass by its system prompt. */
const passLLM = (r: { screen?: string; judge?: string; deep?: string }) => new FakeLLM((m: ChatMessage[]) => {
  const sys = m[0]!.content;
  if (sys === SCREEN_SYSTEM) return r.screen ?? screenJson();
  if (sys === DEEP_SYSTEM) return r.deep ?? deepJson();
  return r.judge ?? verdictJson();
});

describe("prompt construction: explanation before verdict before confidence before member text", () => {
  test("pass 1 template order", () => {
    const tpl = SCREEN_SYSTEM.slice(SCREEN_SYSTEM.indexOf("Return ONLY"));
    expect(increasing(order(tpl, ["reasoning", "cited_facts", "dealbreaker", "verdict", "match_probability", "accept_probability", "member_why"]))).toBe(true);
    expect(SCREEN_SYSTEM).toMatch(/FIRST, a concrete explanation/);
    expect(SCREEN_SYSTEM).toMatch(/Cite facts by field/);
  });
  test("pass 2 template order", () => {
    const tpl = JUDGE_SYSTEM.slice(JUDGE_SYSTEM.indexOf("Return ONLY"));
    expect(increasing(order(tpl, ["reasoning", "cited_facts", "fit", "red_flags", "dealbreaker", "verdict", "match_probability", "certainty", "why"]))).toBe(true);
  });
  test("pass 3 template order: steelmen and rubric before the verdict, member text last", () => {
    expect(increasing(["\"evidence_review\"", "\"steelman_for\"", "\"steelman_against\"", "\"rubric\"", "\"would_thank_us\"", "\"reasoning\"", "\"cited_facts\"", "\"verdict\"", "\"question_to_ask\"", "\"match_probability\"", "\"member_why\""]
      .map(k => DEEP_SYSTEM.indexOf(k)))).toBe(true);
    for (const crit of ["mutual_benefit", "reciprocity", "intent_timing", "logistics", "stage_fit", "values_energy", "novelty", "evidence_quality", "risk_safety", "would_thank_us", "insufficient_information"])
      expect(DEEP_SYSTEM).toContain(crit);
  });
});

describe("parsing", () => {
  test("pass 1: valid, percent normalisation, missing reasoning throws, reasoning-first detected", () => {
    const v = parseScreenVerdict(JSON.parse(screenJson({ match_probability: 72 })), ["P1", "P2"]);
    expect(v.matchProbability).toBeCloseTo(0.72);
    expect(v.reasoningFirst).toBe(true);
    expect(() => parseScreenVerdict(JSON.parse(screenJson({ reasoning: "" })), ["P1", "P2"])).toThrow(/reasoning/);
    expect(() => parseScreenVerdict(JSON.parse(screenJson({ verdict: "insufficient_information" })), ["P1", "P2"])).toThrow(/verdict/);
    const late = parseScreenVerdict({ verdict: "no", match_probability: 0.1, dealbreaker: false, accept_probability: { P1: 0.1 }, reasoning: "after the fact" }, ["P1"]);
    expect(late.reasoningFirst).toBe(false);
  });
  test("pass 2: needs reasoning + verdict + match_probability; a 'no' needs no member text", () => {
    const refs = { P1: "a", P2: "b" };
    const v = parseVerdict(JSON.parse(verdictJson()), refs);
    expect(v.verdict).toBe("yes"); expect(v.reasoning).toContain("P1"); expect(v.reasoningFirst).toBe(true);
    expect(() => parseVerdict({ ...JSON.parse(verdictJson()), reasoning: undefined }, refs)).toThrow(/reasoning/);
    expect(() => parseVerdict({ ...JSON.parse(verdictJson()), verdict: "maybe" }, refs)).toThrow(/verdict/);
    expect(parseVerdict({ ...JSON.parse(verdictJson()), verdict: "no", why: {} }, refs).why).toEqual({});
  });
  test("pass 3: insufficient_information + question; rubric bounds; reasoning-first", () => {
    const v = parseDeepVerdict(JSON.parse(deepJson({ verdict: "Insufficient information", question_to_ask: { ref: "P2", question: "Still keen to sail?" } })), ["P1", "P2"]);
    expect(v.verdict).toBe("insufficient_information");
    expect(v.question).toEqual({ ref: "P2", question: "Still keen to sail?" });
    expect(v.reasoningFirst).toBe(true);
    expect(() => parseDeepVerdict(JSON.parse(deepJson({ rubric: { mutual_benefit: 9 } })), ["P1"])).toThrow(/rubric/);
    expect(() => parseDeepVerdict(JSON.parse(deepJson({ steelman_against: "" })), ["P1"])).toThrow(/steelman_against/);
    expect(parsePassVerdict("needs more info", true)).toBe("insufficient_information");
    expect(parsePassVerdict("needs more info", false)).toBeUndefined();
    expect(keyOrderOk({ verdict: "yes", reasoning: "x" }, ["reasoning"], "verdict")).toBe(false);
  });
});

describe("privacy: what each pass sees, and what may reach members", () => {
  const world = () => {
    const inp = sailingPair();
    inp.facets.push(facet("a", 9, "fact", "is grieving a parent (ref QX-4821-ORCHID)", ["sensitive"], "agent_private"));
    inp.facets.push(facet("a", 10, "boundary", "no loud venues", ["boundary"], "agent_private"));
    inp.facets.push(facet("b", 8, "fact", "recovering from divorce", ["private"], "matchable"));
    return mkWorld(inp);
  };
  test("passes 1 and 2 never see agent_private facts; pass 3 sees them redacted (no canary)", () => {
    const w = world();
    const c = cand(["a", "b"]);
    const p1 = JSON.stringify(screenMessages(buildPublicView(w.input, screenConfigOf(w, c))));
    const p2 = JSON.stringify(buildJudgeMessages(w, c).messages);
    const p3 = JSON.stringify(buildDeepMessages(w, c).messages);
    for (const s of [p1, p2]) { expect(s).not.toContain("grieving"); expect(s).not.toContain("loud venues"); }
    for (const s of [p1, p2, p3]) { expect(s).not.toContain("QX-4821"); expect(s).not.toContain("ORCHID"); expect(s).not.toContain('"A"'); }
    expect(p3).toContain("private_context_never_quote");
    expect(p3).toContain("no loud venues");
    expect(redactPrivate("x (ref QX-4821-ORCHID) and ZZ-1234-OPAL")).toBe("x and [redacted]");
  });
  test("member-facing text that touches private or do-not-quote facts is rejected; internal reasoning is never member-facing", () => {
    const w = world();
    const c = cand(["a", "b"]);
    const { refs } = buildDeepMessages(w, c);
    const v = parseDeepVerdict(JSON.parse(deepJson({
      reasoning: "P1 is grieving (private) but sailing is calm.",
      member_why: { P1: "Sailing is a calm way to spend time while grieving.", P2: "You both love being out on the water." },
    })), ["P1", "P2"]);
    const g = gateMemberFacing(w, c, v, refs);
    expect(g.why.a).toBeUndefined();
    expect(g.why.b).toBe("You both love being out on the water.");
    expect(g.rejected[0]!.reasons.join()).toMatch(/private_vocabulary/);
    expect(JSON.stringify(g.why)).not.toContain("grieving");
    const vocab = privateVocabulary(w, ["a", "b"]);
    expect(checkMemberFacing("B is recovering from a divorce", vocab).ok).toBe(false);
    expect(checkMemberFacing("Call me at 415-555-1234", vocab).ok).toBe(false);
    expect(checkMemberFacing("ref QX-4821-ORCHID", new Set()).ok).toBe(false);
    // A non-"yes" verdict never yields member text.
    expect(gateMemberFacing(w, c, { ...v, verdict: "no" }, refs).why).toEqual({});
  });
  test("evidence basis and connected-source summaries", () => {
    const f = facet("a", 1, "interest", "x", []);
    expect(basisOf(f)).toBe("stated");
    expect(basisOf({ ...f, provenance: "connected_source", source: "spotify" } as any)).toBe("observed");
    expect(basisOf({ ...f, provenance: "connected_source", source: "github", inferred: true } as any)).toBe("inferred");
    expect(basisOf({ ...f, provenance: "connected_source", source: "linkedin", confirmedByMember: true } as any)).toBe("confirmed");
    const s = summarizeConnectedSources([{ source: "instagram", status: "confirmed", handle: "@jane", url: "https://x.y", connectedAt: Date.UTC(2026, 8, 5) }], Date.UTC(2026, 9, 5)) as any[];
    expect(JSON.stringify(s)).not.toContain("jane");
    expect(s[0].source).toBe("instagram");
    expect(s[0].connectedAt).toBe("30 days ago");
  });
});

describe("hard filters always win", () => {
  test("hardGate: minor in any role (incl. connector), blocks, opt-ins", () => {
    const inp = sailingPair();
    inp.members.push(baseMember("kid", { age: 16 }), baseMember("c"));
    inp.presence.push({ memberId: "c", city: "sf", type: "home", areas: ["mission"] });
    const w = mkWorld(inp);
    expect(hardGate(w, { participants: ["a", "b"], category: "hobby" })).toBeNull();
    expect(hardGate(w, { participants: ["a", "b"], via: "kid", category: "hobby" })).toBe("underage");
    expect(hardGate(w, { participants: ["a", "kid"], category: "hobby" })).toBe("underage");
    expect(hardGate(w, { participants: ["a", "b"], category: "romance" })).toBe("romance_opt_out");
    inp.edges.push({ from: "b", to: "a", type: "blocked", strength: 1, explicit: true, createdAt: inp.now - 1 });
    expect(hardGate(mkWorld(inp), { participants: ["a", "b"], category: "hobby" })).toBe("blocked");
  });
  test("an enthusiastic model on every pass cannot surface a blocked or minor configuration", async () => {
    const inp = sailingPair();
    inp.edges.push({ from: "b", to: "a", type: "blocked", strength: 1, explicit: true, createdAt: inp.now - 1 });
    const llm = passLLM({});
    const r = await runEngine(inp, { seed: 1, judge: { screen: { enabled: true }, deep: { enabled: true } } }, { llm });
    expect(r.proposals.length).toBe(0);
    expect(llm.calls).toBe(0); // filtered before any model is asked
    const minor = sailingPair();
    minor.members.find(m => m.id === "b")!.age = 17;
    const r2 = await runEngine(minor, { seed: 1, judge: { screen: { enabled: true }, deep: { enabled: true } } }, { llm });
    expect(r2.proposals.length).toBe(0);
  });
  test("pass 3 can only remove: 'no' rejects, 'insufficient' withholds and logs the question, 'yes' keeps", async () => {
    const cfg = { seed: 1, judge: { deep: { enabled: true } } } as const;
    const yes = await runEngine(sailingPair(), cfg, { llm: passLLM({}) });
    expect(yes.proposals.length).toBe(1);
    expect(yes.runLog.judge.deep!.verdicts[0]!.verdict).toBe("yes");
    expect(yes.proposals[0]!.explanations.a).toContain("water");
    const no = await runEngine(sailingPair(), cfg, { llm: passLLM({ deep: deepJson({ verdict: "no", member_why: {} }) }) });
    expect(no.proposals.length).toBe(0);
    expect(no.runLog.scored.some(s => s.reason === "deep_reject")).toBe(true);
    const ask = await runEngine(sailingPair(), cfg, { llm: passLLM({ deep: deepJson({ verdict: "insufficient_information", question_to_ask: { ref: "P1", question: "Are you free to sail this weekend?" } }) }) });
    expect(ask.proposals.length).toBe(0);
    expect(ask.runLog.scored.some(s => s.reason === "deep_insufficient")).toBe(true);
    expect(ask.runLog.judge.deep!.verdicts[0]!.question?.question).toContain("sail");
    // Deep review never sees a candidate pass 2 rejected.
    const llm = passLLM({ judge: verdictJson({ verdict: "no" }) });
    const r = await runEngine(sailingPair(), cfg, { llm });
    expect(r.proposals.length).toBe(0);
    expect(r.runLog.scored.some(s => s.reason === "judge_reject")).toBe(true);
    expect(r.runLog.judge.deep!.calls).toBe(0);
  });
  test("pass 1 'no' stops the candidate before pass 2", async () => {
    const llm = passLLM({ screen: screenJson({ verdict: "no", member_why: "" }) });
    const r = await runEngine(sailingPair(), { seed: 1, judge: { screen: { enabled: true } } }, { llm });
    expect(r.proposals.length).toBe(0);
    expect(r.runLog.judge.screen!.calls).toBe(1);
    expect(r.runLog.judge.calls).toBe(0);
    expect(r.runLog.scored.some(s => s.reason === "screen_reject")).toBe(true);
  });
});

describe("v3 prompts (2026-10-07): evidence notes, redacted boundary flag, pass 2 with deep context", () => {
  const world = () => {
    const inp = sailingPair();
    inp.facets.push(facet("a", 10, "boundary", "prefers groups over one-on-one with strangers", ["boundary"], "agent_private"));
    inp.facets.push({ ...facet("b", 7, "interest", "receipts suggest a painting habit", ["painting"], "matchable"), provenance: "connected_source", source: "gmail", inferred: true, confidence: 0.5 } as any);
    return mkWorld(inp);
  };
  test("pass 1 view: basis/confidence/age on every fact, HYPOTHESIS mark, redacted boundary flag (no content); v2 view unchanged", () => {
    const w = world();
    const c = cand(["a", "b"]);
    const v3 = buildPublicView(w.input, screenConfigOf(w, c), { version: "v3" });
    const v2 = buildPublicView(w.input, screenConfigOf(w, c));
    const s3 = JSON.stringify(v3);
    expect(v3.people[0]!.private_boundary_relevant_to).toEqual(["format"]);
    expect(s3).not.toContain("prefers groups");
    expect(v3.people[1]!.matchable_do_not_quote.find(x => x.includes("painting"))).toMatch(/inferred via gmail, conf 0.5, .*HYPOTHESIS/);
    expect(v3.people.every(p => [...p.shareable, ...p.matchable_do_not_quote].every(x => /\[(stated|confirmed|observed|inferred|vouched)/.test(x)))).toBe(true);
    expect(JSON.stringify(v2)).not.toContain("private_boundary_relevant_to");
    expect(JSON.stringify(v2)).not.toContain("conf ");
    // A group intro does not raise the one-to-one format flag.
    expect(boundaryRelevance(["prefers groups over one-on-one with strangers"], { category: "social", attendingCount: 3 })).toEqual([]);
    expect(boundaryRelevance(["no networking-heavy events", "doesn't want to talk about work"], { category: "professional", attendingCount: 2 })).toEqual(["category", "topic"]);
    expect(boundaryRelevance(["no bars or heavy drinking"], { category: "social", attendingCount: 2 })).toEqual([]);
  });
  test("pass 2 v3: pass-3 context without private context, attending refs only; template order kept", () => {
    const w = world();
    const c = cand(["a", "b"]);
    const m = buildJudgeMessages(w, c, "v3");
    const s = JSON.stringify(m.messages);
    expect(m.messages[0]!.content).toBe(JUDGE_SYSTEM_V3);
    expect(s).not.toContain("private_context_never_quote");
    expect(s).not.toContain("prefers groups");
    expect(s).toContain("private_boundary_relevant_to");
    expect(s).toContain("\\\"hypothesis\\\":true");
    expect(Object.keys(m.refs)).toEqual(["P1", "P2"]);
    const tpl = JUDGE_SYSTEM_V3.slice(JUDGE_SYSTEM_V3.indexOf("Return ONLY"));
    expect(increasing(order(tpl, ["reasoning", "cited_facts", "fit", "red_flags", "dealbreaker", "verdict", "match_probability", "certainty", "why"]))).toBe(true);
    // Config default is the deep pass-2 input since 2026-10-07; "compact" restores judge-v2.1.
    expect(buildJudgeMessages(w, c).messages[0]!.content).toBe(JUDGE_SYSTEM_V3);
    expect(buildJudgeMessages(mkWorld(sailingPair(), { judge: { pass2Context: "compact" } }), c).messages[0]!.content).toBe(JUDGE_SYSTEM);
  });
  test("engine ships pass1-screen-v2 and pass3-deep-v2; the losing v3 prompts are not in the engine", () => {
    expect(SCREEN_PROMPT_VERSION).toBe("pass1-screen-v2");
    expect(DEEP_PROMPT_VERSION).toBe("pass3-deep-v2");
    expect(SCREEN_SYSTEM).toContain("would plausibly accept");
    expect(DEEP_SYSTEM).toContain("a violated boundary)");
    expect(buildDeepMessages(world(), cand(["a", "b"])).messages[0]!.content).toBe(DEEP_SYSTEM);
    for (const m of [Screen, Deep] as Record<string, unknown>[]) for (const v of Object.values(m)) {
      if (typeof v !== "string") continue;
      expect(v).not.toContain("ENJOY AND BENEFIT");
      expect(v).not.toContain("penalties, not vetoes");
    }
  });
});
