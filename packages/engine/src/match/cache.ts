// Cached member searches that a join, a leave or a profile change repairs without a new search for
// every member. Every decision comes from spec/candidateCache.md. The cache works over an abstract
// world (pair values, group bounds, versions and a search from nothing), so it does not depend on the
// index or the search code. Keys are stable canonical entity keys, never positions.
import {
  cacheEdgeValid, cacheEffectiveCover, cacheGroupMaySkip, cacheHigherRank, cacheLowerRank, cacheMemberMaySkip,
  cacheNothingOutside, cacheOfferPlace, cachePendingKeeps, cachePendingNeeded, cacheRemoveRepair, cacheRanksAbove,
  cacheReserveThreshold, type CacheRank,
} from "../../../core/src/generated/candidateCache.ts";

export type CacheKey = number;
export type CacheClose = "Exact" | "Budgeted";

/** One stored edge: the pair value, the partner's key, and the partner's profile version. */
export interface CacheEntry { readonly value: number; readonly key: CacheKey; readonly version: number }

/** A search from nothing: the best `limit + reserve` partners, best first, and the cover of the rest. */
export interface CacheSearchResult {
  readonly close: CacheClose;
  readonly stored: readonly CacheEntry[];
  /** Every partner with a pair value outside `stored` ranks at or below this rank. */
  readonly cover: CacheRank;
}

export interface CacheWorld {
  readonly limit: number;
  readonly reserve: number;
  /** The pair value of the searcher and the partner, or a negative value when there is no pair. One pair check. */
  value(searcher: CacheKey, partner: CacheKey): number;
  /** The group of a searcher. The reverse pass bounds a whole group at once. */
  groupOf(key: CacheKey): number;
  /** An upper bound on value(a, x) for every member a of the group, or a negative value when none can pair. */
  groupBound(group: number, x: CacheKey): number;
  /** The current profile version of a member. */
  version(key: CacheKey): number;
  search(key: CacheKey): CacheSearchResult;
}

export interface CachedList {
  readonly close: CacheClose;
  /** Best first. */
  readonly kept: readonly CacheEntry[];
  /** The next best after `kept`, best first. */
  readonly reserve: readonly CacheEntry[];
  /** The rank at or below which every partner outside the stored entries ranks (the reported bound). */
  readonly bound: CacheRank;
}

export interface CacheStats {
  searches: number; reverseChecks: number; groupSkips: number; memberSkips: number;
  refills: number; shorts: number; researches: number;
}

interface Cached {
  /** The searcher's group when it searched; a changed profile can move the member to another group. */
  readonly group: number;
  close: CacheClose;
  kept: CacheEntry[];
  reserve: CacheEntry[];
  cover: CacheRank;
  searchedVersion: number;
  searchedSeq: number;
}

interface Raise { readonly cover: CacheRank; readonly seq: number }

interface Group {
  readonly members: Set<CacheKey>;
  /** Members whose kept list is not full. */
  readonly short: Set<CacheKey>;
  /** At or below the worst kept entry of every full member (lawCacheLoweredFloorSkipSound). */
  floor: CacheRank;
  /** Raises from skipped insertions, older first, each ranking below the one before it. */
  raises: Raise[];
}

const rankOf = (entry: CacheEntry): CacheRank => ({ value: entry.value, key: entry.key });
const aboveEveryRank: CacheRank = { value: Number.MAX_SAFE_INTEGER, key: -1 };

function insertSorted(list: CacheEntry[], entry: CacheEntry): void {
  const at = list.findIndex(other => cacheRanksAbove(rankOf(entry), rankOf(other)));
  if (at < 0) list.push(entry);
  else list.splice(at, 0, entry);
}

export class CandidateCache {
  readonly stats: CacheStats = { searches: 0, reverseChecks: 0, groupSkips: 0, memberSkips: 0, refills: 0, shorts: 0, researches: 0 };
  private readonly lists = new Map<CacheKey, Cached>();
  private readonly keptBy = new Map<CacheKey, Set<CacheKey>>();
  private readonly groups = new Map<number, Group>();
  private readonly marked = new Set<CacheKey>();
  private seq = 0;

  constructor(private readonly world: CacheWorld) {}

  /** The weekly epoch: a search from nothing for every member, and fresh group summaries. */
  rebuild(keys: readonly CacheKey[]): void {
    for (const key of [...this.lists.keys()]) this.drop(key);
    this.groups.clear();
    this.marked.clear();
    for (const key of keys) this.searchFresh(key);
  }

  /** A member joins (or a new version enters): its own search, then the reverse pass. */
  // spec/candidateCache.md, "A group is untouched when its bound cannot rank above the lowest worst kept entry in the group"
  insert(x: CacheKey): void {
    for (const [g, group] of this.groups) {
      const members = [...group.members].filter(a => a !== x);
      if (!members.length) continue;
      const boundRank: CacheRank = { value: this.world.groupBound(g, x), key: x };
      if (cacheGroupMaySkip(group.short.size, group.floor, boundRank)) {
        this.stats.groupSkips++;
        if (cachePendingNeeded(boundRank)) {
          group.raises = group.raises.filter(raise => cachePendingKeeps(raise.cover, boundRank));
          group.raises.push({ cover: boundRank, seq: ++this.seq });
        }
        continue;
      }
      this.walkGroup(group, members, x, boundRank);
    }
    this.searchFresh(x);
  }

  /** A member leaves, pauses, is banned or held, gives a minor signal, or loses an eligible profile. */
  // spec/candidateCache.md, "Only a member whose stored list holds the removed member is affected"
  remove(x: CacheKey): void {
    for (const a of [...(this.keptBy.get(x) ?? [])]) this.repairAfterRemoval(a, x);
    this.keptBy.delete(x);
    this.drop(x);
    this.marked.delete(x);
  }

  /** spec/candidateCache.md, "A profile change is a removal and then an insertion with a new version" */
  change(x: CacheKey): void {
    this.remove(x);
    this.insert(x);
  }

  /** Searches again every member that a removal left without a correct list. */
  refresh(): void {
    for (const key of [...this.marked]) {
      this.marked.delete(key);
      this.stats.researches++;
      this.searchFresh(key);
    }
  }

  /**
   * The member's stored list, or undefined when the member must search again. A list with one stored
   * edge whose versions are not current is refused and the member is marked to search again, because
   * a version changed without a call to change().
   */
  // spec/candidateCache.md, "A stored edge is valid only when both profile versions match"
  listOf(a: CacheKey): CachedList | undefined {
    const cached = this.lists.get(a);
    if (!cached || this.marked.has(a)) return undefined;
    const searcherVersion = this.world.version(a);
    const valid = (entry: CacheEntry) =>
      cacheEdgeValid(cached.searchedVersion, searcherVersion, entry.version, this.world.version(entry.key));
    // The member's own profile counts as one more edge, so a list with no entries is refused too.
    const own: CacheEntry = { value: 0, key: a, version: searcherVersion };
    if (![own, ...cached.kept, ...cached.reserve].every(valid)) {
      this.marked.add(a);
      return undefined;
    }
    return { close: cached.close, kept: [...cached.kept], reserve: [...cached.reserve], bound: this.effectiveCover(a, cached) };
  }

  private walkGroup(group: Group, members: readonly CacheKey[], x: CacheKey, boundRank: CacheRank): void {
    let floor = aboveEveryRank;
    for (const a of members) {
      const cached = this.lists.get(a)!;
      const effective = this.effectiveCover(a, cached);
      const full = cached.kept.length >= this.world.limit;
      // spec/candidateCache.md, "A member is untouched when a bound on the new value cannot rank above its worst kept entry"
      if (cacheMemberMaySkip(full, this.kth(cached), boundRank)) {
        this.stats.memberSkips++;
        cached.cover = cacheHigherRank(effective, boundRank);
      } else {
        this.stats.reverseChecks++;
        const value = this.world.value(a, x);
        this.offer(a, cached, effective, { value, key: x, version: this.world.version(x) });
      }
      if (cached.kept.length >= this.world.limit) floor = cacheLowerRank(floor, this.kth(cached));
    }
    // Every member's own cover now holds the group's raises.
    group.floor = floor;
    group.raises = [];
  }

  // spec/candidateCache.md, "An offered candidate goes into the kept list, into the reserve, or outside"
  private offer(a: CacheKey, cached: Cached, effective: CacheRank, entry: CacheEntry): void {
    cached.cover = effective;
    const full = cached.kept.length >= this.world.limit;
    const kth = this.kth(cached);
    const reserveWorst = cached.reserve.at(-1);
    const threshold = cacheReserveThreshold(
      cached.reserve.length < this.world.reserve, reserveWorst ? rankOf(reserveWorst) : kth, effective);
    const place = cacheOfferPlace(full, kth, threshold, effective, rankOf(entry));
    switch (place) {
      case "CacheIntoKept": {
        insertSorted(cached.kept, entry);
        this.link(entry.key, a);
        const demoted = cached.kept.length > this.world.limit ? cached.kept.pop() : undefined;
        if (demoted) insertSorted(cached.reserve, demoted);
        this.trimReserve(a, cached);
        break;
      }
      case "CacheIntoReserve":
        insertSorted(cached.reserve, entry);
        this.link(entry.key, a);
        this.trimReserve(a, cached);
        break;
      case "CacheOutside":
        cached.cover = cacheHigherRank(effective, rankOf(entry));
        break;
      case "CacheNoPair":
        break;
      default: {
        const _exhaustive: never = place;
        return _exhaustive;
      }
    }
    this.noteList(a, cached);
  }

  private trimReserve(a: CacheKey, cached: Cached): void {
    while (cached.reserve.length > this.world.reserve) {
      const out = cached.reserve.pop()!;
      cached.cover = cacheHigherRank(cached.cover, rankOf(out));
      this.unlink(out.key, a);
    }
  }

  private repairAfterRemoval(a: CacheKey, x: CacheKey): void {
    const cached = this.lists.get(a);
    if (!cached) return;
    const inKept = cached.kept.some(entry => entry.key === x);
    const inReserve = cached.reserve.some(entry => entry.key === x);
    const effective = this.effectiveCover(a, cached);
    const best = cached.reserve[0];
    const repair = cacheRemoveRepair(inKept, inReserve, best !== undefined, best ? rankOf(best) : cacheNothingOutside, effective);
    switch (repair) {
      case "CacheRefill":
        this.stats.refills++;
        cached.kept = cached.kept.filter(entry => entry.key !== x);
        cached.kept.push(cached.reserve.shift()!);
        break;
      case "CacheShort":
        this.stats.shorts++;
        cached.kept = cached.kept.filter(entry => entry.key !== x);
        break;
      case "CacheDropReserve":
        cached.reserve = cached.reserve.filter(entry => entry.key !== x);
        break;
      case "CacheResearch":
        this.drop(a);
        this.marked.add(a);
        return;
      case "CacheUntouched":
        return;
      default: {
        const _exhaustive: never = repair;
        return _exhaustive;
      }
    }
    this.noteList(a, cached);
  }

  private searchFresh(key: CacheKey): void {
    this.drop(key);
    this.stats.searches++;
    const result = this.world.search(key);
    const limit = this.world.limit;
    const g = this.world.groupOf(key);
    const cached: Cached = {
      group: g,
      close: result.close,
      kept: result.stored.slice(0, limit),
      reserve: result.stored.slice(limit, limit + this.world.reserve),
      cover: result.cover,
      searchedVersion: this.world.version(key),
      searchedSeq: ++this.seq,
    };
    this.lists.set(key, cached);
    for (const entry of [...cached.kept, ...cached.reserve]) this.link(entry.key, key);
    if (!this.groups.has(g)) this.groups.set(g, { members: new Set(), short: new Set(), floor: aboveEveryRank, raises: [] });
    this.groups.get(g)!.members.add(key);
    this.noteList(key, cached);
  }

  /** Forgets a member's own list and its edges. */
  private drop(key: CacheKey): void {
    const cached = this.lists.get(key);
    if (!cached) return;
    for (const entry of [...cached.kept, ...cached.reserve]) this.unlink(entry.key, key);
    this.lists.delete(key);
    const group = this.groups.get(cached.group);
    group?.members.delete(key);
    group?.short.delete(key);
  }

  private noteList(a: CacheKey, cached: Cached): void {
    const group = this.groups.get(cached.group)!;
    if (cached.kept.length < this.world.limit) group.short.add(a);
    else {
      group.short.delete(a);
      group.floor = cacheLowerRank(group.floor, this.kth(cached));
    }
  }

  private kth(cached: Cached): CacheRank {
    const worst = cached.kept.at(-1);
    return worst ? rankOf(worst) : cacheNothingOutside;
  }

  private effectiveCover(a: CacheKey, cached: Cached): CacheRank {
    const raises = this.groups.get(cached.group)?.raises ?? [];
    return raises.reduce((cover, raise) => cacheEffectiveCover(cover, raise.cover, cached.searchedSeq, raise.seq), cached.cover);
  }

  private link(partner: CacheKey, searcher: CacheKey): void {
    let holders = this.keptBy.get(partner);
    if (!holders) this.keptBy.set(partner, holders = new Set());
    holders.add(searcher);
  }

  private unlink(partner: CacheKey, searcher: CacheKey): void {
    this.keptBy.get(partner)?.delete(searcher);
  }
}
