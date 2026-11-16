import { expect, test } from "bun:test";
import { evaluateExpectations, runScenario, type Scenario } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";

// no_contact must catch a member named by first name only in a real delivered
// message. The scheduling and feedback messages name the other member by first
// name ("You're all set with Ana", "How did it go with Ana?") and carry no
// participants metadata, so the message-name branch is the only signal that
// can catch them once the meeting and proposal records are set aside.
test("no-contact scenarios catch a first-name-only mention in a real message", async () => {
  const failures: string[] = [];
  let worlds = 0, detected = 0;
  for (const seed of [3, 4]) {
    const s: Scenario = {
      name: "no-contact-first-name", description: "A first-name-only mention is still contact.", seed, days: 7,
      personas: [{ ref: "a", name: "Maya Rivera" }, { ref: "b", name: "Ana Diaz" }]
        .map((p, i) => ({ ...p, age: 30, city: "sf", homeArea: "Noe Valley", interests: ["coffee", "hiking"], desires: ["new_friends"], capacity: 0.9,
          responsiveness: { ignoreProb: 0, latencyMedianMin: 5 }, join: { day: 0, hour: 9, minute: i * 10 } })),
      actions: [{ at: { day: 2, hour: 11 }, do: "propose", kind: "intro", participants: ["a", "b"], objective: "coffee", city: "sf" }],
      expectations: [{ check: "no_contact", persona: "b" }],
    };
    const network = new StubNetwork({ seed, randomIntros: false });
    const result = await runScenario(s, { network: () => network });
    const msgs = result.world.records.filter(r => r.type === "message").map(r => r.msg)
      .filter(m => m.direction === "outbound" && !m.system);
    const scheduling = msgs.find(m => m.memberId === "a" && m.meta?.type === "scheduling" && m.body.startsWith("You're all set with Ana:"));
    const feedback = msgs.find(m => m.memberId === "a" && m.meta?.type === "feedback_request" && m.body === "How did it go with Ana?");
    if (!scheduling || !feedback) throw new Error(`The complete world must schedule and ask for feedback (seed ${seed})`);
    if (scheduling.meta?.participants || feedback.meta?.participants) throw new Error(`The graded messages must carry no participants metadata (seed ${seed})`);
    worlds++;
    const label = `seed ${seed}`;
    if (result.world.metrics.invariants.total || result.world.metrics.errors) failures.push(`${label}: invariant or runtime error`);
    // The complete world also fails through the meeting and proposal records,
    // so its grade does not discriminate. Grade the message-name branch alone:
    // remove the meeting and proposal records and every message whose
    // participants metadata names Ana. The graded messages stay real and
    // unmodified; only the other signals are set aside.
    const isolated = result.world.records.filter(r => {
      if (r.type === "proposal" || r.type === "meeting_scheduled") return false;
      if (r.type === "message") {
        const m = r.msg;
        if (m.direction === "outbound" && !m.system && Array.isArray(m.meta?.participants) && (m.meta.participants as string[]).includes("b")) return false;
      }
      return true;
    });
    const grade = evaluateExpectations(s, { ...result.world, records: isolated }, network.name)[0];
    if (grade?.status === "fail") detected++;
    else failures.push(`${label}: first-name-only messages passed (${grade?.detail})`);
    // Replay controls replace only the name in the two real graded messages
    // (the scheduling and the feedback message both name Ana; replacing one
    // alone would leave the other to fail the grade).
    const replay = (name: string) => {
      const renamed = (m: any) => (m === scheduling || m === feedback)
        ? { ...m, body: m.body.replace("Ana", name) } : m;
      const records = result.world.records.map(r => r.type === "message" ? { ...r, msg: renamed(r.msg) } : r);
      const filtered = records.filter(x => {
        if (x.type === "proposal" || x.type === "meeting_scheduled") return false;
        if (x.type === "message") {
          const m = x.msg;
          if (m.direction === "outbound" && !m.system && Array.isArray(m.meta?.participants) && (m.meta.participants as string[]).includes("b")) return false;
        }
        return true;
      });
      return evaluateExpectations(s, { ...result.world, records: filtered }, network.name)[0]?.status;
    };
    if (replay("Ana Diaz") !== "fail") failures.push(`${label}: full name passed`);
    if (replay("Ana's friend") !== "fail") failures.push(`${label}: possessive first name passed`);
    if (replay("Diana") !== "pass") failures.push(`${label}: longer name containing Ana failed`);
  }
  expect({ worlds, detected, failures }).toEqual({ worlds: 2, detected: 2, failures: [] });
}, 60_000);

// A shared first name must not be attributed to the wrong member. Ana Kim is
// introduced to Maya; the scheduling and feedback messages name "Ana", but
// they are about Ana Kim, so no_contact on Ana Diaz must still pass. The
// naive first-name match (no disambiguation) fails this world, and it is the
// same collision that breaks minor-joins-single-player (a background adult
// Milo against the teen Milo Reyes) when the names are not disambiguated.
test("no-contact does not attribute a shared first name to the wrong member", async () => {
  const failures: string[] = [];
  let worlds = 0;
  for (const seed of [1, 2]) {
    const s: Scenario = {
      name: "no-contact-shared-first-name", description: "A shared first name names neither member alone.", seed, days: 7,
      personas: [{ ref: "a", name: "Maya Rivera" }, { ref: "b", name: "Ana Diaz" }, { ref: "c", name: "Ana Kim" }]
        .map((p, i) => ({ ...p, age: 30, city: "sf", homeArea: "Noe Valley", interests: ["coffee", "hiking"], desires: ["new_friends"], capacity: 0.9,
          responsiveness: { ignoreProb: 0, latencyMedianMin: 5 }, join: { day: 0, hour: 9, minute: i * 10 } })),
      actions: [{ at: { day: 2, hour: 11 }, do: "propose", kind: "intro", participants: ["a", "c"], objective: "coffee", city: "sf" }],
      expectations: [{ check: "no_contact", persona: "b" }],
    };
    const network = new StubNetwork({ seed, randomIntros: false });
    const result = await runScenario(s, { network: () => network });
    const msgs = result.world.records.filter(r => r.type === "message").map(r => r.msg)
      .filter(m => m.direction === "outbound" && !m.system);
    const scheduling = msgs.find(m => m.memberId === "a" && m.meta?.type === "scheduling" && m.body.startsWith("You're all set with Ana:"));
    const feedback = msgs.find(m => m.memberId === "a" && m.meta?.type === "feedback_request" && m.body === "How did it go with Ana?");
    if (!scheduling || !feedback) throw new Error(`The complete world must schedule and ask for feedback (seed ${seed})`);
    worlds++;
    const label = `seed ${seed}`;
    if (result.world.metrics.invariants.total || result.world.metrics.errors) failures.push(`${label}: invariant or runtime error`);
    if (!result.pass) failures.push(`${label}: messages about Ana Kim were attributed to Ana Diaz (${result.results[0]?.detail})`);
    // Replay controls replace only the name in the two real messages.
    // "Ana D." identifies Ana Diaz and must fail her check; "Ana K." is the
    // other Ana and must still pass it.
    const replay = (name: string) => {
      const renamed = (m: any) => (m === scheduling || m === feedback)
        ? { ...m, body: m.body.replace("Ana", name) } : m;
      const records = result.world.records.map(r => r.type === "message" ? { ...r, msg: renamed(r.msg) } : r);
      return evaluateExpectations(s, { ...result.world, records }, network.name)[0]?.status;
    };
    if (replay("Ana D.") !== "fail") failures.push(`${label}: surname-initial mention of Ana Diaz passed`);
    if (replay("Ana K.") !== "pass") failures.push(`${label}: surname-initial mention of Ana Kim failed Ana Diaz`);
  }
  expect({ worlds, failures }).toEqual({ worlds: 2, failures: [] });
}, 60_000);
