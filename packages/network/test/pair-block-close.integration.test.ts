import { expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { copy } from "../src/copy.ts";
import { peonHooks } from "../service/packs.ts";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const T = 300_000;
const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

async function book(w: Mini, pair: [string, string]): Promise<string> {
  const meetings = w.meetings.length;
  const id = w.propose(pair);
  expect(await w.runUntil(() => w.net.reviewQueue().some(o => o.oppId === id))).toBe(true);
  expect(w.net.review(id, "approve", { reviewer: "staff" })).toBe(true);
  await w.answerProbes(pair);
  expect(w.meetings).toHaveLength(meetings + 1);
  return id;
}

async function meetAndWaitForFeedback(w: Mini, pair: [string, string]): Promise<string> {
  const id = await book(w, pair);
  const booked = w.mark();
  expect(await w.runUntil(() => pair.every(member => w.to(member, booked).some(message =>
    message.meta.proposalId === id && message.meta.type === "reminder")), 7 * DAY)).toBe(true);
  for (const member of pair) await w.say(member, "Yes, I'll be there.");
  const dayOf = (member: string) => w.to(member, booked).some(message => message.meta.proposalId === id && message.body.startsWith("Still good for"));
  expect(await w.runUntil(() => pair.every(dayOf), 7 * DAY)).toBe(true);
  for (const member of pair) await w.say(member, "Yes, still good.");
  expect(await w.runUntil(() => pair.every(member =>
    w.net.memberList().find(m => m.id === member)?.awaiting?.kind === "feedback"), 7 * DAY)).toBe(true);
  return id;
}

const opp = (w: Mini, id: string) => w.net.exportState().opps.find(o => o.id === id);

test("a person block made on another app calls off a booked meeting of the pair here, and neither member learns who acted", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { inlineJudge: holdEveryItem.inline });
  await w.onboard("a", "b");
  const id = await book(w, ["a", "b"]);
  expect(opp(w, id)?.stage).toBe("scheduled");
  const mark = w.mark();
  w.edges.push({ from: "a", to: "b", type: "blocked", strength: 1, explicit: true, createdAt: w.clock.now() });
  const cancelled = (member: string) => w.to(member, mark).filter(s => s.meta.type === "cancellation" && s.meta.proposalId === id);
  expect(await w.runUntil(() => cancelled("a").length > 0 && cancelled("b").length > 0, DAY)).toBe(true);
  expect(opp(w, id)).toMatchObject({ stage: "closed", closedFrom: "scheduled", closedReason: "blocked" });
  for (const member of ["a", "b"]) expect(cancelled(member).map(s => s.body)).toEqual([copy.declinedQuiet]);
}, T);

test("a check-in report closes the pair's other open item and counts toward the subject's trust score", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cleo Park")], { inlineJudge: holdEveryItem.inline });
  await w.onboard("a", "b", "c");
  await meetAndWaitForFeedback(w, ["a", "b"]);
  await w.say("b", "It was great, we really clicked.");
  const second = w.propose(["a", "b"]);
  expect(await w.runUntil(() => w.net.reviewQueue().some(o => o.oppId === second))).toBe(true);
  expect(w.net.memberList().find(m => m.id === "a")?.awaiting?.kind).toBe("feedback");

  await w.say("a", "He never showed up.");
  expect(w.sent.at(-1)).toMatchObject({ to: "a", body: copy.checkInSafetyAsk("Ben") });
  expect(w.net.safetyReports()).toEqual([]);
  await w.say("a", "REPORT");
  expect(w.net.safetyReports().filter(r => r.subjectId === "b").map(r => [r.kind, r.source, r.reporterId])).toEqual([["no_show", "check_in", "a"]]);
  expect(opp(w, second)).toMatchObject({ stage: "closed", closedFrom: "review", closedReason: "blocked" });
  expect(w.net.reviewQueue().some(o => o.oppId === second)).toBe(false);
  expect(w.net.trust.level("b")).toBe("ok");

  await meetAndWaitForFeedback(w, ["c", "b"]);
  await w.say("c", "He never showed up.");
  expect(w.sent.at(-1)).toMatchObject({ to: "c", body: copy.checkInSafetyAsk("Ben") });
  await w.say("c", "REPORT");
  expect(w.net.safetyReports().filter(r => r.subjectId === "b").map(r => r.reporterId).sort()).toEqual(["a", "c"]);
  expect(w.net.trust.level("b")).toBe("watch");
  expect(w.net.safetyCases().find(c => c.memberId === "b")?.events.map(e => [e.kind, e.points])).toEqual(expect.arrayContaining([["report_received", 0], ["report_received", 3]]));
}, T);

test("peon: an answer to the check-in after a meeting that reports harm files a report and blocks the pair", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { inlineJudge: holdEveryItem.inline, hooks: peonHooks() });
  await w.onboard("a", "b");
  const id = await meetAndWaitForFeedback(w, ["a", "b"]);
  await w.say("a", "He never showed up.");
  expect(w.sent.at(-1)).toMatchObject({ to: "a", body: copy.checkInSafetyAsk("Ben") });
  expect(w.net.safetyReports()).toEqual([]);
  await w.say("a", "REPORT");
  expect(w.net.safetyReports().map(r => [r.kind, r.source, r.reporterId, r.subjectId, r.opportunityId])).toEqual([["no_show", "check_in", "a", "b", id]]);
  expect(w.sent.at(-1)).toMatchObject({ to: "a", body: expect.stringContaining("flagged this for the safety team") });
}, T);
