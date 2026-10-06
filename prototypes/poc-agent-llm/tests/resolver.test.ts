// Offline tests for member resolution against full history (block/report lookups).
import { describe, expect, test } from "bun:test";
import { resolveMember, whichQuestion } from "../src/resolver.ts";
import { DEFAULT_HISTORY, type HistoryEntry } from "../src/contexts.ts";

const TWO_JAKES: HistoryEntry[] = [
  ...DEFAULT_HISTORY,
  { member_id: "m_210", name: "Jake T.", item_id: "opp_150", when: "in September", summary: "board game group dinner, completed" },
];

describe("resolveMember: single match in history", () => {
  test("'block Jake' resolves to a past contact who is not in active items", () => {
    const r = resolveMember("Jake", "I need to block Jake", DEFAULT_HISTORY);
    expect(r).toMatchObject({ kind: "resolved", entry: { member_id: "m_209" } });
  });
  test("'Sarah' resolves to Sarah K.", () => {
    expect(resolveMember("Sarah", "please never match me with Sarah again", DEFAULT_HISTORY)).toMatchObject({ kind: "resolved", entry: { name: "Sarah K." } });
  });
  test("case and last initial variants", () => {
    expect(resolveMember("sarah k", "sarah k from last week", DEFAULT_HISTORY)).toMatchObject({ kind: "resolved", entry: { member_id: "m_203" } });
    expect(resolveMember("Sarah K.", "x", DEFAULT_HISTORY)).toMatchObject({ kind: "resolved", entry: { member_id: "m_203" } });
  });
  test("member id", () => {
    expect(resolveMember("m_206", "", DEFAULT_HISTORY)).toMatchObject({ kind: "resolved", entry: { name: "Sam W." } });
  });
  test("ref is descriptive but the name is in the member's words", () => {
    expect(resolveMember("the guy from dinner", "sam kept touching my arm", DEFAULT_HISTORY)).toMatchObject({ kind: "resolved", entry: { name: "Sam W." } });
  });
});

describe("resolveMember: several Jakes", () => {
  test("bare 'Jake' is ambiguous and lists both", () => {
    const r = resolveMember("Jake", "block jake", TWO_JAKES);
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.candidates.map(c => c.member_id).sort()).toEqual(["m_209", "m_210"]);
    expect(whichQuestion(r)).toContain("Jake R.");
    expect(whichQuestion(r)).toContain("Jake T.");
  });
  test("last initial disambiguates", () => {
    expect(resolveMember("Jake T", "block jake t", TWO_JAKES)).toMatchObject({ kind: "resolved", entry: { member_id: "m_210" } });
    expect(resolveMember("Jake", "block jake r please", TWO_JAKES)).toMatchObject({ kind: "resolved", entry: { member_id: "m_209" } });
  });
  test("descriptor disambiguates ('jake from climbing')", () => {
    expect(resolveMember("Jake", "block jake from climbing", TWO_JAKES)).toMatchObject({ kind: "resolved", entry: { member_id: "m_209" }, via: "descriptor" });
    expect(resolveMember("Jake", "report jake from the board game dinner", TWO_JAKES)).toMatchObject({ kind: "resolved", entry: { member_id: "m_210" } });
  });
});

describe("resolveMember: unresolvable", () => {
  test("pronoun -> candidates from the attributed item, never auto-resolved", () => {
    const r = resolveMember("he (identity unclear)", "he made me feel really unsafe need to report", DEFAULT_HISTORY, ["thread_88"]);
    expect(r.kind).toBe("pronoun");
    if (r.kind === "pronoun") expect(r.candidates.map(c => c.name)).toEqual(["Marcus D."]);
    expect(whichQuestion(r)).toContain("Marcus");
  });
  test("pronoun with no attributed item asks who", () => {
    const r = resolveMember("him", "block him", DEFAULT_HISTORY, []);
    expect(r).toMatchObject({ kind: "pronoun", candidates: [] });
    expect(whichQuestion(r)).toMatch(/Who/);
  });
  test("unknown name", () => {
    expect(resolveMember("Zed", "block zed", DEFAULT_HISTORY).kind).toBe("unknown");
  });
});
