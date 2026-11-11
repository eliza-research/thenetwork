// The Observatory client's sync decisions: load, delta, app switch, feed merge, map markers, the
// reveal badge and the role check. Import-free, proved by LemmaScript (docs/formal-verification.md).
// web/store.ts and web/map.ts call these functions. They do the fetch, the socket and the drawing.
// The proofs model `number` as an integer: the shell drops a non-integer version or seq first.

/** The sync state of one browser tab. */
export interface SyncState {
  /** The app that every panel shows. */
  app: string;
  /** The newest load. An answer of any other load is stale. */
  gen: number;
  /** A load runs, so deltas wait in the buffer. */
  buffering: boolean;
  /** The app whose data is on screen. "" when there is none. */
  dataApp: string;
  version: number;
  /** The newest load landed. False after a switch or a failed load: the version says nothing then. */
  synced: boolean;
}

export type SyncEvent =
  | { kind: "switch"; app: string }
  | { kind: "begin" }
  | { kind: "land"; gen: number; app: string; version: number }
  | { kind: "fail"; gen: number }
  | { kind: "delta"; version: number; reset: boolean };

/**
 * What the shell does with one delta. "data": all of it. "meta": clock, game and network only (the
 * server sends those with an unchanged version, and a state at V already holds delta V).
 */
export type DeltaMove = "buffer" | "reload" | "drop" | "meta" | "data";

export interface Delta { version: number; reset: boolean }

export function initialSync(app: string): SyncState {
  //@ verify
  //@ ensures good(\result)
  return { app, gen: 0, buffering: false, dataApp: "", version: 0, synced: false };
}

/** Nothing on screen belongs to another app, and a synced tab holds the data of its app. */
function good(s: SyncState): boolean {
  //@ verify
  return (s.dataApp === "" || s.dataApp === s.app) && (!s.synced || s.dataApp === s.app);
}

/** This load is still the newest one. */
export function owns(s: SyncState, gen: number): boolean {
  //@ verify
  return gen === s.gen;
}

/** The state of this load may replace what is on screen. */
export function admits(s: SyncState, gen: number, app: string): boolean {
  //@ verify
  return owns(s, gen) && app === s.app && s.buffering;
}

export function deltaMove(s: SyncState, version: number, reset: boolean): DeltaMove {
  //@ verify
  //@ requires good(s)
  //@ ensures reset ==> \result === "reload"
  //@ ensures !reset && s.buffering ==> \result === "buffer"
  //@ ensures !reset && !s.buffering && !s.synced ==> \result === "reload"
  //@ ensures (\result === "meta" || \result === "data") ==> s.synced && !s.buffering && !reset && s.dataApp === s.app
  //@ ensures \result === "data" ==> version === s.version + 1
  //@ ensures \result === "meta" ==> version === s.version
  //@ ensures s.synced && !s.buffering && !reset && version === s.version ==> \result === "meta"
  //@ ensures s.synced && !s.buffering && !reset && version === s.version + 1 ==> \result === "data"
  //@ ensures s.synced && !s.buffering && !reset && version < s.version ==> \result === "drop"
  //@ ensures s.synced && !s.buffering && !reset && version > s.version + 1 ==> \result === "reload"
  if (reset) return "reload";
  if (s.buffering) return "buffer";
  if (!s.synced) return "reload";
  if (version < s.version) return "drop";
  if (version === s.version) return "meta";
  if (version > s.version + 1) return "reload";
  return "data";
}

export function step(s: SyncState, e: SyncEvent): SyncState {
  //@ verify
  //@ requires good(s)
  //@ ensures good(\result)
  //@ ensures \result.gen >= s.gen
  //@ ensures e.kind === "land" && !admits(s, e.gen, e.app) ==> \result === s
  //@ ensures e.kind === "fail" && !owns(s, e.gen) ==> \result === s
  //@ ensures e.kind === "fail" && owns(s, e.gen) ==> !\result.buffering && !\result.synced
  //@ ensures e.kind === "switch" && e.app !== s.app ==> \result.app === e.app && \result.gen > s.gen && \result.dataApp === "" && !\result.synced && !\result.buffering
  //@ ensures e.kind === "switch" && e.app === s.app ==> \result === s
  //@ ensures e.kind === "begin" ==> \result.gen > s.gen && \result.buffering && \result.app === s.app
  //@ ensures e.kind === "land" && admits(s, e.gen, e.app) ==> \result.synced && !\result.buffering && \result.dataApp === e.app && \result.version === e.version
  //@ ensures e.kind === "delta" ==> \result.gen === s.gen && \result.version >= s.version && \result.dataApp === s.dataApp
  //@ ensures e.kind === "delta" && deltaMove(s, e.version, e.reset) === "data" ==> \result.version === e.version
  //@ ensures e.kind === "delta" && deltaMove(s, e.version, e.reset) !== "data" ==> \result === s
  //@ ensures \result.version < s.version ==> e.kind === "switch" || (e.kind === "land" && e.gen === s.gen)
  //@ ensures \result.dataApp !== s.dataApp ==> e.kind === "switch" || (e.kind === "land" && e.gen === s.gen)
  switch (e.kind) {
    case "switch":
      return e.app === s.app ? s : { app: e.app, gen: s.gen + 1, buffering: false, dataApp: "", version: 0, synced: false };
    case "begin":
      return { ...s, gen: s.gen + 1, buffering: true };
    case "land":
      return admits(s, e.gen, e.app) ? { ...s, buffering: false, dataApp: e.app, version: e.version, synced: true } : s;
    case "fail":
      return owns(s, e.gen) ? { ...s, buffering: false, synced: false } : s;
    case "delta":
      return deltaMove(s, e.version, e.reset) === "data" ? { ...s, version: e.version } : s;
  }
}

/** A load that nothing overtakes lands: the tab is synced at the state's version, and the next delta is data. */
function loadLands(s: SyncState, version: number): SyncState {
  //@ verify
  //@ requires good(s)
  //@ ensures \result.synced && !\result.buffering && \result.dataApp === s.app && \result.version === version
  //@ ensures deltaMove(\result, version + 1, false) === "data"
  const b = step(s, { kind: "begin" });
  return step(b, { kind: "land", gen: b.gen, app: b.app, version });
}

/** Two loads overlap: the answer of the older load changes nothing, and the newer load still lands. */
function newerLoadWins(s: SyncState, older: number, newer: number): SyncState {
  //@ verify
  //@ requires good(s)
  //@ ensures \result.synced && !\result.buffering && \result.version === newer
  const a = step(s, { kind: "begin" });
  const b = step(a, { kind: "begin" });
  const c = step(b, { kind: "land", gen: a.gen, app: a.app, version: older });
  return step(c, { kind: "land", gen: b.gen, app: b.app, version: newer });
}

/** Any order of switches, loads, answers and deltas: nothing on screen belongs to another app. */
function run(s: SyncState, es: SyncEvent[]): SyncState {
  //@ verify
  //@ requires good(s)
  //@ ensures good(\result)
  //@ ensures \result.gen >= s.gen
  let c = s;
  for (let i = 0; i < es.length; i++) {
    //@ invariant 0 <= i && i <= es.length
    //@ invariant good(c) && c.gen >= s.gen
    //@ decreases es.length - i
    c = step(c, es[i]);
  }
  return c;
}

/**
 * Any delivery order of deltas, with repeats and rewinds: the versions applied as data are exactly
 * the next ones. So no version is applied twice, and the version never falls.
 */
function appliedVersions(s: SyncState, ds: Delta[]): number[] {
  //@ verify
  //@ requires good(s)
  //@ ensures forall(i: nat, i < \result.length ==> \result[i] === s.version + 1 + i)
  let c = s;
  let out: number[] = [];
  for (let i = 0; i < ds.length; i++) {
    //@ invariant 0 <= i && i <= ds.length
    //@ invariant good(c) && c.version === s.version + out.length
    //@ invariant forall(j: nat, j < out.length ==> out[j] === s.version + 1 + j)
    //@ decreases ds.length - i
    if (deltaMove(c, ds[i].version, ds[i].reset) === "data") out = [...out, ds[i].version];
    c = step(c, { kind: "delta", version: ds[i].version, reset: ds[i].reset });
  }
  return out;
}

export interface Sequenced { seq: number }

/**
 * Adds the items that are newer than the feed. A state at V holds delta V and can hold part of
 * delta V+1, so a version check is not enough: the merge compares seq.
 */
export function appendNew<T extends Sequenced>(feed: T[], items: T[]): T[] {
  //@ verify
  //@ requires forall(i: nat, forall(j: nat, i < j && j < feed.length ==> feed[i].seq < feed[j].seq))
  //@ requires forall(i: nat, forall(j: nat, i < j && j < items.length ==> items[i].seq < items[j].seq))
  //@ ensures forall(i: nat, forall(j: nat, i < j && j < \result.length ==> \result[i].seq < \result[j].seq))
  //@ ensures feed.length <= \result.length
  //@ ensures forall(j: nat, j < feed.length ==> \result[j] === feed[j])
  //@ ensures forall(k: nat, k < items.length && (feed.length === 0 || items[k].seq > feed[feed.length - 1].seq) ==> \result.includes(items[k]))
  let out = feed;
  for (let k = 0; k < items.length; k++) {
    //@ invariant 0 <= k && k <= items.length
    //@ invariant feed.length <= out.length
    //@ invariant forall(i: nat, forall(j: nat, i < j && j < out.length ==> out[i].seq < out[j].seq))
    //@ invariant forall(j: nat, j < feed.length ==> out[j] === feed[j])
    //@ invariant forall(q: nat, q < k && (feed.length === 0 || items[q].seq > feed[feed.length - 1].seq) ==> out.includes(items[q]))
    //@ invariant out.length > feed.length ==> k > 0 && out[out.length - 1].seq <= items[k - 1].seq
    //@ decreases items.length - k
    if (out.length === 0 || items[k].seq > out[out.length - 1].seq) out = [...out, items[k]];
  }
  return out;
}

/** The markers after a sync are exactly the shown members. isShown and had are shown and have as sets. */
export function markersAfter(have: string[], shown: string[], isShown: Set<string>, had: Set<string>): string[] {
  //@ verify
  //@ requires forall(k: string, isShown.has(k) === shown.includes(k))
  //@ requires forall(k: string, had.has(k) === have.includes(k))
  //@ ensures forall(i: nat, i < \result.length ==> shown.includes(\result[i]))
  //@ ensures forall(i: nat, i < shown.length ==> \result.includes(shown[i]))
  let out: string[] = [];
  for (let i = 0; i < have.length; i++) {
    //@ invariant 0 <= i && i <= have.length
    //@ invariant forall(j: nat, j < out.length ==> shown.includes(out[j]))
    //@ invariant forall(j: nat, j < i && isShown.has(have[j]) ==> out.includes(have[j]))
    //@ decreases have.length - i
    if (isShown.has(have[i])) out = [...out, have[i]];
  }
  for (let i = 0; i < shown.length; i++) {
    //@ invariant 0 <= i && i <= shown.length
    //@ invariant forall(j: nat, j < out.length ==> shown.includes(out[j]))
    //@ invariant forall(j: nat, j < have.length && isShown.has(have[j]) ==> out.includes(have[j]))
    //@ invariant forall(j: nat, j < i ==> out.includes(shown[j]))
    //@ decreases shown.length - i
    if (!had.has(shown[i])) out = [...out, shown[i]];
  }
  return out;
}

/** One member's reveal: the server keeps the grant, the page shows the badge. */
export interface RevealState { server: boolean; badge: boolean }

/** A model of DELETE /api/reveal in src/server.ts: only 200 and 404 leave no grant. Status 0: the request failed. */
function serverEnded(status: number): boolean {
  //@ verify
  return status === 200 || status === 404;
}

/** The client's rule: the badge goes only on an answer that shows that no grant is left. */
function badgeEnds(status: number): boolean {
  //@ verify
  //@ ensures \result ==> serverEnded(status)
  //@ ensures serverEnded(status) ==> \result
  return status === 200 || status === 404;
}

export function unrevealStep(s: RevealState, status: number): RevealState {
  //@ verify
  //@ requires s.server ==> s.badge
  //@ ensures \result.server ==> \result.badge
  //@ ensures \result.badge ==> s.badge
  //@ ensures status === 200 ==> !\result.badge && !\result.server
  return { server: serverEnded(status) ? false : s.server, badge: badgeEnds(status) ? false : s.badge };
}

/** Any run of DELETE answers: the badge stays on while the server still serves the PII. */
function unrevealRun(s: RevealState, statuses: number[]): RevealState {
  //@ verify
  //@ requires s.server ==> s.badge
  //@ ensures \result.server ==> \result.badge
  let c = s;
  for (let i = 0; i < statuses.length; i++) {
    //@ invariant 0 <= i && i <= statuses.length
    //@ invariant c.server ==> c.badge
    //@ decreases statuses.length - i
    c = unrevealStep(c, statuses[i]);
  }
  return c;
}

/**
 * The rule of loadReveals in web/store.ts: a GET /api/reveal answer replaces the list only when it
 * came (ok), and no reveal or end got its answer after the GET was sent (the reveal generation is
 * the same). A failed answer, or an answer older than a local change, keeps the current list.
 */
export function revealMerge(gen: number, sentGen: number, ok: boolean): boolean {
  //@ verify
  //@ ensures \result === (ok && sentGen === gen)
  return ok && sentGen === gen;
}

/**
 * The second rule of loadReveals: a GET answer that came but is older than a reveal or end answer
 * is not applied, and the list is read again. The old answer can hold the grants of other members.
 */
export function revealReread(gen: number, sentGen: number, ok: boolean): boolean {
  //@ verify
  //@ ensures \result === (ok && sentGen !== gen)
  return ok && sentGen !== gen;
}

/** One GET /api/reveal: the reveal generation when it was sent, and the grant of the server then. */
export interface RevealRead { gen: number; server: boolean }

/**
 * The reveal badge of one member on the page, against the server grant. known: the list is loaded,
 * and no reveal answer was lost after it. gen: the count of POST and DELETE answers (store.ts revealGen).
 */
export interface RevealPage { server: boolean; badge: boolean; known: boolean; gen: number; reads: RevealRead[] }

/**
 * One event of the page. granted, lost, refused: the POST answer (lost: no answer, so the server can
 * hold the grant). ended: the DELETE answer (acted: with status 0, the server ended the grant).
 * expire: the grant time ends on both sides. send: a GET is sent. answer: GET number i answers; the
 * server read the grant at the send (atSend) or later, and no POST or DELETE answer came between.
 * other: a POST or DELETE answer for another member.
 */
export type RevealEvent =
  | { kind: "granted" }
  | { kind: "lost" }
  | { kind: "refused" }
  | { kind: "ended"; status: number; acted: boolean }
  | { kind: "expire" }
  | { kind: "send" }
  | { kind: "answer"; i: number; ok: boolean; atSend: boolean }
  | { kind: "other" };

/** While the server holds the grant and the list is known, the badge shows. Each open GET knows the grant of its generation. */
function revealGood(s: RevealPage): boolean {
  //@ verify
  return (s.known && s.server ? s.badge : true)
    && s.reads.every(r => r.gen <= s.gen && (r.gen === s.gen && s.server ? r.server : true));
}

export function revealStep(s: RevealPage, e: RevealEvent): RevealPage {
  //@ verify
  //@ requires revealGood(s)
  //@ ensures revealGood(\result)
  //@ ensures e.kind === "lost" ==> \result.server && !\result.known
  //@ ensures e.kind === "answer" && !e.ok ==> \result.badge === s.badge && \result.known === s.known
  //@ ensures e.kind === "answer" && e.ok && 0 <= e.i && e.i < s.reads.length && s.reads[e.i].gen !== s.gen ==> \result.reads.length === s.reads.length + 1 && \result.reads[s.reads.length].gen === \result.gen
  switch (e.kind) {
    case "granted":
      return { ...s, server: true, badge: true, known: true, gen: s.gen + 1 };
    case "lost":
      return { ...s, server: true, known: false, gen: s.gen + 1 };
    case "refused":
      return { ...s, gen: s.gen + 1 };
    case "ended":
      return { ...s, server: serverEnded(e.status) || (e.status === 0 && e.acted) ? false : s.server, badge: badgeEnds(e.status) ? false : s.badge, gen: s.gen + 1 };
    case "expire":
      return { ...s, server: false, badge: false };
    case "send":
      return { ...s, reads: [...s.reads, { gen: s.gen, server: s.server }] };
    case "answer": {
      if (e.i < 0 || e.i >= s.reads.length) return s;
      const r = s.reads[e.i];
      if (revealReread(s.gen, r.gen, e.ok)) return { ...s, reads: [...s.reads, { gen: s.gen, server: s.server }] };
      if (!revealMerge(s.gen, r.gen, e.ok)) return s;
      return { ...s, badge: e.atSend ? r.server : s.server, known: true };
    }
    case "other":
      return { ...s, gen: s.gen + 1 };
  }
}

/** Any order of reveals, ends, expiries, GETs and their answers: the badge stays on while the server holds the grant and the list is known. */
function revealRun(s: RevealPage, es: RevealEvent[]): RevealPage {
  //@ verify
  //@ requires revealGood(s)
  //@ ensures revealGood(\result)
  //@ ensures \result.known && \result.server ==> \result.badge
  let c = s;
  for (let i = 0; i < es.length; i++) {
    //@ invariant 0 <= i && i <= es.length
    //@ invariant revealGood(c)
    //@ decreases es.length - i
    c = revealStep(c, es[i]);
  }
  return c;
}

export interface Grant { role: string; app: string }

/** A grant counts for this app and mode. */
function counts(g: Grant, app: string, real: boolean): boolean {
  //@ verify
  return (g.app === "*" || g.app === app) && g.role !== "cross_app_safety" && !(g.role === "engineer" && real);
}

/** One grant of rolesFor in packages/observatory/src/staff.ts, in its form: the two `continue` tests. */
function serverSkips(g: Grant, app: string, real: boolean): boolean {
  //@ verify
  return (g.app !== "*" && g.app !== app) || g.role === "cross_app_safety" || (g.role === "engineer" && real);
}

function serverHolds(grants: Grant[], app: string, real: boolean, role: string): boolean {
  //@ verify
  return grants.some(g => !serverSkips(g, app, real) && g.role === role);
}

/** The client's roles for one app: a role is here exactly when the server rule holds it. */
export function clientRoles(grants: Grant[], app: string, real: boolean): string[] {
  //@ verify
  //@ ensures forall(r: string, \result.includes(r) === serverHolds(grants, app, real, r))
  let out: string[] = [];
  for (let i = 0; i < grants.length; i++) {
    //@ invariant 0 <= i && i <= grants.length
    //@ invariant forall(r: string, out.includes(r) === serverHolds(grants.slice(0, i), app, real, r))
    //@ decreases grants.length - i
    if (counts(grants[i], app, real)) out = [...out, grants[i].role];
  }
  return out;
}
