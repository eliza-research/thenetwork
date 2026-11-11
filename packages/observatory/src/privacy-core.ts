// The Observatory's privacy decisions: which view class a caller gets for one app, which member and
// opportunity fields each class may see, when the oracle and the truth lens show, and what the
// cross-app person view shows of a private app (PRD 40.3: slop, dating). Import-free, proved by
// LemmaScript (docs/formal-verification.md). shape.ts, people.ts and web/apps.tsx call these
// functions. They read the roles, the SQL rows and the objects, and they build the output.

// ---- view class
/** "full": staff who may open members. "counts": analysts (admin-console 4.1: counts, never a person). */
export type ViewClass = "full" | "counts";

/** The roles that one caller holds for one app (rolesFor() in staff.ts). */
export interface RoleFlags { admin: boolean; reviewer: boolean; safety: boolean; engineer: boolean }

/** The order of the classes. A field with a level above the caller's class never goes to the caller. */
export function classRank(c: ViewClass): number {
  //@ verify
  return c === "full" ? 1 : 0;
}

/** Admin, reviewer, safety and engineer see members. Every other set of roles sees counts only. */
export function classOf(r: RoleFlags): ViewClass {
  //@ verify
  //@ ensures \result === "full" <==> (r.admin || r.reviewer || r.safety || r.engineer)
  return r.admin || r.reviewer || r.safety || r.engineer ? "full" : "counts";
}

// ---- fields
/** keep: the value goes out. drop: the field is removed. mask: the field stays with a value that tells nothing. */
export type FieldUse = "keep" | "drop" | "mask";

/** The lowest class that may see a member field. A field that is not named here is a count-level field. */
export function memberFieldLevel(key: string): ViewClass {
  //@ verify
  //@ ensures key === "name" || key === "age" || key === "minor" || key === "ageUnknown" ==> \result === "full"
  //@ ensures key === "trust" || key === "occupation" || key === "controlled" ==> \result === "full"
  return key === "name" || key === "age" || key === "minor" || key === "ageUnknown"
    || key === "trust" || key === "occupation" || key === "controlled" ? "full" : "counts";
}

/** The lowest class that may see an opportunity field. */
export function oppFieldLevel(key: string): ViewClass {
  //@ verify
  //@ ensures key === "feedback" || key === "explanations" || key === "objective" ==> \result === "full"
  return key === "feedback" || key === "explanations" || key === "objective" ? "full" : "counts";
}

/** A field above the class is masked when the type needs it, else dropped. */
function fieldUse(cls: ViewClass, level: ViewClass, maskable: boolean): FieldUse {
  //@ verify
  //@ ensures \result === "keep" <==> classRank(level) <= classRank(cls)
  //@ ensures \result === "mask" ==> maskable
  if (classRank(level) <= classRank(cls)) return "keep";
  return maskable ? "mask" : "drop";
}

/** One member field for one class. The name is masked (anonName in shape.ts), the age facts are dropped. */
export function memberFieldUse(cls: ViewClass, key: string): FieldUse {
  //@ verify
  //@ ensures \result === "keep" <==> classRank(memberFieldLevel(key)) <= classRank(cls)
  //@ ensures cls === "full" ==> \result === "keep"
  //@ ensures cls === "counts" && (key === "age" || key === "minor" || key === "ageUnknown" || key === "trust") ==> \result === "drop"
  //@ ensures \result === "mask" ==> key === "name"
  return fieldUse(cls, memberFieldLevel(key), key === "name");
}

/** One opportunity field for one class. The texts written for a member are masked, the feedback is dropped. */
export function oppFieldUse(cls: ViewClass, key: string): FieldUse {
  //@ verify
  //@ ensures \result === "keep" <==> classRank(oppFieldLevel(key)) <= classRank(cls)
  //@ ensures cls === "full" ==> \result === "keep"
  //@ ensures cls === "counts" && key === "feedback" ==> \result === "drop"
  //@ ensures \result === "mask" ==> key === "explanations" || key === "objective"
  return fieldUse(cls, oppFieldLevel(key), key === "explanations" || key === "objective");
}

/** The hidden truth goes only to a full-class caller who has the truth lens on. */
export function truthShown(cls: ViewClass, lens: boolean): boolean {
  //@ verify
  //@ ensures \result <==> cls === "full" && lens
  return cls === "full" && lens;
}

// ---- oracle
/** Opportunities whose outcome is known: the oracle's verdict is no longer a spoiler. */
export function oppResolved(state: string): boolean {
  //@ verify
  return state === "COMPLETED" || state === "FEEDBACK_COLLECTED" || state === "ABANDONED";
}

/** An opportunity's oracle verdict, as the caller sees it. */
export interface OracleGate { lens: boolean; state: string; unsafe: boolean }

/** The oracle shows when resolved or unsafe (a safety strike already shows it), or with the truth lens. */
export function oracleShown(g: OracleGate): boolean {
  //@ verify
  //@ ensures \result <==> g.lens || oppResolved(g.state) || g.unsafe
  //@ ensures !g.lens && !g.unsafe && (g.state === "PROPOSED" || g.state === "ACCEPTED") ==> !\result
  return g.lens || oppResolved(g.state) || g.unsafe;
}

// ---- cross-app person view
/** The app of a hold or a block that the view must not name. */
export const ANY_APP = "*";

/** The shortest reason (after trim) that opens one app's panel. The server checks it again. */
export const PERSON_REASON_MIN = 5;

/** One membership row. `hidden`: a private app (isPrivateApp in apps.ts). */
export interface MembershipRow { app: string; hidden: boolean; hold: boolean; restricted: boolean; recycled: boolean }

export type HoldLevel = "hold" | "restricted" | "recycled_number";

/** One hold line. `row` is the membership row it comes from, or -1 for the hold on an app not named. */
export interface HoldLine { row: number; app: string; level: HoldLevel }

/** The summary lists a membership only for an app that is not private. */
export function membershipShown(r: MembershipRow): boolean {
  //@ verify
  //@ ensures \result <==> !r.hidden
  return !r.hidden;
}

/** A hold or a restriction on a private app. */
function hiddenHeld(r: MembershipRow): boolean {
  //@ verify
  return r.hidden && (r.hold || r.restricted);
}

/** A hold line is well formed: a named app comes from a row that is not private. */
function lineOk(rows: MembershipRow[], h: HoldLine): boolean {
  //@ verify
  return (h.row === -1 && h.app === ANY_APP && h.level === "restricted")
    || (0 <= h.row && h.row < rows.length && !rows[h.row].hidden && h.app === rows[h.row].app);
}

/**
 * The holds of a person, in membership order. A private app adds no line of its own: its first hold
 * or restriction adds one "restricted" line on the app not named, and the other private rows add nothing.
 */
export function holdLines(rows: MembershipRow[]): HoldLine[] {
  //@ verify
  //@ ensures forall(i: nat, i < \result.length ==> lineOk(rows, \result[i]))
  //@ ensures forall(i: nat, forall(j: nat, i < \result.length && j < \result.length && \result[i].row === -1 && \result[j].row === -1 ==> i === j))
  //@ ensures exists(i: nat, i < \result.length && \result[i].row === -1) <==> exists(k: nat, k < rows.length && hiddenHeld(rows[k]))
  let out: HoldLine[] = [];
  let star = false;
  for (let i = 0; i < rows.length; i++) {
    //@ invariant 0 <= i && i <= rows.length
    //@ invariant forall(j: nat, j < out.length ==> lineOk(rows, out[j]))
    //@ invariant forall(a: nat, forall(b: nat, a < out.length && b < out.length && out[a].row === -1 && out[b].row === -1 ==> a === b))
    //@ invariant star <==> exists(j: nat, j < out.length && out[j].row === -1)
    //@ invariant star <==> exists(k: nat, k < i && hiddenHeld(rows[k]))
    //@ decreases rows.length - i
    const r = rows[i];
    if (r.hidden) {
      if ((r.hold || r.restricted) && !star) {
        out = [...out, { row: -1, app: ANY_APP, level: "restricted" }];
        star = true;
      }
    } else {
      if (r.hold) out = [...out, { row: i, app: r.app, level: "hold" }];
      if (r.restricted) out = [...out, { row: i, app: r.app, level: "restricted" }];
      if (r.recycled) out = [...out, { row: i, app: r.app, level: "recycled_number" }];
    }
  }
  return out;
}

/** The origin app of a block, as the summary shows it: a private app is not named. */
export function blockOrigin(app: string, hidden: boolean): string {
  //@ verify
  //@ ensures hidden ==> \result === ANY_APP
  //@ ensures !hidden ==> \result === app
  return hidden ? ANY_APP : app;
}

/** The app of a hold or a block line names an app. ANY_APP names none. */
export function namesApp(app: string): boolean {
  //@ verify
  //@ ensures \result <==> app !== ANY_APP
  return app !== ANY_APP;
}

/** One app's panel opens only with a reason of at least PERSON_REASON_MIN characters (after trim). */
export function reasonOk(trimmed: string): boolean {
  //@ verify
  //@ ensures \result <==> trimmed.length >= PERSON_REASON_MIN
  return trimmed.length >= PERSON_REASON_MIN;
}

/** The cross-app button shows only to a cross-app caller in real mode. */
export function crossAppShown(crossApp: boolean, real: boolean): boolean {
  //@ verify
  //@ ensures \result <==> crossApp && real
  return crossApp && real;
}
