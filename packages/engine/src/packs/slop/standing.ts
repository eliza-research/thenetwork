import type { City, MemberId } from "@thenetwork/core";
import { standingCeiling, standingUncertaintyCeiling } from "../../../../core/src/generated/matchLane.ts";
import {
  ratingUncertainty, standingMiddle, standingPercentile, standingPoolReady, standingReadable,
} from "../../../../core/src/generated/memberStanding.ts";
import {
  biasWindowMs, standingGapPredicts, standingOutcomeNegative, standingOutcomePositive,
} from "../../../../core/src/generated/weeklyBias.ts";
import type { EntityStanding } from "../../match/profile.ts";
import type { InteractionRecord } from "../../types.ts";
import type { World } from "../../world.ts";
import { ratingPermille } from "./appearance.ts";
import type { SlopPackOptions } from "./options.ts";
import { slopProfiles, type SlopProfile } from "./profile.ts";
import { SLOP_LANE } from "./rules.ts";

export interface DateStandingValidity { positives: number; negatives: number; concordantTwice: number; predicts: boolean }

export const UNKNOWN_DATE_STANDING: EntityStanding = { standing: standingMiddle, uncertainty: standingUncertaintyCeiling };

const poolKey = (market: City, p: SlopProfile): string => `${market}|${p.is ?? "unstated"}`;

function ratingOf(p: SlopProfile, o: SlopPackOptions): number | undefined {
  const r = p.appearance;
  return r && r.confidence >= o.appearance.minConfidence && standingReadable(p.adult, p.optedIn) ? ratingPermille(r.overall) : undefined;
}

function countBelow(sorted: readonly number[], x: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (sorted[mid]! < x) lo = mid + 1; else hi = mid; }
  return lo;
}

class RatingPool {
  constructor(readonly sorted: readonly number[], private readonly extra?: number) {}
  get rated(): number { return this.sorted.length + (this.extra === undefined ? 0 : 1); }
  private below(x: number): number { return countBelow(this.sorted, x) + (this.extra !== undefined && this.extra < x ? 1 : 0); }
  percentile(rating: number): number {
    const below = this.below(rating);
    return standingPercentile(below, this.below(rating + 1) - below, this.rated);
  }
  with(rating: number): RatingPool { return new RatingPool(this.sorted, rating); }
}

const EMPTY_POOL = new RatingPool([]);

export class DateStandings {
  private readonly pools = new Map<string, RatingPool>();
  private readonly profiles: ReadonlyMap<MemberId, SlopProfile>;
  readonly validity: DateStandingValidity;

  constructor(w: World, private readonly o: SlopPackOptions) {
    const profiles = this.profiles = slopProfiles(w.input, w.canonical);
    const lists = new Map<string, number[]>();
    for (const p of profiles.values()) {
      const rating = ratingOf(p, o);
      if (rating === undefined) continue;
      const key = poolKey(p.homeMarket, p);
      const list = lists.get(key) ?? [];
      list.push(rating);
      lists.set(key, list);
    }
    for (const [key, list] of lists) this.pools.set(key, new RatingPool(list.sort((a, b) => a - b)));
    this.validity = this.monitor(w.input.interactions ?? [], w.now, w.canonical);
  }

  private percentileIn(p: SlopProfile, market: City): { rating: number; pool: RatingPool } | undefined {
    const rating = ratingOf(p, this.o);
    if (rating === undefined) return undefined;
    const home = this.pools.get(poolKey(market, p));
    const pool = market === p.homeMarket && home ? home : (home ?? EMPTY_POOL).with(rating);
    return standingPoolReady(pool.rated) ? { rating, pool } : undefined;
  }

  standing(p: SlopProfile, market: City): EntityStanding {
    const placed = this.validity.predicts ? this.percentileIn(p, market) : undefined;
    if (!placed) return UNKNOWN_DATE_STANDING;
    const { rating, pool } = placed;
    const r = p.appearance!;
    const spread = r.spread === undefined ? { low: 0, high: standingCeiling }
      : { low: pool.percentile(ratingPermille(r.overall - r.spread)), high: pool.percentile(ratingPermille(r.overall + r.spread)) };
    return {
      standing: pool.percentile(rating),
      uncertainty: ratingUncertainty(r.photos ?? 0, spread.low, spread.high),
      evidenceIds: p.appearanceEvidenceIds,
    };
  }

  private monitor(interactions: readonly InteractionRecord[], now: number, canonical: (id: MemberId) => MemberId): DateStandingValidity {
    const outcomes = new Map<string, { positive: boolean; gap: number }>();
    for (const r of interactions) {
      const positive = standingOutcomePositive(r.outcome);
      if (!positive && !standingOutcomeNegative(r.outcome)) continue;
      if (r.category !== SLOP_LANE || r.participants.length !== 2 || r.at > now || r.at < now - biasWindowMs) continue;
      const id = r.id.split(":fb:")[0]!;
      if (outcomes.get(id)?.positive) continue;
      const [a, b] = r.participants.map(x => this.profiles.get(canonical(x)));
      const pa = a && this.percentileIn(a, a.homeMarket), pb = b && this.percentileIn(b, b.homeMarket);
      if (!pa || !pb) continue;
      outcomes.set(id, { positive, gap: Math.abs(pa.pool.percentile(pa.rating) - pb.pool.percentile(pb.rating)) });
    }
    const positive: number[] = [], negative: number[] = [];
    for (const x of outcomes.values()) (x.positive ? positive : negative).push(x.gap);
    negative.sort((x, y) => x - y);
    let concordantTwice = 0;
    for (const gap of positive) {
      const atOrBelow = countBelow(negative, gap + 1), below = countBelow(negative, gap);
      concordantTwice += 2 * (negative.length - atOrBelow) + (atOrBelow - below);
    }
    return { positives: positive.length, negatives: negative.length, concordantTwice, predicts: standingGapPredicts(positive.length, negative.length, concordantTwice) };
  }
}
