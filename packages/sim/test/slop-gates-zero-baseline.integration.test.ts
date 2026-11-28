import { expect, test } from "vitest";
import {
  extraOf,
  gates,
  gates3,
  mean,
  runArm,
  type ArmResult,
  type Extra,
  type Gate,
} from "../src/apps/slop/packEval.ts";
import { slopMetrics, type SlopMetrics } from "../src/apps/slop/metrics.ts";
import { runSlopWorldAsync, type SlopMatcher } from "../src/apps/slop/world.ts";

const SEEDS = [13];
const WEEKS = 2;
const PER_CITY = 150;
const WORLD_TIMEOUT_MS = 300_000;
const HIGH_SECOND_DATE_RATE = 0.3;

const noopMatcher: SlopMatcher = {
  name: "noop",
  propose: () => ({ proposals: [] }),
};

const runNoopRandomArm = async (): Promise<ArmResult> => {
  const metrics: SlopMetrics[] = [];
  const extra: Extra[] = [];
  for (const seed of SEEDS) {
    const res = await runSlopWorldAsync({
      seed,
      perCity: PER_CITY,
      weeks: WEEKS,
      matcher: noopMatcher,
    });
    const m = slopMetrics(res);
    metrics.push(m);
    extra.push(extraOf(res, m));
  }
  return { arm: "random", seeds: SEEDS, metrics, extra };
};

let slopArm: ArmResult | undefined;
let zeroRandomArm: ArmResult | undefined;
let normalRandomArm: ArmResult | undefined;
const getSlopArm = async (): Promise<ArmResult> =>
  (slopArm ??= await runArm("slop", SEEDS, WEEKS, PER_CITY));
const getZeroRandomArm = async (): Promise<ArmResult> =>
  (zeroRandomArm ??= await runNoopRandomArm());
const getNormalRandomArm = async (): Promise<ArmResult> =>
  (normalRandomArm ??= await runArm("random", SEEDS, WEEKS, PER_CITY));

const secondDateGates = (gs: Gate[]) => {
  const rate = gs.find((g) => g.name.startsWith("Second-date rate vs random"));
  const perSeed = gs.find((g) => g.name === "Second dates per seed vs random");
  expect(rate).toBeDefined();
  expect(perSeed).toBeDefined();
  return { rate: rate!, perSeed: perSeed! };
};

const datesGate = (gs: Gate[]): Gate => {
  const dates = gs.find((g) => g.name === "Dates per member-month vs random");
  expect(dates).toBeDefined();
  return dates!;
};

test("second-date gates fail on a zero random baseline", async () => {
  const slop = await getSlopArm();
  const random = await getZeroRandomArm();
  expect(random.metrics.every((m) => m.secondDateRate === 0)).toBe(true);
  expect(mean(random.metrics.map((m) => m.secondDateRate * m.dates))).toBe(0);
  expect(mean(slop.metrics.map((m) => m.secondDateRate))).toBeGreaterThan(0);
  expect(mean(slop.metrics.map((m) => m.secondDateRate * m.dates))).toBeGreaterThan(0);
  for (const gs of [gates(slop, random), gates3(slop, random)]) {
    const { rate, perSeed } = secondDateGates(gs);
    expect(rate.value).toBe(Infinity);
    expect(rate.pass).toBe(false);
    expect(perSeed.value).toBe(Infinity);
    expect(perSeed.pass).toBe(false);
  }
}, WORLD_TIMEOUT_MS);

test("second-date gates unchanged against a normal random arm", async () => {
  const slop = await getSlopArm();
  const random = await getNormalRandomArm();
  expect(mean(random.metrics.map((m) => m.secondDateRate))).toBeGreaterThan(0);
  expect(mean(random.metrics.map((m) => m.secondDateRate * m.dates))).toBeGreaterThan(0);
  for (const gs of [gates(slop, random), gates3(slop, random)]) {
    const { rate, perSeed } = secondDateGates(gs);
    expect(rate.value).toBeLessThan(2.5);
    expect(rate.pass).toBe(false);
    expect(perSeed.value).toBeLessThan(2);
    expect(perSeed.pass).toBe(false);
  }
}, WORLD_TIMEOUT_MS);

test("rate gate fails on a zero baseline above the 20% floor", async () => {
  const slop = await getSlopArm();
  const random = await getZeroRandomArm();
  const highRate: ArmResult = {
    ...slop,
    metrics: slop.metrics.map((m) => ({
      ...m,
      secondDateRate: HIGH_SECOND_DATE_RATE,
    })),
  };
  expect(mean(highRate.metrics.map((m) => m.secondDateRate))).toBeGreaterThanOrEqual(0.2);
  expect(mean(highRate.metrics.map((m) => m.secondDateRate * m.dates))).toBeGreaterThan(0);
  expect(random.metrics.every((m) => m.secondDateRate === 0)).toBe(true);
  for (const gs of [gates(highRate, random), gates3(highRate, random)]) {
    const { rate, perSeed } = secondDateGates(gs);
    expect(rate.value).toBe(Infinity);
    expect(rate.pass).toBe(false);
    expect(perSeed.value).toBe(Infinity);
    expect(perSeed.pass).toBe(false);
  }
});

test("dates-per-member-month fails on a zero random baseline", async () => {
  const slop = await getSlopArm();
  const random = await getZeroRandomArm();
  expect(random.metrics.every((m) => m.dates === 0)).toBe(true);
  expect(random.metrics.every((m) => m.datesPerMemberMonth === 0)).toBe(true);
  expect(mean(slop.metrics.map((m) => m.datesPerMemberMonth))).toBeGreaterThan(0);
  for (const gs of [gates(slop, random), gates3(slop, random)]) {
    const dates = datesGate(gs);
    expect(dates.value).toBe(Infinity);
    expect(dates.pass).toBe(false);
  }
}, WORLD_TIMEOUT_MS);

test("dates-per-member-month unchanged on a normal random arm", async () => {
  const slop = await getSlopArm();
  const random = await getNormalRandomArm();
  expect(mean(slop.metrics.map((m) => m.datesPerMemberMonth))).toBeGreaterThan(0);
  expect(mean(random.metrics.map((m) => m.datesPerMemberMonth))).toBeGreaterThan(0);
  for (const gs of [gates(slop, random), gates3(slop, random)]) {
    const dates = datesGate(gs);
    expect(dates.value).toBeGreaterThan(0);
    expect(Number.isFinite(dates.value)).toBe(true);
    expect(dates.pass).toBe(dates.value >= 0.9);
  }
}, WORLD_TIMEOUT_MS);
