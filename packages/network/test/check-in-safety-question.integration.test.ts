import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { copy } from "../src/copy.ts";
import { Mini } from "./mini.ts";

const T = 300_000;
const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

type BookedOpp = ReturnType<Mini["net"]["exportState"]>["opps"][number];

async function meetAndWaitForFeedback(w: Mini, keep?: (booked: BookedOpp) => void): Promise<string> {
  const pair: [string, string] = ["a", "b"];
  await w.onboard(...pair);
  const id = w.propose(pair);
  await w.answerProbes(pair);
  keep?.(structuredClone(w.net.exportState().opps.find(o => o.id === id)!));
  const booked = w.mark();
  expect(await w.runUntil(() => pair.every(member => w.to(member, booked).some(message =>
    message.meta.proposalId === id && message.meta.type === "reminder")), 7 * DAY)).toBe(true);
  for (const member of pair) await w.say(member, "Yes, I'll be there.");
  expect(await w.runUntil(() => pair.every(member =>
    w.net.memberList().find(m => m.id === member)?.awaiting?.kind === "feedback"), 7 * DAY)).toBe(true);
  return id;
}

const questions = (w: Mini, from = 0) => w.to("a", from).filter(s => s.body.includes(copy.checkInSafetyAsk("Ben")));
const pending = (w: Mini) => w.net.exportState().members.find(m => m.id === "a")?.pendingSafety;
const reports = (w: Mini) => w.net.safetyReports().map(r => [r.kind, r.source, r.reporterId, r.subjectId, r.opportunityId]);
const blocked = (w: Mini) => w.net.exportState().blocks.includes("a|b");

test("ntwrk: a check-in answer that describes a problem without report words asks once, and 'report' opens the case about the person met", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
  const id = await meetAndWaitForFeedback(w);
  const mark = w.mark();
  await w.say("a", "He made me really uncomfortable.");
  expect(questions(w, mark)).toHaveLength(1);
  expect(reports(w)).toEqual([]);
  expect(blocked(w)).toBe(false);
  expect(pending(w)).toMatchObject({ verb: "check_in", targets: ["b"], oppId: id });
  expect(w.net.exportState().feedback.filter(f => f.from === "a" && f.about === "b" && f.opportunityId === id)).toHaveLength(1);

  await w.say("a", "report");
  expect(reports(w)).toEqual([["other", "check_in", "a", "b", id]]);
  expect(blocked(w)).toBe(true);
  expect(pending(w)).toBeUndefined();
  expect(w.sent.at(-1)).toMatchObject({ to: "a", body: copy.reported() });
}, T);

test("ntwrk: a no-show said in the check-in asks once, and 'block' blocks the pair without a report", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
  await meetAndWaitForFeedback(w);
  const mark = w.mark();
  await w.say("a", "He never showed up.");
  expect(questions(w, mark)).toHaveLength(1);
  expect(reports(w)).toEqual([]);

  await w.say("a", "Block him please");
  expect(blocked(w)).toBe(true);
  expect(reports(w)).toEqual([]);
  expect(pending(w)).toBeUndefined();
  expect(w.sent.at(-1)).toMatchObject({ to: "a", body: copy.blocked });
}, T);

test("ntwrk: 'no' to the check-in question opens nothing and closes the question", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
  await meetAndWaitForFeedback(w);
  const mark = w.mark();
  await w.say("a", "Something felt off the whole time.");
  expect(questions(w, mark)).toHaveLength(1);
  await w.say("a", "No");
  expect(reports(w)).toEqual([]);
  expect(blocked(w)).toBe(false);
  expect(pending(w)).toBeUndefined();
}, T);

test("ntwrk: a positive or a chemistry-only answer asks nothing", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
  await meetAndWaitForFeedback(w);
  const mark = w.mark();
  await w.say("a", "It was great, we really clicked.");
  await w.say("b", "We didn't click, not my type.");
  expect(questions(w, mark)).toHaveLength(0);
  expect(w.to("b", mark).filter(s => s.body.includes(copy.checkInSafetyAsk("Ana")))).toHaveLength(0);
  expect(w.net.exportState().members.filter(m => m.pendingSafety)).toEqual([]);
  expect(reports(w)).toEqual([]);
}, T);

test("ntwrk: the question is asked once; an unclear answer opens no case and a later 'report' is not read as its answer", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
  await meetAndWaitForFeedback(w);
  const mark = w.mark();
  await w.say("a", "He made me uncomfortable, honestly.");
  await w.say("a", "hmm I need to think");
  expect(pending(w)).toBeUndefined();
  await w.say("a", "report");
  expect(reports(w)).toEqual([]);
  expect(blocked(w)).toBe(false);
  expect(questions(w, mark)).toHaveLength(1);
}, T);

test("ntwrk: an urgent check-in answer opens the case at once without a question", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
  const id = await meetAndWaitForFeedback(w);
  const mark = w.mark();
  await w.say("a", "He was creepy and aggressive with me.");
  expect(questions(w, mark)).toHaveLength(0);
  expect(reports(w)).toEqual([["harassment", "check_in", "a", "b", id]]);
  expect(blocked(w)).toBe(true);
  expect(pending(w)).toBeUndefined();
  expect(w.sent.at(-1)).toMatchObject({ to: "a", body: copy.reported() });
}, T);

test("the check-in question survives a restart, and the answer after it opens the case", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
  const id = await meetAndWaitForFeedback(w);
  await w.say("a", "I felt uneasy around him.");
  w.restart();
  expect(pending(w)).toMatchObject({ verb: "check_in", targets: ["b"], oppId: id });
  await w.say("a", "report and block");
  expect(reports(w)).toEqual([["other", "check_in", "a", "b", id]]);
  expect(blocked(w)).toBe(true);
}, T);

test("an answer more than a day after the question lapses: no case, and the feedback stays", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
  const id = await meetAndWaitForFeedback(w);
  const mark = w.mark();
  await w.say("a", "He made me uncomfortable.");
  expect(questions(w, mark)).toHaveLength(1);
  await w.run(25 * HOUR);
  await w.say("a", "report");
  expect(reports(w)).toEqual([]);
  expect(blocked(w)).toBe(false);
  expect(pending(w)).toBeUndefined();
  expect(w.net.exportState().feedback.filter(f => f.from === "a" && f.opportunityId === id)).toHaveLength(1);
}, T);

test("with post-date reports on, a concern without a report kind asks once", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
  const id = await meetAndWaitForFeedback(w);
  const mark = w.mark();
  await w.say("a", "Something felt off and he made me uncomfortable.");
  expect(questions(w, mark)).toHaveLength(1);
  expect(reports(w)).toEqual([]);
  await w.say("a", "Report him");
  expect(reports(w)).toEqual([["other", "check_in", "a", "b", id]]);
}, T);

test.each([
  "I don't want to report him",
  "No, I don't want to report or block",
  "Should I report him?",
  "No, we both moved on",
])("a refusal, a question or a 'both' inside a sentence opens nothing: %s", async answer => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
  await meetAndWaitForFeedback(w);
  const mark = w.mark();
  await w.say("a", "He made me really uncomfortable.");
  expect(questions(w, mark)).toHaveLength(1);
  await w.say("a", answer);
  expect(reports(w)).toEqual([]);
  expect(blocked(w)).toBe(false);
  expect(w.net.exportState().blocks).toEqual([]);
  expect(pending(w)).toBeUndefined();
}, T);

test("a report that names someone else goes to the ordinary flow and files nothing about the person asked about", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
  await meetAndWaitForFeedback(w);
  const mark = w.mark();
  await w.say("a", "He made me really uncomfortable.");
  expect(questions(w, mark)).toHaveLength(1);
  await w.say("a", "Report Marco");
  expect(reports(w)).toEqual([]);
  expect(blocked(w)).toBe(false);
  expect(pending(w)).toBeUndefined();
}, T);

test("a bare 'no' to a day-of check-in that is open with the question cancels that meeting, and the question stays open", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
  let snapshot: BookedOpp | undefined;
  const id = await meetAndWaitForFeedback(w, booked => { snapshot = booked; });
  const mark = w.mark();
  await w.say("a", "Something felt off the whole time.");
  expect(questions(w, mark)).toHaveLength(1);
  const now = w.clock.now();
  const meetingAt = now + 2 * HOUR;
  const state = w.net.exportState();
  state.opps.push({ ...snapshot!, id: "next-booking", meetingAt });
  const a = state.members.find(m => m.id === "a")!;
  a.awaiting = { kind: "booked", oppId: "next-booking", at: now, bookedCheckIn: { meetingAt, revision: 0 } };
  w.net.importState(state);
  expect(pending(w)).toMatchObject({ verb: "check_in", targets: ["b"], oppId: id });

  const before = w.mark();
  await w.say("a", "No, I can't make it.");
  expect(w.net.opps.get("next-booking")?.stage).toBe("closed");
  expect(w.to("a", before).map(s => s.body)).not.toContain(copy.safetyNoAction);
  expect(reports(w)).toEqual([]);
  expect(blocked(w)).toBe(false);
  expect(pending(w)).toMatchObject({ verb: "check_in", targets: ["b"], oppId: id });

  await w.say("a", "report");
  expect(reports(w)).toEqual([["other", "check_in", "a", "b", id]]);
  expect(blocked(w)).toBe(true);
}, T);
