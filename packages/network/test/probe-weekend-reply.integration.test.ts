// A reply that names the weekend picks only the offered weekend times (packages/network/src/classify.ts,
// parseProbeReply), and with no weekend time offered it is asked again. NYC world, seed 2: a member
// with a probe for Monday, Tuesday or Thursday 7pm was asked "is that a yes or a no?" and wrote
// "Weekends work best. ✨💯". The Network read the emoji as a yes to every offered time, booked a
// weekday plan and named the member to the other person; the member's real answer was "Can't this
// week, maybe another time."
import { expect, test } from "vitest";
import { Mini } from "./mini.ts";
import { simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";

const newcomer = (id: string, name: string) => ({ id, name, age: 30, area: "Williamsburg", interests: ["board games", "live music"], wants: [{ objective: "make a few new friends in the city", category: "social" as const }] });

test("a weekend preference is a yes only to the offered weekend times", async () => {
  const w = new Mini([newcomer("a", "Ana Diaz"), newcomer("b", "Ben Ito")], { inlineJudge: simulatedReviewJudge({ exceptions: false }) });
  // Both said they are free on weekday evenings: the probe offers a weekday evening and the weekend.
  for (const id of ["a", "b"]) w.facets.push({ id: `${id}:availability`, memberId: id, kind: "availability_pattern", value: "weekday evenings", tags: ["evening:Mon", "evening:Tue", "evening:Wed", "evening:Thu"], scope: "agent_private", provenance: "said", confidence: 0.9, validFrom: w.clock.now(), source: "chat", observedAt: w.clock.now(), inferred: false, confirmedByMember: true });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  expect(await w.runUntil(() => w.probed("a"))).toBe(true);
  const options = w.sent.filter(s => s.to === "a").at(-1)!.meta.timeOptions ?? [];
  const weekend = options.filter(o => /^(Saturday|Sunday)/.test(o.label)).map(o => o.key);
  expect(weekend.length).toBeGreaterThan(0);
  expect(weekend.length).toBeLessThan(options.length);
  await w.say("a", "Weekends work best. ✨💯");
  expect(w.log("probe_answer").filter(l => l.detail.memberId === "a").map(l => [l.detail.yes, l.detail.picked])).toEqual([[true, weekend]]);
});
