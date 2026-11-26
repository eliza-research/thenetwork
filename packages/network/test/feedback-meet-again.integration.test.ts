import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";
import { feedbackOf } from "../src/classify.ts";

async function feedbackWorld(reply: string) {
  const w = new Mini([
    { id: "a", name: "Ana Diaz", age: 30, area: "Greenpoint", interests: ["climbing"] },
    { id: "b", name: "Ben Ito", age: 30, area: "Greenpoint", interests: ["climbing"] },
  ], { seed: 1, inlineJudge: holdEveryItem.inline, growth: false });
  await w.onboard("a", "b");
  const id = w.propose(["a", "b"], { category: "hobby", objective: "a climbing session" });
  await w.runUntil(() => w.net.reviewQueue().some(q => q.oppId === id), DAY);
  expect(w.net.decide(id, "approve", { reviewer: "staff" })).toEqual({ ok: true });
  await w.answerProbes(["a", "b"]);
  expect(w.meetings.length).toBe(1);
  const at = w.meetings[0]!.at;
  await w.run(at - HOUR - w.clock.now());
  for (const id of ["a", "b"]) await w.say(id, "I visited the library this morning.");
  await w.runUntil(() => w.sent.some(m => m.to === "a" && m.meta.type === "feedback_request"), DAY);
  expect(w.net.memberList().find(m => m.id === "a")?.awaiting?.kind).toBe("feedback");
  await w.say("a", reply);
  const state = w.net.exportState();
  return {
    feedback: state.feedback.find(f => f.from === "a" && f.opportunityId === id),
    post: state.opps.find(o => o.id === id)?.post?.a,
  };
}

test("feedback that declines meeting again records no would-meet-again and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("It was fine, but I don't want to meet again");
  expect(feedback?.wouldMeetAgain).toBe(false);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that asks to meet again still records would-meet-again", async () => {
  const { feedback, post } = await feedbackWorld("I'd meet again");
  expect(feedback?.wouldMeetAgain).toBe(true);
  expect(post?.worthwhile).toBe(true);
});

test("feedback with a contraction about another clause still records would-meet-again", async () => {
  const { feedback, post } = await feedbackWorld("I can't make Saturday but would meet again");
  expect(feedback?.wouldMeetAgain).toBe(true);
  expect(post?.worthwhile).toBe(true);
});

test("contracted declines of meeting again read as no and contracted yes answers read as yes", () => {
  for (const reply of [
    "It was fine, but I don't want to meet again",
    "I didn't want to meet again",
    "I can't see myself meeting again",
    "I cannot see myself meeting again",
    "I have no interest in meeting again",
    "I don't feel like I want to meet again",
    "I don't want to see him again",
    "I don't think I'll go again",
    "don't think we'd click again",
    "don't text me again",
    "I can't ever meet again",
    "I didn't really feel like meeting again",
    "no interest in seeing her again",
  ]) expect(feedbackOf(reply).again, reply).toBe(false);
  for (const reply of [
    "cannot wait to meet again",
    "can't hardly wait to meet again",
    "can't  wait to meet again",
    "I didn't mind, would meet again",
    "don't mind meeting again",
    "can't believe how well it went, let's do it again",
    "I can't make Saturday but would meet again",
    "didn't want it to end, let's meet again",
    "I didn't expect much but would meet again",
    "why don't we meet again",
    "I don't want to wait to meet again",
    "don't want to wait long to meet again",
    "don't want it to end so let's meet again",
    "didn't want to leave and want to meet again",
    "I didn't think I'd like it so much and want to meet again",
    "I didn't think we'd click and now I want to go again",
    "can't do Saturday and would go again",
    "can't meet Saturday though would meet again",
    "don't do this often and I'd meet again",
    "I don't see any reason we shouldn't meet again",
    "I don't think I'd say no to meeting again",
    "I don't think so but would meet again",
    "I don't want to miss the chance to meet again",
    "I don't think we should wait to meet again",
    "I don't think twice about meeting again",
    "I don't think there's anyone I'd rather meet again",
    "I don't think I've ever wanted to meet someone again this much",
    "I don't see a problem with meeting again",
    "I don't see why we can't meet again",
    "I don't plan on saying no if we meet again",
    "didn't want the night to end we should meet again",
  ]) expect(feedbackOf(reply).again, reply).toBe(true);
});
