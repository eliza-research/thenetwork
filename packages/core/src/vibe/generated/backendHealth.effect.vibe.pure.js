// Generated from spec/backendHealth.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import * as M from "./backendHealth.js";
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md) @throws {never} */
export const initial = M.initial;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export function inv(current) { return M.inv(current); }
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md) @throws {never} */
export function canCheckAdmission(s) { return M.canCheckAdmission(s); }
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md) @throws {never} */
export function checkAdmission(s, serving) { return M.checkAdmission(s, serving); }
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export function stepReportIsFinal(before, after) { return M.stepReportIsFinal(before, after); }
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export function canCheckTicks(s) { return M.canCheckTicks(s); }
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export function checkTicks(s, late) { return M.checkTicks(s, late); }
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export function sometimesReportsReady(s) { return M.sometimesReportsReady(s); }
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export function sometimesReportsDraining(s) { return M.sometimesReportsDraining(s); }
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export function sometimesReportsDatabaseDown(s) { return M.sometimesReportsDatabaseDown(s); }
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export function sometimesReportsLateTick(s) { return M.sometimesReportsLateTick(s); }
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export function canCheckDatabase(s) { return M.canCheckDatabase(s); }
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export function checkDatabase(s, reachable) { return M.checkDatabase(s, reachable); }
/** Do the rules allow this event in this state? @throws {never} */
export function enabled(current, event) { return M.enabled(current, event); }
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export function step(current, event) { return M.step(current, event); }
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseEvent(x) { return M.parseEvent(x); }
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseState(x) { return M.parseState(x); }
/** A Machine never shares its held state with callers. @throws {never} */
export function snapshot_backendHealth(value) { return structuredClone(value); }
