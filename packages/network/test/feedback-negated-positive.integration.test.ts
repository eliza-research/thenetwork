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

test("feedback that compares the click with anyone else still records positive sentiment and worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("I've never clicked with anyone better");
  expect(feedback?.sentiment).toBe("positive");
  expect(feedback?.wouldMeetAgain).toBe(true);
  expect(post?.worthwhile).toBe(true);
});

test("feedback that says the pair clicked after a slow start still records positive sentiment and worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Hardly clicked at first, then we really clicked");
  expect(feedback?.sentiment).toBe("positive");
  expect(feedback?.wouldMeetAgain).toBe(true);
  expect(post?.worthwhile).toBe(true);
});

test("feedback that is disappointed the meeting ended still records positive sentiment and worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("I was disappointed it ended so soon, loved it");
  expect(feedback?.sentiment).toBe("positive");
  expect(post?.worthwhile).toBe(true);
});

test("feedback that says talking got easy after a though clause still records positive sentiment and worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Not easy to talk to new people though she made it easy");
  expect(feedback?.sentiment).toBe("positive");
  expect(post?.worthwhile).toBe(true);
});

test("feedback that says talking to a stranger is hard but she made it effortless still records positive sentiment and worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("It's not easy to talk to a stranger, she made it effortless");
  expect(feedback?.sentiment).toBe("positive");
  expect(post?.worthwhile).toBe(true);
});

test("feedback that answers not disappointed at all records neutral sentiment", async () => {
  const { feedback } = await feedbackWorld("Disappointed? Not at all.");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
});

test("feedback that says the pair never clicked though the cafe was nice records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("We never clicked, though the cafe was nice");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the member was disappointed he left early records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Disappointed he left early");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that is disappointed she lives across town records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Disappointed she lives across town, she's a gem");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says she never clicked like on a profile still records positive sentiment and worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("She never clicked like on my profile, ha, but she's wonderful");
  expect(feedback?.sentiment).toBe("positive");
  expect(feedback?.wouldMeetAgain).toBe(true);
  expect(post?.worthwhile).toBe(true);
});

test("feedback that says an ex is not easy to talk to still records positive sentiment and worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Not easy to talk to my ex, but this guy is a dream");
  expect(feedback?.sentiment).toBe("positive");
  expect(post?.worthwhile).toBe(true);
});

test("feedback that says he was not easy to talk to at all records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("He wasn't easy to talk to at all");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says he never really connected with me records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("He never really connected with me");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the member was disappointed in how it went records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("I was disappointed in how it went");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the pair never clicked but the food was great records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("We never clicked, but it was a great evening for the food");
  expect(feedback?.sentiment).toBe("negative");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that never clicked with his texts before the meeting still records positive sentiment and worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Never clicked with his texts before we met, in person he was fantastic");
  expect(feedback?.sentiment).toBe("positive");
  expect(feedback?.wouldMeetAgain).toBe(true);
  expect(post?.worthwhile).toBe(true);
});

test("feedback that says talking at a noisy table was hard still records positive sentiment and worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Not easy to talk to her at the noisy table, she was brilliant");
  expect(feedback?.sentiment).toBe("positive");
  expect(post?.worthwhile).toBe(true);
});

test("feedback that is disappointed by a phone check for work records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Disappointed he checked his phone once for work, otherwise brilliant company");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that is disappointed with a restaurant pick records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Disappointed with his restaurant pick, he was fantastic");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that calls the evening weather disappointing records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Disappointing evening weather, but she was brilliant");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says he was not easy to talk to and there was no spark records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("He wasn't easy to talk to. Nice guy, but no spark");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that is disappointed she kept checking her phone records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Disappointed she kept checking her phone");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the pair never clicked and he was arrogant records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("We never clicked, he's arrogant");
  expect(feedback?.sentiment).toBe("negative");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the pair never clicked and the conversation was forced records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("We never clicked, the conversation was forced");
  expect(feedback?.sentiment).toBe("negative");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the pair never clicked and the date was pointless records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("We never clicked, the date was pointless");
  expect(feedback?.sentiment).toBe("negative");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the pair never clicked and she was married records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("We never clicked, she's married it turns out");
  expect(feedback?.sentiment).toBe("negative");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says he was not easy to talk to and self-absorbed records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("He wasn't easy to talk to, he's self-absorbed");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the pair never really connected and he was a narcissist records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Never really connected with him, he's a narcissist");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the pair never connected and the evening was a waste records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Never connected, the whole evening was a waste");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the pair hardly connected and the chat was stilted records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Hardly connected with him, our chat was stilted");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the member was disappointed in the date records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Disappointed in the date");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that says the member was disappointed in this date records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Disappointed in this date");
  expect(feedback?.sentiment).toBe("negative");
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that barely connected by email and calls him a riot records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Barely connected with him by email, the real him is a riot");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that is disappointed by a phone check for a family emergency records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Disappointed he checked his phone for a family emergency, totally understandable, stellar guy");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that hardly connected at first and became thick as thieves records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Hardly connected at first, by the second drink we were thick as thieves");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that never clicked at first and ended up closing the bar together records positive sentiment and worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("We never clicked at first. Ended up closing the bar together");
  expect(feedback?.sentiment).toBe("positive");
  expect(feedback?.wouldMeetAgain).toBe(true);
  expect(post?.worthwhile).toBe(true);
});

test("feedback that never clicked at first and calls him a marvel records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Never clicked at first, he's a marvel");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that hardly connected at first and calls her a treasure records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Hardly connected at first, she is a treasure");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that was not easy to talk to at first and says the pair were glued to each other records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Not easy to talk to him at first, by the end we were glued to each other");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that barely connected at first and chatted until the lights came up records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Barely connected at first, then we chatted until the lights came up");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that never clicked at first and calls the evening a slow burn records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Never clicked at first, our evening was a slow burn");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that hardly connected at first and then felt familiar records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Hardly connected at first, then it was like we'd known each other for years");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that never clicked at first and then danced all night records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("We never clicked at first, then we danced all night");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that hardly connected at first and ended smitten records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Hardly connected at first, by the end I was smitten");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that never really clicked at first and counts the days records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Never really clicked at first, now I'm counting the days till Friday");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that never clicked at first and swapped numbers records neutral sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("We never clicked at first, then we swapped numbers and texted all night");
  expect(feedback?.sentiment).toBe("neutral");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that hardly connected and calls her dull records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Hardly connected with her, she was dull");
  expect(feedback?.sentiment).toBe("negative");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});

test("feedback that never clicked at first and ends with no spark records negative sentiment and no worthwhile", async () => {
  const { feedback, post } = await feedbackWorld("Never clicked at first, he's a marvel, but no spark");
  expect(feedback?.sentiment).toBe("negative");
  expect(feedback?.wouldMeetAgain).not.toBe(true);
  expect(post?.worthwhile).not.toBe(true);
});
