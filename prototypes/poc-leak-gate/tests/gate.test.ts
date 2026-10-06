import { test, expect, describe } from "bun:test";
import type { LLM } from "@thenetwork/core";
import { deterministicCheck, runGate, send, type GateInput, type MemberCard } from "../src/index.ts";

const maya: MemberCard = { id: "m1", name: "Maya Okafor", facets: [
  { id: "m1:f1", kind: "interest", value: "bouldering", scope: "public" },
  { id: "m1:f2", kind: "fact", value: "is going through a divorce and doesn't want anyone to know yet (ref XE-4029-THISTLE)", scope: "agent_private", topic: "relationship" },
  { id: "m1:f3", kind: "phone", value: "+1-917-555-0133", scope: "agent_private", topic: "contact" },
  { id: "m1:f4", kind: "email", value: "member+m1@example.com", scope: "agent_private", topic: "contact" },
  { id: "m1:f5", kind: "address", value: "lives at 412 Juniper St, Apt 3B", scope: "agent_private", topic: "location" },
  { id: "m1:f6", kind: "fact", value: "is going through IVF", scope: "agent_private", topic: "health" },
] };
const sam: MemberCard = { id: "m2", name: "Sam Chen", facets: [
  { id: "m2:f1", kind: "interest", value: "bouldering", scope: "public" },
  { id: "m2:f2", kind: "fact", value: "is in therapy for social anxiety", scope: "agent_private", topic: "mental_health" },
] };
const theo: MemberCard = { id: "m3", name: "Theo Alvarez", facets: [{ id: "m3:f1", kind: "fact", value: "is behind on rent", scope: "agent_private" }] };
const base: Omit<GateInput, "draft"> = {
  recipientId: "m2", participantIds: ["m2", "m1"], members: [sam, maya, theo],
  directory: [{ id: "m1", name: "Maya Okafor" }, { id: "m2", name: "Sam Chen" }, { id: "m3", name: "Theo Alvarez" }],
  canaries: [{ memberId: "m1", token: "XE-4029-THISTLE" }, { memberId: "m2", token: "QQ-1111-OWN" }],
  allowedPlaces: ["Lantern Coffee", "1180 Valencia St"],
};
const det = (draft: string) => deterministicCheck({ ...base, draft });
const rules = (draft: string) => det(draft).findings.map(f => f.rule);

describe("deterministic layer", () => {
  test("clean intro with shareable facts and venue address passes", () => {
    const r = det("Sam, Maya also boulders and is up for coffee at Lantern Coffee, 1180 Valencia St on Thursday at 6. Easy no if not.");
    expect(r.findings).toEqual([]);
  });
  test("canary: exact, normalized, and shape", () => {
    expect(rules("ref XE-4029-THISTLE")).toContain("canary");
    expect(rules("ref xe 4029 thistle")).toContain("canary_normalized");
    expect(rules("ticket AB-1234-WOMBAT")).toContain("canary_shape");
  });
  test("the recipient's own canary is not a leak", () => expect(rules("your ref QQ-1111-OWN")).not.toContain("canary"));
  test("contact: phone, spaced phone, obfuscated email", () => {
    expect(rules("text her at 917-555-0133")).toContain("contact_phone");
    expect(rules("her number is 917 555 0133")).toContain("contact_registry");
    expect(rules("email member+m1 at example dot com")).toContain("contact_registry");
  });
  test("address: full and street-only", () => {
    expect(rules("she's at 412 Juniper St")).toContain("contact_address");
    expect(rules("she lives right on Juniper Street")).toContain("address_registry");
  });
  test("non-participant name", () => {
    expect(rules("Theo said no, so it's just you two")).toContain("nonparticipant_name");
    expect(rules("Maya and you, at Lantern Coffee")).not.toContain("nonparticipant_name");
  });
  test("facet overlap catches exact copy", () => {
    expect(rules("Maya is going through a divorce, so be gentle")).toContain("facet_overlap");
    expect(rules("Maya is going through IVF right now")).toContain("facet_overlap");
  });
  test("lexicon catches paraphrase vocabulary, but not the recipient's own facts", () => {
    expect(rules("Maya's marriage is ending, so be kind")).toContain("lexicon_relationship");
    expect(rules("Sam, since you're in therapy, a calm spot felt right")).not.toContain("lexicon_mental_health");
  });
});

const fake = (leak: boolean): LLM => ({ chat: async () => JSON.stringify({ reasoning: "test", quote: leak ? "x" : "", category: leak ? "inference" : "none", leak }) });

describe("gate", () => {
  test("pass mints a LeakCheckedMessage that send() accepts", async () => {
    const out = await runGate({ ...base, draft: "Sam, Maya also boulders. Coffee Thursday?" }, { llm: fake(false) });
    expect(out.decision).toBe("pass");
    const sent: string[] = [];
    if (out.decision === "pass") await send(out.message, { deliver: async (to, body) => { sent.push(`${to}:${body}`); } });
    expect(sent).toEqual(["m2:Sam, Maya also boulders. Coffee Thursday?"]);
  });
  test("LLM inference hold", async () => {
    const out = await runGate({ ...base, draft: "Maya could use a distraction while things settle at home." }, { llm: fake(true) });
    expect(out.decision).toBe("hold");
    expect(out.verdict.findings.some(f => f.layer === "llm")).toBe(true);
  });
  test("deterministic hold short-circuits the LLM", async () => {
    let called = false;
    const llm: LLM = { chat: async () => { called = true; return "{}"; } };
    const out = await runGate({ ...base, draft: "text her: 917-555-0133" }, { llm });
    expect(out.decision).toBe("hold");
    expect(called).toBe(false);
  });
  test("classifier failure fails closed", async () => {
    const out = await runGate({ ...base, draft: "Sam, Maya also boulders." }, { llm: { chat: async () => "not json" } });
    expect(out.decision).toBe("hold");
  });
});
