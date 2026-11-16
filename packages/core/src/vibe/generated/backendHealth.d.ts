// Generated from spec/backendHealth.md via Vibestack and VibeLang. Run bun run spec:sync.
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md:9) */
export type HealthStatus = "Ready" | "Draining" | "DatabaseDown" | "TickLate";
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md:9) */
export type BackendHealth = {
    tag: "CheckingAdmission";
} | {
    tag: "CheckingDatabase";
} | {
    tag: "CheckingTicks";
} | {
    tag: "Reported";
    status: HealthStatus;
};
/** One variant per transition in the spec. */
export type Event = {
    type: "checkAdmission";
    serving: boolean;
} | {
    type: "checkTicks";
    late: boolean;
} | {
    type: "checkDatabase";
    reachable: boolean;
};
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md:9) */
export declare const initial: BackendHealth;
/** Every `always` rule at once. Holds initially and after every transition. */
export declare function inv(current: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md:9) */
export declare function canCheckAdmission(s: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Admit the check before reading the database (spec/backendHealth.md:9) */
export declare function checkAdmission(s: BackendHealth, serving: boolean): BackendHealth;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md:24) */
export declare function stepReportIsFinal(before: BackendHealth, after: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md:24) */
export declare function canCheckTicks(s: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md:24) */
export declare function checkTicks(s: BackendHealth, late: boolean): BackendHealth;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md:24) */
export declare function sometimesReportsReady(s: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md:24) */
export declare function sometimesReportsDraining(s: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md:24) */
export declare function sometimesReportsDatabaseDown(s: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md:24) */
export declare function sometimesReportsLateTick(s: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md:24) */
export declare function canCheckDatabase(s: BackendHealth): boolean;
/** Story: Tell operators when a backend cannot serve / Read tick lateness only after a successful database ping (spec/backendHealth.md:24) */
export declare function checkDatabase(s: BackendHealth, reachable: boolean): BackendHealth;
/** Do the rules allow this event in this state? */
export declare function enabled(current: BackendHealth, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
export declare function step(current: BackendHealth, event: Event): BackendHealth;
/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
export declare function parseEvent(x: unknown): Event | undefined;
/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
export declare function parseState(x: unknown): BackendHealth | undefined;
/** Proof obligation: the initial state satisfies every `always` rule. */
export declare function initialHolds(): BackendHealth;
/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export declare function equal_backendHealth(a: unknown, b: unknown): boolean;
