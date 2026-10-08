// Engine leak vocabulary and explanation gating (audit 2026-10-08 core-1 / engine-pipeline-3 short-word
// part, engine-pipeline-21). Deterministic, no LLM calls.
import { describe, expect, test } from "bun:test";
import { EXPLORATION_LABEL, explain, privateVocabulary } from "../src/explain.ts";
import { checkMemberFacing } from "../src/judgeCommon.ts";
import { NOW, baseMember, cand, emptyInput, facet, mkWorld, sailingPair } from "./helpers.ts";

describe("privateVocabulary: short sensitive words and per-member clearing", () => {
  test("short sensitive private words (aa, hiv, ivf, gay) are kept; another member's shareable text does not clear them", () => {
    const inp = sailingPair();
    inp.facets.push(
      facet("a", 5, "fact", "goes to AA, hiv positive, doing IVF, gay", ["sensitive"], "agent_private"),
      facet("b", 5, "interest", "volunteers with an HIV and AA outreach group", ["volunteering"]),
    );
    const w = mkWorld(inp);
    const v = privateVocabulary(w, ["a", "b"]);
    for (const t of ["aa", "hiv", "ivf", "gay"]) expect(v.has(t)).toBe(true);
    expect(checkMemberFacing("Fun fact: they go to AA.", v).ok).toBe(false);
    expect(checkMemberFacing("Both of you love sailing.", v).ok).toBe(true);
  });
  test("a member's own shareable facet clears their own sensitive word", () => {
    const inp = sailingPair();
    inp.facets.push(facet("b", 5, "interest", "sober curious events", ["sober"]), facet("b", 6, "fact", "sober for two years", ["sensitive"], "agent_private"));
    expect(privateVocabulary(mkWorld(inp), ["a", "b"]).has("sober")).toBe(false);
  });
});

describe("explain: inserts are gated and exploration is always labelled", () => {
  test("a shareable facet value with contact details is not quoted; the owner's own sensitive words are theirs to show", () => {
    const inp = emptyInput(NOW);
    inp.members.push(baseMember("a"), baseMember("b"), baseMember("c"));
    for (const id of ["a", "b", "c"]) inp.presence.push({ memberId: id, city: "sf", type: "home", areas: ["mission"] });
    inp.facets.push(
      facet("a", 0, "fact", "in recovery, sober since spring", ["sensitive"], "agent_private"),
      facet("b", 0, "interest", "hosts a sober brunch club", ["cooking"]),
      facet("c", 0, "interest", "board games, text me at 212 555 0102", ["board_games"]),
    );
    const w = mkWorld(inp);
    const out = explain(w, cand(["a", "b", "c"], { kind: "group" }));
    for (const t of Object.values(out.explanations)) expect(t).not.toMatch(/555|0102/);
    expect(out.explanations.a).toMatch(/could be a good fit/);
  });
  test("exploration picks carry the novelty label, also when the judge's text is used", () => {
    const w = mkWorld(sailingPair());
    const c = cand(["a", "b"], { exploration: true });
    for (const t of Object.values(explain(w, c).explanations)) expect(t).toContain(EXPLORATION_LABEL);
    const why = { a: "You both love being out on the water.", b: "You both love being out on the water." };
    for (const t of Object.values(explain(w, c, { why } as never).explanations)) expect(t).toContain(EXPLORATION_LABEL);
  });
});
