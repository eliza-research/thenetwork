// Offline tests for the production minors/romance policy judge (rules first, then the LLM rubric).
import { describe, expect, test } from "bun:test";
import type { ChatMessage, LLM } from "@thenetwork/core";
import { checkPolicy, judgePolicy, renderPolicyContext, type PolicyPerson } from "../src/policy.ts";

const P = (name: string, role: PolicyPerson["role"], age?: number, romanceOptIn?: boolean): PolicyPerson => ({ name, role, age, romanceOptIn });
const rules = (msg: string, people: PolicyPerson[], notes?: string) => checkPolicy(msg, { people, notes });

describe("checkPolicy (deterministic)", () => {
  test("a stated minor connected to anyone, in any role, is a hard violation", () => {
    expect(rules("Want to meet Ezra for chess Saturday?", [P("Theo", "recipient", 16), P("Ezra", "introduced", 34, false)]).verdict).toBe("violation");
    expect(rules("Could you introduce Yara to your friend's band?", [P("Caleb", "recipient", 41, false), P("Yara", "introduced", 16)]).verdict).toBe("violation");
    expect(rules("Run club Sunday: you, Finn and Rosa.", [P("Ana", "recipient", 31), P("Finn", "group_member", 17), P("Rosa", "group_member", 45)]).violations[0]!.rule).toBe("minor_connection");
    // Minor-to-minor is still a connection, even when the others are not listed as people.
    expect(rules("Want me to put you in a group chat with two other members your age?", [P("Zoe", "recipient", 16)]).verdict).toBe("violation");
  });
  test("single-player help for a minor is not blocked", () => {
    const r = rules("There's a free teen robotics workshop at the library Saturday, run by staff. Want the link?", [P("Zoe", "recipient", 16)]);
    expect(r.verdict).not.toBe("violation");
  });
  test("strong romantic framing needs every person to be an adult who opted in", () => {
    expect(rules("Talia is single and might be your type. Want me to set up a date?", [P("Sam", "recipient", 31, true), P("Talia", "introduced", 29, false)]).violations.map(v => v.rule)).toContain("romance_without_optin");
    expect(rules("Want me to find you someone to go on a date with?", [P("Eli", "recipient", 16)]).violations.map(v => v.rule)).toContain("minor_romance");
    expect(rules("Sam also opted into dating intros. Want me to set up a coffee?", [P("Maya", "recipient", 29, true), P("Sam", "introduced", 31, true)]).verdict).toBe("clear");
    // 18 is an adult.
    expect(rules("Bea also opted into dating intros. Coffee?", [P("Ari", "recipient", 22, true), P("Bea", "introduced", 18, true)]).verdict).toBe("clear");
  });
  test("weak cues and implicit minor signals escalate instead of blocking", () => {
    expect(rules("Milo gardens too and he's recently single, wink. Want an intro?", [P("Rosa", "recipient", 45, false), P("Milo", "introduced", 47, false)]).verdict).toBe("escalate");
    const r = rules("Ravi plays chess on Saturdays. Want an intro?", [P("Jamie", "recipient", 19, false), P("Ravi", "introduced", 27, false)], "Jamie said: 'junior year is killing me'");
    expect(r.verdict).toBe("escalate");
    expect(r.signals.join(" ")).toContain("junior year");
  });
  test("unknown or invalid ages fail closed (core isMinor), and a first-person under-18 age in the notes blocks a connection", () => {
    expect(rules("Kira is open to dating. Coffee date?", [P("Max", "recipient", 28, true), P("Kira", "introduced", undefined, true)], "profile: class of 2028").verdict).toBe("violation");
    expect(rules("Want to meet Ezra for chess Saturday?", [P("Theo", "recipient", Number.NaN), P("Ezra", "introduced", 34, false)]).violations[0]!.rule).toBe("minor_connection");
    const r = rules("Ravi plays chess on Saturdays. Want an intro?", [P("Jamie", "recipient", 19, false), P("Ravi", "introduced", 27, false)], "Jamie said: 'I'm 16 and love chess'");
    expect(r.verdict).toBe("violation");
    // Not first person, or not an age: no violation from the age rule.
    expect(rules("Ravi plays chess on Saturdays. Want an intro?", [P("Jamie", "recipient", 39, false), P("Ravi", "introduced", 27, false)], "Jamie said: 'I'm 15 minutes away; my kid is 16'").verdict).not.toBe("violation");
  });
  test("a class year signals a minor only while it is still in the future (Clock-relative)", () => {
    const ctx = (notes: string, now?: number) => checkPolicy("Kai climbs too. Want an intro?", { people: [P("Jo", "recipient", 19, false), P("Kai", "introduced", 30, false)], notes, now });
    expect(ctx("profile: class of 2028").verdict).toBe("escalate");
    expect(ctx("profile: class of 2028", Date.UTC(2031, 0, 1)).verdict).toBe("clear");
    expect(ctx("profile: class of 2033", Date.UTC(2031, 0, 1)).verdict).toBe("escalate");
  });
  test("ordinary adult friendship intros are clear; 'single-player' and 'not a singles thing' are not romance", () => {
    expect(rules("Kai also boulders on weekday mornings. Want an intro? No pressure.", [P("Lena", "recipient", 34, false), P("Kai", "introduced", 33, false)]).verdict).toBe("clear");
    expect(rules("Ken runs a board game night that's explicitly not a singles thing. Want an intro?", [P("Ola", "recipient", 30, false), P("Ken", "introduced", 32, false)]).verdict).toBe("clear");
    expect(rules("Teens are single-player on the Network, so here are three solo chess resources.", [P("Theo", "recipient", 16)]).verdict).not.toBe("violation");
  });
  test("context rendering marks minors and cannot show a minor as opted in", () => {
    const text = renderPolicyContext({ people: [P("Noor", "introduced", 15, true), P("Jun", "recipient", 30)], notes: "n" });
    expect(text).toContain("age 15 (under 18)");
    expect(text).toContain("n/a (minors cannot opt in)");
    expect(text).toContain("romance opt-in: unknown");
  });
});

class FakeLLM implements LLM {
  calls: ChatMessage[][] = [];
  constructor(private reply: string) {}
  async chat(m: ChatMessage[]) { this.calls.push(m); return this.reply; }
}

describe("judgePolicy (rules first, then LLM)", () => {
  test("a rule violation blocks without calling the LLM, and the LLM cannot override it", async () => {
    const llm = new FakeLLM('{"compliant": true, "violations": [], "reasoning": "looks fine"}');
    const v = await judgePolicy(llm, { message: "Want to meet Ezra?", context: { people: [P("Theo", "recipient", 16), P("Ezra", "introduced", 34)] } });
    expect(v.compliant).toBe(false);
    expect(v.source).toBe("rules");
    expect(llm.calls.length).toBe(0);
  });
  test("without a hard violation the LLM rubric decides and sees the structured context", async () => {
    const llm = new FakeLLM('{"compliant": false, "violations": ["implicit minor"], "reasoning": "junior year"}');
    const v = await judgePolicy(llm, { message: "Ravi plays chess. Want an intro?", context: { people: [P("Jamie", "recipient", 19, false), P("Ravi", "introduced", 27, false)], notes: "junior year" } });
    expect(v.source).toBe("llm");
    expect(v.compliant).toBe(false);
    expect(v.rules.verdict).toBe("escalate");
    expect(llm.calls[0]![1]!.content).toContain("Jamie (recipient): age 19");
    expect(llm.calls[0]![0]!.content).toContain("under 18");
  });
  test("malformed LLM output is retried, then throws", async () => {
    const llm = new FakeLLM('{"ok": 1}');
    await expect(judgePolicy(llm, { message: "Coffee?", context: { people: [P("A", "recipient", 30), P("B", "introduced", 31)] } })).rejects.toThrow();
    expect(llm.calls.length).toBe(3);
  });
});
