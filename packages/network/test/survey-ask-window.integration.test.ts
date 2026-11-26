// spec/interruptionFeedback.md, "Sample a confirmed invitation after its own answer"
// A member's own ask allows two follow-ups in 48 hours without a pause path. The simulator judge
// counts them by timing, so an invitation survey sent in that window is one of the two. The Network
// must count it too: the message after the two follow-ups is proactive and carries the pause path
// (PRD PH-003, the judge's pause_path_missing rule). Found by the network block, seed 3.
import { expect, test } from "vitest";
import { DAY, HOUR, type MemberId, type RunRecord } from "@thenetwork/core";
import { computeMetrics } from "../../sim/src/judge/metrics.ts";
import { hasPausePath } from "../../sim/src/judge/rules.ts";
import { interruptionSampleBucket } from "../src/interruption-feedback.ts";
import { Mini } from "./mini.ts";
import { simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing"], skills: ["belaying"] });

test("an invitation survey in a member's ask window uses one of the ask's follow-ups", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")], { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  // Every message in order, as the run log has them (the judge reads replies from the order and the times).
  const inbound: { at: number; t: number; id: MemberId; body: string }[] = [];
  const say = async (id: MemberId, body: string) => { inbound.push({ at: w.sent.length, t: w.clock.now(), id, body }); await w.say(id, body); };
  // One invitation in ten is sampled for the survey, by a hash of the app, member and opportunity.
  const propose = (pair: MemberId[], sampled: boolean) => {
    const seq = w as unknown as { seq: number };
    while ((interruptionSampleBucket("ntwrk", "a", `player-${seq.seq + 1}`) === 0) !== sampled) seq.seq++;
    return w.propose(pair);
  };
  const toAna = (type: string) => w.sent.filter(s => s.to === "a" && s.meta.type === type);
  const survey = () => w.sent.find(s => s.to === "a" && /WORTH YES/.test(s.body));

  for (const id of ["a", "b", "c"]) for (const line of ["hi!", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."]) await say(id, line);
  await w.run(30 * HOUR);
  propose(["a", "b"], true);
  await w.run(18 * HOUR);
  // Ana writes first (nothing was sent to her for a day): her ask. The invitation an hour later is follow-up 1.
  await say("a", "Weekends work best.");
  expect(await w.runUntil(() => w.probed("a"), DAY)).toBe(true);
  expect(hasPausePath(toAna("probe")[0]!.body)).toBe(false);
  await say("a", "No");
  // The survey goes out a day after her answer, inside the ask window: follow-up 2 by its timing.
  propose(["c", "a"], false);
  expect(await w.runUntil(() => w.probed("c") && !!survey(), 2 * DAY)).toBe(true);
  expect(survey()?.meta.proactive).toBe(true);
  expect(hasPausePath(survey()!.body)).toBe(true);
  expect(toAna("probe")).toHaveLength(1);
  await say("a", "Weekends work best.");
  await w.run(HOUR);
  // Cy says yes, so Ana's invitation goes out now: more than 15 minutes after her last message, still inside the ask window.
  await say("c", "yes");
  expect(await w.runUntil(() => toAna("probe").length === 2, 6 * HOUR)).toBe(true);
  const second = toAna("probe")[1]!;
  expect(second.t - inbound.find(i => i.id === "a" && i.body === "Weekends work best.")!.t).toBeLessThan(2 * DAY);
  expect(hasPausePath(second.body)).toBe(true);

  const message = (id: string, t: number, memberId: MemberId, direction: "inbound" | "outbound", body: string, meta?: object): RunRecord =>
    ({ t, type: "message", msg: { id, ts: t, memberId, direction, status: "delivered", body, ...(meta ? { meta } : {}) } } as RunRecord);
  const records: RunRecord[] = [{ t: 0, type: "persona", persona: {
    id: "a", name: "Ana Diaz", archetype: "regular", homeCity: "nyc", joinDay: 0, trueAge: 30, claimedAge: 30, quietHours: [21, 9], romanceOptIn: false,
  } } as RunRecord];
  for (let i = 0; i <= w.sent.length; i++) {
    inbound.forEach((x, n) => { if (x.at === i && x.id === "a") records.push(message(`i${n}`, x.t, x.id, "inbound", x.body)); });
    const s = w.sent[i];
    if (s?.to === "a") records.push(message(`o${i}`, s.t, s.to, "outbound", s.body, s.meta));
  }
  expect(computeMetrics(records).invariants.byRule).toEqual({});
}, 120_000);
