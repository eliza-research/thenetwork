// Audit 2026-10-07 P1-3: the outbound guard must catch partial, leetspeak and reordered leaks of
// private facts, not only exact CANARY_ strings. These facts deliberately have no CANARY_ prefix.
import { describe, expect, test } from "bun:test";
import { findLeaks, stem } from "../src/policy.ts";
import { connect, principal, visible, world } from "./helpers.ts";

const FACT = "feeling isolated since the move";
const SECRET = "job search is secret from her manager";
const facts = [FACT, SECRET];
const leaks = (text: string, fs = facts) => findLeaks(text, fs, { facts: fs }).filter((l) => l.startsWith("forbidden:"));

describe("findLeaks: fuzzy private-fact matching", () => {
  test.each([
    ["exact", "She's feeling isolated since the move."],
    ["fragment", "Honestly, isolated since the move, poor thing"],
    ["leetspeak", "she has felt 1s0lat3d since the m0ve"],
    ["reordered", "the move has left her really isolated"],
    ["inflected", "isolation after moving is hard for her"],
    ["spaced letters", "she is i s o l a t e d after the move"],
    ["second fact fragment", "keep her job search quiet, it's secret"],
    ["second fact reordered", "a secret: she's searching for a new job"],
  ])("%s is blocked", (_label, text) => {
    expect(leaks(text).length).toBeGreaterThan(0);
  });

  test.each([
    "Maya, a product designer who also boulders, is around on Thursday evenings.",
    "Want an intro? You can say no at any time.",
    "We moved the event to Saturday.",
    "Nothing new right now. I'll reach out when something genuinely fits.",
    "Here's what I use to look out for you: Climbs at Mission Cliffs on Thursdays",
  ])("benign output %p is not blocked", (text) => {
    expect(leaks(text)).toEqual([]);
  });

  test("labels never contain the blocked value", () => {
    const out = leaks("isolated since the move");
    expect(out.length).toBe(1);
    expect(out[0]).toMatch(/^forbidden:[0-9a-f]{8}$/);
    expect(out[0]).not.toContain("isolat");
  });

  test("canary prefixes are stripped so the fact body alone is matched", () => {
    expect(leaks("she was recently divorced", ["CANARY_MAYA_MATCHABLE_recently divorced"]).length).toBe(1);
    expect(leaks("divorced, recently", ["CANARY_MAYA_MATCHABLE_recently divorced"]).length).toBe(1);
  });

  test("facts not passed as facts keep exact-only matching (item text, ids)", () => {
    expect(findLeaks("isolated since the move", [FACT])).toEqual([]);
  });

  test("stemmer basics", () => {
    expect(stem("isolated")).toBe(stem("isolation"));
    expect(stem("moving")).toBe(stem("moved"));
    expect(stem("divorced")).toBe(stem("divorce"));
  });
});

describe("end to end: a buggy Network that paraphrases another member's private fact is blocked", () => {
  test("non-canary private facet, fragment and leetspeak", async () => {
    const w = world();
    w.maya.facets.push({ value: "secretly interviewing at Stripe next week", scope: "agent_private" });
    const original = w.net.ask.bind(w.net);
    for (const leak of ["Maya is 1nterv1ewing at Stripe", "next week Stripe is interviewing her, secretly"]) {
      w.net.ask = (p, input) => ({ result: { ...original(p, input).result, answer: `FYI: ${leak}` } });
      const { call } = await connect(w.net, principal(w, w.ava));
      const r = await call("ask_network_agent", { question: "hi" });
      expect(r.isError).toBe(true);
      expect(visible(r)).not.toContain("Stripe");
      expect(w.net.audit.at(-1)?.summary).toMatch(/^leak_block:forbidden:[0-9a-f]{8}/);
      expect(w.net.audit.at(-1)?.summary).not.toContain("Stripe");
    }
  });

  test("the member's own private fact may be echoed when they supplied a paraphrase of it", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava));
    const r = await call("ask_network_agent", { question: "I've been feeling isolated since the move, anything new for me?" });
    expect(r.isError).toBe(false);
  });
});
