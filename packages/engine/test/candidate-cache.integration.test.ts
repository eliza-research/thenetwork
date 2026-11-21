// spec/candidateCache.md, "Story: Keep cached candidates correct when members join"; spec/candidateCache.md, "Story: Repair cached candidates when members leave or change"
import { expect, test } from "vitest";
import { cacheHigherRank, cacheNothingOutside, cacheRanksAbove, type CacheRank } from "../../core/src/generated/candidateCache.ts";
import { CandidateCache, type CacheEntry, type CacheKey, type CacheSearchResult, type CacheWorld } from "../src/match/cache.ts";

// A seeded population: a standing from 0 to 999 and eight tags per member. The pair value is
// symmetric and has no value outside a standing band or for gated pairs. Keys are drawn at random
// from a small key space, and a key that left can come back with a higher version, so a new member
// often has a lower key than an entry with the same value. A coarse world has values from 0 to 10,
// so many values are equal. An exact world bounds a group with the largest true value in the group,
// so a bound often equals a worst kept value; the exact bound costs no counted pair check.
const LIMIT = 5;
const RESERVE = 3;
const BAND = 250;
const GROUP_WIDTH = 50;
const KEY_SPACE = 2048;

interface Person { standing: number; tags: number; version: number }
interface WorldShape { readonly coarse: boolean; readonly exactBound: boolean }
const FINE: WorldShape = { coarse: false, exactBound: false };
const COARSE: WorldShape = { coarse: true, exactBound: false };
const COARSE_EXACT: WorldShape = { coarse: true, exactBound: true };

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const popcount = (bits: number): number => {
  let count = 0;
  for (let rest = bits; rest; rest &= rest - 1) count++;
  return count;
};

class Population implements CacheWorld {
  readonly limit = LIMIT;
  readonly reserve = RESERVE;
  readonly people = new Map<CacheKey, Person>();
  checks = 0;
  /** The last version of every key that ever joined, so that a key that comes back gets a higher version. */
  private readonly versions = new Map<CacheKey, number>();

  constructor(private readonly random: () => number, private readonly budget: number, private readonly shape: WorldShape) {}

  person(): Omit<Person, "version"> {
    return { standing: Math.floor(this.random() * 1000), tags: Math.floor(this.random() * 256) };
  }

  join(): CacheKey {
    let key: CacheKey;
    do key = Math.floor(this.random() * KEY_SPACE); while (this.people.has(key));
    this.add(key);
    return key;
  }

  /** A new profile under the same key with the next version. */
  edit(key: CacheKey): void {
    this.add(key);
  }

  private add(key: CacheKey): void {
    const version = (this.versions.get(key) ?? 0) + 1;
    this.versions.set(key, version);
    this.people.set(key, { ...this.person(), version });
  }

  /** The value without counting a check: the oracle's view. */
  truth(a: CacheKey, b: CacheKey): number {
    const pa = this.people.get(a)!;
    const pb = this.people.get(b)!;
    const gap = Math.abs(pa.standing - pb.standing);
    if (a === b || gap > BAND || (a + b) % 17 === 0) return -1;
    return this.closeness(gap) + this.tagWeight() * popcount(pa.tags & pb.tags);
  }

  value(a: CacheKey, b: CacheKey): number {
    this.checks++;
    return this.truth(a, b);
  }

  groupOf(key: CacheKey): number {
    return Math.floor(this.people.get(key)!.standing / GROUP_WIDTH);
  }

  private closeness(gap: number): number {
    return this.shape.coarse ? Math.floor((300 - gap) / 100) : 300 - gap;
  }

  private tagWeight(): number {
    return this.shape.coarse ? 1 : 40;
  }

  groupBound(group: number, x: CacheKey): number {
    if (this.shape.exactBound) {
      let top = -1;
      for (const b of this.people.keys()) if (b !== x && this.groupOf(b) === group) top = Math.max(top, this.truth(b, x));
      return top;
    }
    const px = this.people.get(x)!;
    const low = group * GROUP_WIDTH;
    const gap = Math.max(0, low - px.standing, px.standing - (low + GROUP_WIDTH - 1));
    return gap > BAND ? -1 : this.closeness(gap) + this.tagWeight() * popcount(px.tags);
  }

  version(key: CacheKey): number {
    return this.people.get(key)?.version ?? 0;
  }

  /** A search from nothing over groups in order of their bound, closed exact by the bound or budgeted by the check count. */
  search(key: CacheKey): CacheSearchResult {
    const byGroup = new Map<number, CacheKey[]>();
    for (const other of this.people.keys()) {
      if (other === key) continue;
      const g = this.groupOf(other);
      byGroup.set(g, [...(byGroup.get(g) ?? []), other]);
    }
    const order = [...byGroup.keys()]
      .map(g => ({ g, bound: this.groupBound(g, key) }))
      .filter(entry => entry.bound >= 0)
      .sort((x, y) => y.bound - x.bound || x.g - y.g);
    const stored: CacheEntry[] = [];
    let dropped = cacheNothingOutside;
    let checks = 0;
    let at = 0;
    let budgeted = false;
    const capacity = LIMIT + RESERVE;
    const rank = (entry: CacheEntry): CacheRank => ({ value: entry.value, key: entry.key });
    for (; at < order.length; at++) {
      const worst = stored.at(-1);
      if (stored.length === capacity && worst && !cacheRanksAbove({ value: order[at]!.bound, key: -1 }, rank(worst))) break;
      const members = byGroup.get(order[at]!.g)!;
      if (checks + members.length > this.budget) { budgeted = true; break; }
      for (const other of members) {
        checks++;
        const entry = { value: this.value(key, other), key: other, version: this.version(other) };
        if (entry.value < 0) continue;
        stored.push(entry);
        stored.sort((x, y) => y.value - x.value || x.key - y.key);
        if (stored.length > capacity) dropped = cacheHigherRank(dropped, rank(stored.pop()!));
      }
    }
    const remaining = order.slice(at).reduce((top, entry) => Math.max(top, entry.bound), -1);
    return {
      close: budgeted ? "Budgeted" : "Exact",
      stored,
      cover: cacheHigherRank(dropped, remaining < 0 ? cacheNothingOutside : { value: remaining, key: -1 }),
    };
  }

  /** The first `limit` partners of `a`, computed from nothing. */
  oracle(a: CacheKey): Array<[CacheKey, number]> {
    return [...this.people.keys()]
      .map(b => [b, this.truth(a, b)] as [CacheKey, number])
      .filter(([, value]) => value >= 0)
      .sort((x, y) => y[1] - x[1] || x[0] - y[0])
      .slice(0, LIMIT);
  }

  fullRecomputeChecks(): number {
    const before = this.checks;
    for (const key of this.people.keys()) this.search(key);
    const spent = this.checks - before;
    this.checks = before;
    return spent;
  }
}

type Event = "join" | "leave" | "change";

function churn(population: Population, cache: CandidateCache, random: () => number): Event {
  const keys = [...population.people.keys()];
  const pick = random();
  if (pick < 1 / 3 || keys.length < 20) {
    cache.insert(population.join());
    return "join";
  }
  const key = keys[Math.floor(random() * keys.length)]!;
  if (pick < 2 / 3) {
    cache.remove(key);
    population.people.delete(key);
    return "leave";
  }
  population.edit(key);
  cache.change(key);
  return "change";
}

/** Compares every cached list with the population from nothing, and returns the disagreements. */
function compareWithOracle(population: Population, cache: CandidateCache): { exact: number; budgeted: number; wrong: string[] } {
  let exact = 0;
  let budgeted = 0;
  const wrong: string[] = [];
  for (const a of population.people.keys()) {
    const list = cache.listOf(a);
    if (!list) {
      wrong.push(`${a}: no cached list`);
      continue;
    }
    for (const entry of [...list.kept, ...list.reserve]) {
      if (entry.value !== population.truth(a, entry.key) || entry.version !== population.version(entry.key)) {
        wrong.push(`${a}: stale edge to ${entry.key}`);
      }
    }
    if (list.close === "Exact") {
      exact++;
      const expected = JSON.stringify(population.oracle(a));
      const kept = JSON.stringify(list.kept.map(entry => [entry.key, entry.value]));
      if (kept !== expected) wrong.push(`${a}: kept ${kept}, a search from nothing keeps ${expected}`);
    } else budgeted++;
    // Every partner with a value outside the stored entries ranks at or below the reported bound.
    const stored = new Set([...list.kept, ...list.reserve].map(entry => entry.key));
    for (const b of population.people.keys()) {
      const value = population.truth(a, b);
      if (value >= 0 && !stored.has(b) && cacheRanksAbove({ value, key: b }, list.bound)) {
        wrong.push(`${a}: partner ${b} at ${value} ranks above the bound ${JSON.stringify(list.bound)}`);
      }
    }
  }
  return { exact, budgeted, wrong };
}

function seeded(seed: number, budget: number, size: number, shape: WorldShape): { population: Population; cache: CandidateCache; random: () => number } {
  const random = rng(seed);
  const population = new Population(random, budget, shape);
  for (let i = 0; i < size; i++) population.join();
  const cache = new CandidateCache(population);
  cache.rebuild([...population.people.keys()]);
  return { population, cache, random };
}

test.each([
  ["fine values and loose group bounds", FINE, 80_000],
  ["coarse values with many ties and loose group bounds", COARSE, 80_000],
  ["coarse values with many ties and exact group bounds", COARSE_EXACT, 80_000],
] as const)("every cached exact list equals a search from nothing after each join, leave and change: %s", (_name, shape, least) => {
  let checked = 0;
  for (const seed of [1, 2, 3]) {
    const { population, cache, random } = seeded(seed, Number.POSITIVE_INFINITY, 200, shape);
    for (let step = 0; step < 150; step++) {
      churn(population, cache, random);
      cache.refresh();
      const { exact, budgeted, wrong } = compareWithOracle(population, cache);
      expect(wrong).toEqual([]);
      expect(budgeted).toBe(0);
      checked += exact;
    }
    expect(cache.stats.groupSkips).toBeGreaterThan(0);
    expect(cache.stats.memberSkips).toBeGreaterThan(0);
    expect(cache.stats.refills).toBeGreaterThan(0);
  }
  expect(checked).toBeGreaterThan(least);
});

test.each([
  ["fine values", FINE],
  ["coarse values with exact group bounds", COARSE_EXACT],
] as const)("a budgeted cached list stays budgeted and keeps an honest bound through every change: %s", (_name, shape) => {
  for (const seed of [4, 5]) {
    const { population, cache, random } = seeded(seed, 40, 200, shape);
    let budgeted = 0;
    for (let step = 0; step < 150; step++) {
      churn(population, cache, random);
      cache.refresh();
      const result = compareWithOracle(population, cache);
      expect(result.wrong).toEqual([]);
      budgeted += result.budgeted;
    }
    expect(budgeted).toBeGreaterThan(0);
  }
});

test("repairing the cache costs far fewer pair checks than a full recompute at 1% and 10% churn", () => {
  const ratios: Record<string, number[]> = {};
  for (const seed of [11, 12, 13]) {
    for (const [label, share] of [["1%", 0.01], ["10%", 0.1]] as const) {
      const { population, cache, random } = seeded(seed, Number.POSITIVE_INFINITY, 300, FINE);
      for (let batch = 0; batch < 5; batch++) {
        const events = Math.round(share * population.people.size);
        const before = population.checks;
        for (let i = 0; i < events; i++) churn(population, cache, random);
        cache.refresh();
        const incremental = population.checks - before;
        const full = population.fullRecomputeChecks();
        (ratios[label] ??= []).push(incremental / full);
        expect(compareWithOracle(population, cache).wrong).toEqual([]);
      }
    }
  }
  const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const report = Object.fromEntries(Object.entries(ratios).map(([label, xs]) => [label, {
    mean: Number(mean(xs).toFixed(4)), max: Number(Math.max(...xs).toFixed(4)), batches: xs.length,
  }]));
  console.info(`candidate cache: incremental pair checks / full recompute ${JSON.stringify(report)}`);
  expect(mean(ratios["1%"]!)).toBeLessThan(0.05);
  expect(mean(ratios["10%"]!)).toBeLessThan(0.35);
});

test("a list with an edge whose version changed without a repair is refused and searched again", () => {
  const { population, cache } = seeded(7, Number.POSITIVE_INFINITY, 200, COARSE);
  const holder = [...population.people.keys()].find(a => (cache.listOf(a)?.kept.length ?? 0) > 0)!;
  const partner = cache.listOf(holder)!.kept[0]!.key;
  // The profile store changes the partner, and the cache is not told.
  population.edit(partner);
  expect(cache.listOf(holder)).toBeUndefined();
  cache.refresh();
  expect(cache.listOf(holder)!.kept.map(entry => [entry.key, entry.value])).toEqual(population.oracle(holder));
  // The repair that the profile store owes, then every list is correct again.
  cache.change(partner);
  cache.refresh();
  expect(compareWithOracle(population, cache).wrong).toEqual([]);
});
