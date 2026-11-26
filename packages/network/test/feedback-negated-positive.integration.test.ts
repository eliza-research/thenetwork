import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

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
  for (const member of ["a", "b"]) await w.say(member, "I visited the library this morning.");
  await w.runUntil(() => w.sent.some(m => m.to === "a" && m.meta.type === "feedback_request"), DAY);
  expect(w.net.memberList().find(m => m.id === "a")?.awaiting?.kind).toBe("feedback");
  await w.say("a", reply);
  const state = w.net.exportState();
  return {
    feedback: state.feedback.find(f => f.from === "a" && f.opportunityId === id),
    post: state.opps.find(o => o.id === id)?.post?.a,
  };
}

// spec/meetingSettlement.md, "A worthwhile answer records the member's own experience during the open attendance period"
test("feedback that says the pair never clicked records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("We never clicked");
  expect(feedback?.sentiment).toBe("negative");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the other member was not easy to talk to records no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("He wasn't easy to talk to");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the pair did not click records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("We did not click");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the member was disappointed records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("I was greatly disappointed");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the member was not disappointed still records positive sentiment and worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Not disappointed at all, it was great");
  expect(feedback?.sentiment).toBe("positive");
  expect(post?.worthwhile).toBe(true);
});

test("feedback that says the pair clicked faster than ever still records positive sentiment and worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("I've never clicked with someone so fast");
  expect(feedback?.sentiment).toBe("positive");
  expect(feedback?.wouldMeetAgain).toBe(true);
  expect(post?.worthwhile).toBe(true);
});

test("feedback that says talking got easy still records positive sentiment and worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("It's not easy to talk to new people, but she made it easy");
  expect(feedback?.sentiment).toBe("positive");
  expect(post?.worthwhile).toBe(true);
});

test("feedback that says the pair clicked still records positive sentiment and worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("We clicked, he was easy to talk to");
  expect(feedback?.sentiment).toBe("positive");
  expect(feedback?.wouldMeetAgain).toBe(true);
  expect(post?.worthwhile).toBe(true);
});
