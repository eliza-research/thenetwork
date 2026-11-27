// Generated from spec/backendHealth.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import type { HealthStatus, BackendHealth, Event } from "./backendHealth.ts";
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md) @throws {never} */
export declare const initial: BackendHealth;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export declare function inv(current: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md) @throws {never} */
export declare function reportsStatus(s: BackendHealth, status: HealthStatus): boolean;
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md) @throws {never} */
export declare function canCheckAdmission(s: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md) @throws {never} */
export declare function checkAdmission(s: BackendHealth, serving: boolean): BackendHealth;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export declare function canCheckDatabase(s: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export declare function checkDatabase(s: BackendHealth, reachable: boolean): BackendHealth;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export declare function canCheckTicks(s: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export declare function checkTicks(s: BackendHealth, late: boolean): BackendHealth;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export declare function stepReportIsFinal(before: BackendHealth, after: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export declare function sometimesReportsReady(s: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export declare function sometimesReportsDraining(s: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export declare function sometimesReportsDatabaseDown(s: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md) @throws {never} */
export declare function sometimesReportsLateTick(s: BackendHealth): boolean;
/** Do the rules allow this event in this state? @throws {never} */
export declare function enabled(current: BackendHealth, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export declare function step(current: BackendHealth, event: Event): BackendHealth;
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseEvent(x: unknown): Event | undefined;
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseState(x: unknown): BackendHealth | undefined;
/** @throws {never} */
export declare function snapshot_backendHealth<A>(value: A): A;
/** @throws {never} */
export declare function snapshot_in_backendHealth<A>(value: A): A;
