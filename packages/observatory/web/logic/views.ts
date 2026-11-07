// The Observatory views' decisions: who may see a loaded photo, which detail read may land, the
// booked plan state, the everyone-yes counts, the rate, the shown tab, the duration parts and the
// propose gate. Import-free, proved by LemmaScript (docs/formal-verification.md). web/panels.tsx,
// web/drawer.tsx, web/main.tsx and web/ui.tsx call these functions. They do the hooks and the drawing.
// The proofs model `number` as an integer: the shell passes only whole values that are not negative.

// ---- photos
export type PhotoRule = "never_minor" | "needs_verification" | "reason_required";
export type PhotoView = "hide" | "form" | "gallery";

/** What the panel knows now. `minor` is the live store flag: it can be newer than `rule`, which is a detail read. */
export interface PhotoGate { rule: PhotoRule; canSafety: boolean; minor: boolean }

function photoAllowed(g: PhotoGate): boolean {
  //@ verify
  return g.rule === "reason_required" && g.canSafety && !g.minor;
}

/** What the panel shows. Adults only, for staff who hold the role, and nothing else. */
export function photoView(g: PhotoGate, loaded: boolean): PhotoView {
  //@ verify
  //@ ensures g.minor ==> \result === "hide"
  //@ ensures \result === "gallery" ==> photoAllowed(g) && loaded
  //@ ensures \result === "form" ==> photoAllowed(g) && !loaded
  //@ ensures photoAllowed(g) ==> \result !== "hide"
  if (!photoAllowed(g)) return "hide";
  return loaded ? "gallery" : "form";
}

/** Whether the panel may keep loaded photos. A refusal drops them, so a later allowed rule shows the form. */
export function photoHeld(g: PhotoGate, loaded: boolean): boolean {
  //@ verify
  //@ ensures \result ==> loaded && photoView(g, loaded) === "gallery"
  //@ ensures loaded && photoView(g, loaded) === "gallery" ==> \result
  return loaded && photoAllowed(g);
}

/** Across any run of gates, photos are still held at the end only if every gate allowed them. */
function photoTrail(gates: PhotoGate[], loaded: boolean): boolean {
  //@ verify
  //@ ensures \result ==> forall(i: nat, i < gates.length ==> photoAllowed(gates[i]))
  let held = loaded;
  for (let i = 0; i < gates.length; i++) {
    //@ invariant 0 <= i && i <= gates.length
    //@ invariant held ==> forall(j: nat, j < i ==> photoAllowed(gates[j]))
    //@ decreases gates.length - i
    held = photoHeld(gates[i], held);
  }
  return held;
}

// ---- detail reads
/** Reads are numbered in start order. `last` is the newest number. No read at or below `closed` can land. */
export interface ReadGate { last: number; closed: number }
export interface ReadLand { gate: ReadGate; show: boolean }
export type ReadEvent = { kind: "start" } | { kind: "cancel" } | { kind: "land"; ticket: number };

function readOk(g: ReadGate): boolean {
  //@ verify
  return 0 <= g.closed && g.closed <= g.last;
}

export function readNew(): ReadGate {
  //@ verify
  //@ ensures readOk(\result)
  return { last: 0, closed: 0 };
}

function canLand(g: ReadGate, ticket: number): boolean {
  //@ verify
  return g.closed < ticket && ticket <= g.last;
}

/** One more read starts. Its number is the new `last`, and it can land. */
export function readStart(g: ReadGate): ReadGate {
  //@ verify
  //@ requires readOk(g)
  //@ ensures readOk(\result)
  //@ ensures \result.last === g.last + 1 && \result.closed === g.closed
  //@ ensures canLand(\result, \result.last)
  return { last: g.last + 1, closed: g.closed };
}

/** What the view shows changed: no read that already started can land. */
export function readCancel(g: ReadGate): ReadGate {
  //@ verify
  //@ requires readOk(g)
  //@ ensures readOk(\result)
  //@ ensures \result.last === g.last && \result.closed >= g.closed
  //@ ensures forall(t: int, t <= g.last ==> !canLand(\result, t))
  return { last: g.last, closed: g.last };
}

/** A read answered. It shows only if it can land, and then it closes every older read. */
export function readLand(g: ReadGate, ticket: number): ReadLand {
  //@ verify
  //@ requires readOk(g)
  //@ ensures readOk(\result.gate)
  //@ ensures \result.show === canLand(g, ticket)
  //@ ensures \result.gate.last === g.last && \result.gate.closed >= g.closed
  //@ ensures \result.show ==> forall(t: int, t <= ticket ==> !canLand(\result.gate, t))
  if (canLand(g, ticket)) return { gate: { last: g.last, closed: ticket }, show: true };
  return { gate: g, show: false };
}

/** After a read lands, an older read does not. */
function olderLoses(g: ReadGate, older: number, newer: number): boolean {
  //@ verify
  //@ requires readOk(g)
  //@ requires older < newer
  //@ requires canLand(g, newer)
  //@ ensures \result
  return !readLand(readLand(g, newer).gate, older).show;
}

/** For any order of starts, cancels and answers, the read numbers that show rise strictly. */
function shownRise(events: ReadEvent[]): boolean {
  //@ verify
  //@ ensures \result
  let g = readNew();
  let top = 0;
  for (let i = 0; i < events.length; i++) {
    //@ invariant 0 <= i && i <= events.length
    //@ invariant readOk(g) && top <= g.closed
    //@ decreases events.length - i
    const e = events[i];
    if (e.kind === "start") g = readStart(g);
    else if (e.kind === "cancel") g = readCancel(g);
    else {
      const r = readLand(g, e.ticket);
      if (r.show) {
        if (e.ticket <= top) return false;
        top = e.ticket;
      }
      g = r.gate;
    }
  }
  return true;
}

// ---- booked plan
export type PlanView = "called_off" | "not_told" | "open" | "confirmed";

/** The opt-out window closes after `hours`, or at the meeting if that is sooner. */
export function planCloses(told: number, hours: number, at: number): number {
  //@ verify
  //@ ensures \result <= at && \result <= told + hours * 3600000
  //@ ensures \result === at || \result === told + hours * 3600000
  return Math.min(told + hours * 3600000, at);
}

/** One member's state on a booked plan. A cancellation wins, and silence confirms only after the window. */
export function planView(off: boolean, told: number | undefined, hours: number, at: number, now: number): PlanView {
  //@ verify
  //@ requires hours >= 0
  //@ ensures off ==> \result === "called_off"
  //@ ensures \result === "confirmed" ==> !off && told !== undefined
  //@ ensures \result === "open" ==> !off && told !== undefined && now < at
  //@ ensures told !== undefined && !off && now >= at ==> \result === "confirmed"
  //@ ensures told !== undefined && !off && now >= told + hours * 3600000 ==> \result === "confirmed"
  //@ ensures told !== undefined && !off && now < at && now < told + hours * 3600000 ==> \result === "open"
  if (off) return "called_off";
  if (told === undefined) return "not_told";
  return planCloses(told, hours, at) > now ? "open" : "confirmed";
}

// ---- everyone-yes
/** The member saw who it is. An unknown status is not a reveal. */
function isRevealed(s: string): boolean {
  //@ verify
  return s === "invited" || s === "accepted" || s === "declined" || s === "countered" || s === "ignored" || s === "expired"
    || s === "dropped" || s === "confirmed" || s === "attended" || s === "no_show" || s === "cancelled_with_notice";
}

/** The member said yes after the reveal. A later no-show or cancellation still said yes. */
function saidYes(s: string): boolean {
  //@ verify
  return s === "accepted" || s === "confirmed" || s === "attended" || s === "no_show" || s === "cancelled_with_notice";
}

/** Each status in `xs` is revealed, or with `yes` is a yes. */
function allOf(xs: string[], yes: boolean): boolean {
  //@ verify
  //@ ensures \result <==> forall(i: nat, i < xs.length ==> (yes ? saidYes(xs[i]) : isRevealed(xs[i])))
  for (let i = 0; i < xs.length; i++) {
    //@ invariant 0 <= i && i <= xs.length
    //@ invariant forall(j: nat, j < i ==> (yes ? saidYes(xs[j]) : isRevealed(xs[j])))
    //@ decreases xs.length - i
    if (!(yes ? saidYes(xs[i]) : isRevealed(xs[i]))) return false;
  }
  return true;
}

export interface YesCount { revealed: number; yes: number }

/**
 * Of these opportunities (each one a list of statuses), how many are revealed to everyone and how
 * many have a yes from everyone. The two counts are independent: the bound rests on the two tables.
 */
export function yesCounts(opps: string[][]): YesCount {
  //@ verify
  //@ ensures \result.yes > 0 ==> exists(i: nat, i < opps.length && forall(j: nat, j < opps[i].length ==> saidYes(opps[i][j])))
  //@ ensures forall(i: nat, i < opps.length ==> forall(j: nat, j < opps[i].length ==> saidYes(opps[i][j]))) ==> \result.yes === opps.length && \result.revealed === opps.length
  //@ ensures 0 <= \result.yes && \result.yes <= \result.revealed && \result.revealed <= opps.length
  let revealed = 0, yes = 0;
  for (let i = 0; i < opps.length; i++) {
    //@ invariant 0 <= i && i <= opps.length
    //@ invariant yes > 0 ==> exists(k: nat, k < i && forall(j: nat, j < opps[k].length ==> saidYes(opps[k][j])))
    //@ invariant forall(k: nat, k < i ==> forall(j: nat, j < opps[k].length ==> saidYes(opps[k][j]))) ==> yes === i && revealed === i
    //@ invariant 0 <= yes && yes <= revealed && revealed <= i
    //@ decreases opps.length - i
    const r = allOf(opps[i], false);
    const y = allOf(opps[i], true);
    if (r) revealed = revealed + 1;
    if (y) yes = yes + 1;
  }
  return { revealed, yes };
}

// ---- rate
/** a of b as a whole percent, nearest first. No base: no rate. Never above 100, for pairs that two sources count. */
export function rate(a: number, b: number): number | undefined {
  //@ verify
  //@ requires a >= 0 && b >= 0
  //@ ensures b === 0 ==> \result === undefined
  //@ ensures b > 0 ==> \result !== undefined
  //@ ensures \result !== undefined ==> 0 <= \result && \result <= 100
  //@ ensures \result !== undefined && a < b ==> 2 * \result * b <= 200 * a + b && 200 * a + b < 2 * \result * b + 2 * b
  //@ ensures \result !== undefined && a >= b ==> \result === 100
  if (b === 0) return undefined;
  if (a >= b) return 100;
  const p = Math.floor((200 * a + b) / (2 * b));
  //@ assert p * (2 * b) <= 200 * a + b && 200 * a + b < (p + 1) * (2 * b)
  //@ assert 200 * a + b < 201 * b
  return p;
}

// ---- drawer tab
export type ViewTab = "review" | "feed" | "pipeline" | "requests" | "engine" | "safety" | "metrics" | "lab" | "config" | "game";
export interface TabCaps { showReview: boolean; game: boolean; hasRequests: boolean; analyst: boolean; realOnly: boolean }

export function tabVisible(t: ViewTab, c: TabCaps): boolean {
  //@ verify
  if (t === "review") return c.showReview;
  if (t === "game") return c.game;
  if (t === "requests") return c.hasRequests;
  if (t === "lab") return c.analyst && !c.realOnly;
  if (t === "config") return c.analyst;
  return t === "feed" || t === "pipeline" || t === "engine" || t === "safety" || t === "metrics";
}

/** The one tab that every control reads. */
export function effectiveTab(want: ViewTab, c: TabCaps): ViewTab {
  //@ verify
  //@ ensures tabVisible(\result, c)
  //@ ensures tabVisible(want, c) ==> \result === want
  //@ ensures !tabVisible(want, c) ==> \result === "feed"
  //@ ensures \result === "config" || \result === "lab" ==> c.analyst
  //@ ensures \result === "lab" ==> !c.realOnly
  //@ ensures \result === "review" ==> c.showReview
  //@ ensures \result === "game" ==> c.game
  //@ ensures \result === "requests" ==> c.hasRequests
  //@ ensures want === "feed" || want === "pipeline" || want === "engine" || want === "safety" || want === "metrics" ==> \result === want
  return tabVisible(want, c) ? want : "feed";
}

// ---- durations
export interface DurParts { d: number; h: number; m: number }

/** Whole minutes, as days, hours and minutes. The shell builds the text. */
export function durParts(ms: number): DurParts {
  //@ verify
  //@ requires ms >= 0
  //@ ensures \result.d * 1440 + \result.h * 60 + \result.m === Math.floor(ms / 60000)
  //@ ensures 0 <= \result.h && \result.h < 24 && 0 <= \result.m && \result.m < 60 && \result.d >= 0
  const total = Math.floor(ms / 60000);
  const h = Math.floor(total / 60);
  const d = Math.floor(h / 24);
  return { d, h: h % 24, m: total % 60 };
}

// ---- propose
/** Game only. Fails closed: a pick that the map does not know counts as a minor. The server checks again. */
export function canPropose(picks: string[], minor: Map<string, boolean>, hasGame: boolean, sparks: number, over: boolean): boolean {
  //@ verify
  //@ ensures \result ==> hasGame && sparks > 0 && !over
  //@ ensures \result ==> forall(i: nat, i < picks.length ==> minor.has(picks[i]) && !minor.get(picks[i]))
  //@ ensures hasGame && sparks > 0 && !over && forall(i: nat, i < picks.length ==> minor.has(picks[i]) && !minor.get(picks[i])) ==> \result
  if (!hasGame || sparks <= 0 || over) return false;
  for (let i = 0; i < picks.length; i++) {
    //@ invariant 0 <= i && i <= picks.length
    //@ invariant forall(j: nat, j < i ==> minor.has(picks[j]) && !minor.get(picks[j]))
    //@ decreases picks.length - i
    if (!minor.has(picks[i])) return false;
    if (minor.get(picks[i]) === true) return false;
  }
  return true;
}
