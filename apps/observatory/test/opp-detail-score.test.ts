// R19-TA: an opportunity detail's Score must agree with the score parts
// shown right under it.
//
// Journey: pipeline card click -> OpportunityPanel -> the Score disclosure
// ("Score {o.score.toFixed(2)}" + <ScoreParts c={o.components} />,
// web/panels.tsx; the review card shows the same pair, web/review.tsx).
// Spec basis: docs/observatory.md ("ObsOpportunity: the proposal (kind,
// generator, category, city, objective, score, 11 score components,
// explanations)") — one proposal carries a score AND its 11 components as
// a pair — and the engine's own invariant
// (packages/engine/src/scoring.ts scoreCandidate/netValue): a proposal's
// score IS the weighted net of its components. Engine proposals keep that
// invariant (engine.ts stores score and components from the same
// computation), so the parts explain the headline.
//
// Two non-engine producers break it: StubNetwork.makeProposal
// (packages/sim/src/stubNetwork.ts) pairs a random score
// (score: this.rng.next()) with ZERO components, and planToProposal
// (packages/engine/src/plans.ts) pairs the plan's own score
// (PlanScore: least-misery utility + familiarity) with ZERO components
// (newOpp defaults components to ZERO when the caller passes none,
// packages/network/src/network.ts). The projector copies both fields
// verbatim (projector.ts), so the detail shows e.g. "Score 0.73" above
// eleven 0.00 bars. The signed sum of the shown parts is 0.00 under any
// weights — netValue of all-zero components is exactly 0 — so the
// headline and its breakdown contradict each other on the same screen.
// A reviewer cannot tell what the score is made of, and the natural
// check (the parts) says 0.00.
//
// The fix hides the breakdown when it is all zeros (hasScoreParts,
// web/ui.tsx): eleven 0.00 bars carry no information and contradict a
// nonzero headline. The headline score stays visible in both places.
// The plan score is real (its own formula) and the stub score is the
// random baseline's by design, so neither producer is changed: the stub
// score feeds the seeded rng stream (changing it would shift every later
// draw), and the plan inputs (u/min/mean/familiarity) are not
// ScoreComponents, so no honest component mapping exists.
//
// Fixture: real planToProposal / scorePlanGroup / StubNetwork.makeProposal
// code; only the member inputs are synthetic. The plan score comes from
// the real scorePlanGroup, the stub score from the real seeded rng.
import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../../packages/engine/src/config.ts";
import { planToProposal, scorePlanGroup, type Plan } from "../../../packages/engine/src/plans.ts";
import { netValue } from "../../../packages/engine/src/scoring.ts";
import { StubNetwork } from "../../../packages/sim/src/stubNetwork.ts";
import { hasScoreParts } from "../web/ui.tsx";
import type { ScoreComponents } from "@thenetwork/core";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const world = { cfg: DEFAULT_CONFIG } as never;
const ZERO: ScoreComponents = {
  fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0,
  activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0,
};
const allZero = (c: ScoreComponents) => Object.values(c).every(v => v === 0);

test("the breakdown is hidden when every part is zero, shown otherwise", () => {
  expect(hasScoreParts(ZERO)).toBe(false);
  expect(hasScoreParts({ ...ZERO, fit: 1, confidence: 1 })).toBe(true);
  expect(hasScoreParts({ ...ZERO, load: 0.5 })).toBe(true);
});

test("plan proposal: a nonzero score arrives with all-zero parts (why the guard exists)", () => {
  const scored = scorePlanGroup(
    [
      { id: "m1", fit: 0.9, venueFit: 0.9, timeFit: 0.9 },
      { id: "m2", fit: 0.9, venueFit: 0.9, timeFit: 0.9 },
    ],
    () => 0.8,
    () => false,
  );
  expect(scored, "scorePlanGroup scores two keen members").not.toBeNull();
  const plan: Plan = {
    id: "plan1", city: "nyc", activityId: "bouldering",
    place: { name: "Brooklyn Boulders", area: "Williamsburg" },
    window: { start: NOW + 2 * 86_400_000, end: NOW + 2 * 86_400_000 + 3_600_000 },
    invited: ["m1", "m2"], alternates: [], partner: true,
    size: { min: 2, target: 2, max: 2 }, quorum: 2, probeDeadline: NOW + 86_400_000,
    score: scored!.score, u: scored!.u, familiar: scored!.familiar,
    createdAt: NOW, category: "social",
  };
  const prop = planToProposal(plan);
  expect(prop.score).toBeGreaterThan(0);
  expect(allZero(prop.components)).toBe(true);
  expect(netValue(world, prop.components)).toBe(0);
  expect(hasScoreParts(prop.components)).toBe(false);
});

test("stub random intro: a nonzero score arrives with all-zero parts (why the guard exists)", () => {
  const stub = new StubNetwork({ seed: 7 });
  const prop = (stub as unknown as {
    makeProposal(kind: "intro", participants: string[], city: "nyc", objective: string, explanations: Record<string, string>, now: number): { score: number; components: ScoreComponents };
  }).makeProposal("intro", ["m1", "m2"], "nyc", "one-to-one intro", { m1: "hunch", m2: "hunch" }, NOW);
  expect(prop.score).toBeGreaterThan(0);
  expect(allZero(prop.components)).toBe(true);
  expect(netValue(world, prop.components)).toBe(0);
  expect(hasScoreParts(prop.components)).toBe(false);
});

test("control: the engine formula distinguishes a real breakdown from all-zero parts", () => {
  const parts: ScoreComponents = {
    fit: 1, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0,
    activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 1,
  };
  expect(netValue(world, parts)).toBeCloseTo(1 / 2.5, 10);
  expect(netValue(world, ZERO)).toBe(0);
  expect(hasScoreParts(parts)).toBe(true);
});
