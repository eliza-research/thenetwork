// Generated from spec/backendHealth.md via Vibestack and VibeLang. Run pnpm run spec:sync.
// GENERATED from spec/backendHealth.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md) */
export const initial = { tag: "CheckingAdmission" };
/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current) {
    return true;
}
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md) */
//@ pure
export function reportsStatus(s, status) {
    return s.tag === "Reported" ? s.status === status : false;
}
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md) */
//@ pure
export function canCheckAdmission(s) {
    return s.tag === "CheckingAdmission" ? true : false;
}
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md) */
//@ pure
export function checkAdmission(s, serving) {
    //@ ensures (inv(s) && canCheckAdmission(s)) ==> stepReportIsFinal(s, \result)
    return serving ? { tag: "CheckingDatabase" } : { tag: "Reported", status: "Draining" };
}
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) */
//@ pure
export function canCheckDatabase(s) {
    return s.tag === "CheckingDatabase" ? true : false;
}
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) */
//@ pure
export function canCheckTicks(s) {
    return s.tag === "CheckingTicks" ? true : false;
}
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) */
//@ pure
export function stepReportIsFinal(before, after) {
    return before.tag === "Reported" ? equal_backendHealth(after, before) : true;
}
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) */
//@ pure
export function checkDatabase(s, reachable) {
    //@ ensures (inv(s) && canCheckDatabase(s)) ==> stepReportIsFinal(s, \result)
    return reachable ? { tag: "CheckingTicks" } : { tag: "Reported", status: "DatabaseDown" };
}
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) */
//@ pure
export function checkTicks(s, late) {
    //@ ensures (inv(s) && canCheckTicks(s)) ==> stepReportIsFinal(s, \result)
    return { tag: "Reported", status: late ? "TickLate" : "Ready" };
}
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) */
//@ pure
export function sometimesReportsReady(s) {
    return reportsStatus(s, "Ready");
}
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) */
//@ pure
export function sometimesReportsDraining(s) {
    return reportsStatus(s, "Draining");
}
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) */
//@ pure
export function sometimesReportsDatabaseDown(s) {
    return reportsStatus(s, "DatabaseDown");
}
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) */
//@ pure
export function sometimesReportsLateTick(s) {
    return reportsStatus(s, "TickLate");
}
/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current, event) {
    if (event.type === "checkAdmission")
        return canCheckAdmission(current);
    if (event.type === "checkDatabase")
        return canCheckDatabase(current);
    if (event.type === "checkTicks")
        return canCheckTicks(current);
    return false;
}
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current, event) {
    //@ requires inv(current)
    //@ ensures inv(\result)
    if (event.type === "checkAdmission")
        return canCheckAdmission(current) ? checkAdmission(current, event.serving) : current;
    if (event.type === "checkDatabase")
        return canCheckDatabase(current) ? checkDatabase(current, event.reachable) : current;
    if (event.type === "checkTicks")
        return canCheckTicks(current) ? checkTicks(current, event.late) : current;
    return current;
}
/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x) {
    let raw;
    try {
        raw = JSON.parse(JSON.stringify(x));
    }
    catch {
        return undefined;
    }
    if (typeof raw !== "object" || raw === null)
        return undefined;
    if (raw.type === "checkAdmission" && typeof raw.serving === "boolean")
        return { type: "checkAdmission", serving: raw.serving };
    if (raw.type === "checkDatabase" && typeof raw.reachable === "boolean")
        return { type: "checkDatabase", reachable: raw.reachable };
    if (raw.type === "checkTicks" && typeof raw.late === "boolean")
        return { type: "checkTicks", late: raw.late };
    return undefined;
}
/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x) {
    let raw;
    try {
        raw = JSON.parse(JSON.stringify(x));
    }
    catch {
        return undefined;
    }
    if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.tag === "CheckingAdmission" && Object.keys(raw).length === 1 || raw.tag === "CheckingDatabase" && Object.keys(raw).length === 1 || raw.tag === "CheckingTicks" && Object.keys(raw).length === 1 || raw.tag === "Reported" && (raw.status === "Ready" || raw.status === "Draining" || raw.status === "DatabaseDown" || raw.status === "TickLate") && Object.keys(raw).length === 2)))
        return undefined;
    const parsed = (raw.tag === "CheckingAdmission" ? { tag: raw.tag } : raw.tag === "CheckingDatabase" ? { tag: raw.tag } : raw.tag === "CheckingTicks" ? { tag: raw.tag } : { tag: raw.tag, status: raw.status });
    return inv(parsed) ? parsed : undefined;
}
/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds() {
    //@ ensures inv(\result)
    return initial;
}
/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_backendHealth(a, b) {
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
        return a === b;
    const keys = Object.keys(a);
    return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
        && keys.every((k) => Object.hasOwn(b, k) && equal_backendHealth(a[k], b[k]));
}
