// The Observatory's global filters: which filter applies to which drawer tab, and what a filter
// hides. Import-free, proved by LemmaScript (docs/formal-verification.md). web/store.ts resolves
// members and opportunities into a FilterRow and calls these functions. The filter bar dims a
// filter by APPLIES, and the proofs here show that a dimmed filter cannot change a tab.

export type FilterKey = "range" | "borough" | "members" | "origin" | "stateGroup";
export type FilterTab = "review" | "feed" | "pipeline" | "requests" | "engine" | "safety" | "metrics" | "lab" | "config" | "game";

/** Which global filters apply to each drawer tab (the filter bar dims the others). */
export function tabKeys(tab: FilterTab): FilterKey[] {
  //@ verify
  switch (tab) {
    case "review": return ["borough", "members", "origin"];
    case "feed": return ["range", "borough", "members", "origin"];
    case "pipeline": return ["range", "borough", "members", "origin", "stateGroup"];
    case "engine": return ["range"];
    case "safety": return ["range", "borough", "members"];
    case "metrics": return ["range", "borough", "origin"];
    case "requests": return ["range", "borough", "members"];
    case "lab": return [];
    case "config": return [];
    case "game": return [];
  }
}

/** tabKeys as a table, for the filter bar. */
//@ skip
export const APPLIES: Record<FilterTab, FilterKey[]> = {
  review: tabKeys("review"), feed: tabKeys("feed"), pipeline: tabKeys("pipeline"), engine: tabKeys("engine"), safety: tabKeys("safety"),
  metrics: tabKeys("metrics"), requests: tabKeys("requests"), lab: tabKeys("lab"), config: tabKeys("config"), game: tabKeys("game"),
};

/** The filters, resolved. "all" turns a filter off. `since` counts only when allTime is false. */
export interface FilterView { allTime: boolean; since: number; borough: string; members: string; origin: string; stateGroup: string }

/** One feed item or opportunity, resolved by the store. It does not depend on the filters. */
export interface FilterRow {
  t: number;
  /** The range filter does not hide this row (an open opportunity). */
  timeless: boolean;
  boroughs: string[];
  /** For each member, the member filters it passes ("active", "watch", ...). */
  tags: string[];
  origin: string | undefined;
  group: string;
}

function has(keys: FilterKey[], key: FilterKey): boolean {
  //@ verify
  return keys.includes(key);
}

export function rangeOk(t: number, timeless: boolean, f: FilterView): boolean {
  //@ verify
  //@ ensures t >= f.since ==> \result
  //@ ensures !f.allTime && !timeless && t < f.since ==> !\result
  return f.allTime || timeless || t >= f.since;
}

export function boroughOk(boroughs: string[], borough: string): boolean {
  //@ verify
  //@ ensures boroughs.includes(borough) ==> \result
  //@ ensures borough !== "all" && !boroughs.includes(borough) ==> !\result
  return borough === "all" || boroughs.includes(borough);
}

export function membersOk(tags: string[], members: string): boolean {
  //@ verify
  //@ ensures tags.includes(members) ==> \result
  //@ ensures members !== "all" && !tags.includes(members) ==> !\result
  return members === "all" || tags.includes(members);
}

export function passes(keys: FilterKey[], x: FilterRow, f: FilterView): boolean {
  //@ verify
  // A filter that applies hides the rows that do not meet it.
  //@ ensures has(keys, "range") && !rangeOk(x.t, x.timeless, f) ==> !\result
  //@ ensures has(keys, "borough") && !boroughOk(x.boroughs, f.borough) ==> !\result
  //@ ensures has(keys, "members") && !membersOk(x.tags, f.members) ==> !\result
  //@ ensures has(keys, "origin") && f.origin !== "all" && x.origin !== f.origin ==> !\result
  //@ ensures has(keys, "stateGroup") && f.stateGroup !== "all" && x.group !== f.stateGroup ==> !\result
  // A row that meets every filter is shown.
  //@ ensures rangeOk(x.t, x.timeless, f) && boroughOk(x.boroughs, f.borough) && membersOk(x.tags, f.members) && (f.origin === "all" || x.origin === f.origin) && (f.stateGroup === "all" || x.group === f.stateGroup) ==> \result
  return (!has(keys, "range") || rangeOk(x.t, x.timeless, f))
    && (!has(keys, "borough") || boroughOk(x.boroughs, f.borough))
    && (!has(keys, "members") || membersOk(x.tags, f.members))
    && (!has(keys, "origin") || f.origin === "all" || x.origin === f.origin)
    && (!has(keys, "stateGroup") || f.stateGroup === "all" || x.group === f.stateGroup);
}

export function visible(tab: FilterTab, x: FilterRow, f: FilterView): boolean {
  //@ verify
  return passes(tabKeys(tab), x, f);
}

/** f and g are the same on these keys. */
function agree(keys: FilterKey[], f: FilterView, g: FilterView): boolean {
  //@ verify
  return (!has(keys, "range") || (f.allTime === g.allTime && f.since === g.since))
    && (!has(keys, "borough") || f.borough === g.borough)
    && (!has(keys, "members") || f.members === g.members)
    && (!has(keys, "origin") || f.origin === g.origin)
    && (!has(keys, "stateGroup") || f.stateGroup === g.stateGroup);
}

/** A filter outside these keys cannot change the result, for any row. */
function nonInterference(keys: FilterKey[], x: FilterRow, f: FilterView, g: FilterView): boolean {
  //@ verify
  //@ requires agree(keys, f, g)
  //@ ensures \result
  return passes(keys, x, f) === passes(keys, x, g);
}

/** The same for one tab: a filter that the bar dims cannot change what the tab shows. */
function tabNonInterference(tab: FilterTab, x: FilterRow, f: FilterView, g: FilterView): boolean {
  //@ verify
  //@ requires agree(tabKeys(tab), f, g)
  //@ ensures \result
  return visible(tab, x, f) === visible(tab, x, g);
}

/** Every filter at "all" hides nothing, on any tab. */
function allHidesNothing(tab: FilterTab, x: FilterRow): boolean {
  //@ verify
  //@ ensures \result
  const f: FilterView = { allTime: true, since: 0, borough: "all", members: "all", origin: "all", stateGroup: "all" };
  return visible(tab, x, f);
}

/** The Origin filter cannot hide a Safety event (the bar says that it does not apply). */
function safetyIgnoresOrigin(x: FilterRow, f: FilterView, origin: string): boolean {
  //@ verify
  //@ ensures \result
  const g: FilterView = { ...f, origin };
  return visible("safety", x, f) === visible("safety", x, g);
}

/** No range hides a Review item, pending or decided. */
function reviewIgnoresRange(x: FilterRow, f: FilterView, allTime: boolean, since: number): boolean {
  //@ verify
  //@ ensures \result
  const g: FilterView = { ...f, allTime, since };
  return visible("review", x, f) === visible("review", x, g);
}
