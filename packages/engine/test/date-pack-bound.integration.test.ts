import { type MemberId, Rng } from "@thenetwork/core";
import { expect, test } from "vitest";
import { laneLimits, laneWeights } from "../../core/src/generated/matchLane.ts";
import { dateTypeCeiling } from "../../core/src/generated/datePackValue.ts";
import { directedUtility } from "../../core/src/generated/pairValue.ts";
import { SLOP_DEFAULT_OPTIONS } from "../src/packs/slop/options.ts";
import { datePackBound, datePackClassCap, datePackClassKey } from "../src/packs/slop/packBound.ts";
import { SLOTS, type SlopProfile } from "../src/packs/slop/profile.ts";
import { DATE_TYPE_WEIGHT, datePackValue } from "../src/packs/slop/score.ts";

const INTERESTS = ["climbing", "jazz", "cooking", "film", "running", "board_games", "art", "travel", "dogs", "books", "yoga", "wine"];
const ACTIVITIES = ["coffee", "drinks", "walk", "museum", "dinner", "live_music", "comedy", "climbing", "cooking_class", "hike"];
const BODY = ["slim", "athletic", "average", "curvy", "plus_size"];

function profile(r: Rng, n: number): SlopProfile {
  const maybe = <T>(p: number, x: () => T): T | undefined => (r.bool(p) ? x() : undefined);
  const pickSome = (xs: readonly string[], most: number) => r.sample(xs, r.int(0, most)).sort();
  const unit = (v: number[]) => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
  const rated = r.bool(0.4) ? r.int(1, 6) : 0;
  return {
    id: `m${n}` as MemberId, age: r.int(18, 60), adult: true, optedIn: true, paused: false, homeMarket: "nyc", zipUnknown: false,
    seeks: [], shownTo: [], dealbreakers: r.bool(0.4) ? r.sample(["smoker", "heavy_drinker", "religious", "right_politics"], r.int(1, 2)) : [],
    goal: maybe(0.8, () => r.weighted([["casual", 0.25], ["long_term", 0.5], ["unsure", 0.25]] as const)),
    values: {
      smoking: maybe(0.7, () => r.weighted([["never", 0.8], ["sometimes", 0.13], ["regular", 0.07]] as const)),
      drinking: maybe(0.7, () => r.weighted([["never", 0.12], ["social", 0.7], ["regular", 0.18]] as const)),
      hasKids: maybe(0.6, () => r.pick(["yes", "no"])),
      wantsKids: maybe(0.6, () => r.weighted([["yes", 0.42], ["no", 0.23], ["open", 0.35]] as const)),
      religionImportance: maybe(0.6, () => r.int(0, 3)),
      politics: maybe(0.6, () => r.weighted([["left", 0.6], ["moderate", 0.28], ["right", 0.12]] as const)),
    },
    interests: pickSome(INTERESTS, 5), shareableInterests: [], activities: pickSome(ACTIVITIES, 3), free: pickSome(SLOTS, 3) as SlopProfile["free"],
    wants: maybe(0.6, () => unit([0, 1, 2, 3, 4].map(() => r.normal()))),
    self: maybe(0.7, () => [0, 1, 2, 3, 4].map(() => r.normal(0, 1.3))),
    wantsBody: r.bool(0.25) ? pickSome(BODY, 3) : [],
    appearance: maybe(0.7, () => ({ face: r.next(), body: r.next(), overall: r.next(), confidence: r.range(0.2, 1), bodyType: r.pick(BODY) as never, bodyTypeConfidence: r.range(0.2, 1) })),
    safety: [], verification: [], silentAsks: [], openAsks: [], askCounts: {}, visiting: [], interestFacet: new Map(),
    history: {
      yes: 0, no: 0, silent: 0, dates: rated, noShows: 0, backouts: 0, negativeFrom: 0, contextualBlocks: 0, attendedSlots: [], rated: [],
      ratedSelf: Array.from({ length: rated }, () => ({ self: [0, 1, 2, 3, 4].map(() => r.normal(0, 1.3)), v: r.next() })),
      ratedBody: Array.from({ length: rated }, () => ({ type: r.pick(BODY), v: r.next() })),
    },
  };
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

test("the Date pair bound and class caps are at least the pack value, and many fall below the untagged floor", () => {
  const r = new Rng(20261118);
  const people = Array.from({ length: 3000 }, (_, n) => profile(r, n));
  const o = SLOP_DEFAULT_OPTIONS;
  const w = laneWeights("Date"), floor = laneLimits("Date").rules.utilityFloor;
  const untaggedUtility = (pack: number) => directedUtility([{ weight: w.complement, value: 0 }, { weight: w.affinity, value: 0 }, { weight: w.pack, value: pack }]);
  let infeasibleBelow = 1000;
  while (untaggedUtility(infeasibleBelow) >= floor) infeasibleBelow--;
  expect(infeasibleBelow).toBe(933);
  expect(Math.round(1000 * Math.exp(2 * DATE_TYPE_WEIGHT))).toBeLessThanOrEqual(dateTypeCeiling);

  const violations = { bound: 0, cap: 0, boundOverCap: 0, untouchedCap: 0 };
  const slack: number[] = [];
  let pairs = 0, untouched = 0, valueLow = 0, boundLow = 0, capLow = 0, untouchedLow = 0;
  for (let n = 0; n < 200_000; n++) {
    const a = people[r.int(0, people.length - 1)]!, b = people[r.int(0, people.length - 1)]!;
    if (a === b) continue;
    pairs++;
    const value = datePackValue(a, b, o), bound = datePackBound(a, b, o), cap = datePackClassCap(a, datePackClassKey(b), false, o);
    if (bound < value) violations.bound++;
    if (cap < value) violations.cap++;
    if (cap < bound) violations.boundOverCap++;
    slack.push(bound - value);
    if (value <= infeasibleBelow) valueLow++;
    if (bound <= infeasibleBelow) boundLow++;
    if (cap <= infeasibleBelow) capLow++;
    if (!a.interests.some(x => b.interests.includes(x)) && !(b.free.length && a.free.some(s => b.free.includes(s)))) {
      untouched++;
      const untouchedCap = datePackClassCap(a, datePackClassKey(b), true, o);
      if (untouchedCap < bound) violations.untouchedCap++;
      if (untouchedCap <= infeasibleBelow) untouchedLow++;
    }
  }
  slack.sort((x, y) => x - y);
  const share = (k: number, of: number) => Number((k / of).toFixed(3));
  console.log(JSON.stringify({
    pairs, infeasibleBelow,
    slack: { mean: Number((slack.reduce((s, x) => s + x, 0) / slack.length).toFixed(1)), q1: quantile(slack, 0.25), median: quantile(slack, 0.5), q3: quantile(slack, 0.75), max: slack[slack.length - 1] },
    shareAtOrBelow: { value: share(valueLow, pairs), pairBound: share(boundLow, pairs), classCap: share(capLow, pairs), untouchedClassCap: share(untouchedLow, untouched) },
    untouchedPairs: untouched,
  }));
  expect(violations).toEqual({ bound: 0, cap: 0, boundOverCap: 0, untouchedCap: 0 });
});
