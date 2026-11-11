//@ backend dafny
// The environment decisions of the platform: which environment is declared, when the dev shortcuts
// may run, and what a process misses before it may start. Import-free, proved by LemmaScript
// (docs/formal-verification.md). env.ts calls these functions. The shell gives an unset variable as "".
// Detection fails closed: an environment that is not declared is treated like production.

/** The smallest secret length the boot check accepts. */
export const MIN_SECRET_LENGTH = 32;

/**
 * The declared environment: PLATFORM_ENV (production | staging | dev), else NODE_ENV=production, else
 * NODE_ENV=test (bun test) as dev. "" when it is not declared. A PLATFORM_ENV that is set to another
 * value is not declared, whatever NODE_ENV says.
 */
export function declaredEnv(platformEnv: string, nodeEnv: string): string {
  //@ verify
  //@ ensures \result === "" || \result === "production" || \result === "staging" || \result === "dev"
  //@ ensures platformEnv !== "" ==> (\result === platformEnv || \result === "")
  //@ ensures \result === "dev" ==> platformEnv === "dev" || (platformEnv === "" && nodeEnv === "test")
  if (platformEnv !== "") return platformEnv === "production" || platformEnv === "staging" || platformEnv === "dev" ? platformEnv : "";
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "test") return "dev";
  return "";
}

/** True when the environment says production (NODE_ENV or PLATFORM_ENV). */
export function productionEnv(nodeEnv: string, platformEnv: string): boolean {
  //@ verify
  return nodeEnv === "production" || platformEnv === "production";
}

/** True only in a declared dev environment that does not say production. Every dev-only shortcut checks this. */
export function devAllowed(platformEnv: string, nodeEnv: string): boolean {
  //@ verify
  //@ ensures \result ==> nodeEnv !== "production" && platformEnv !== "production"
  //@ ensures \result ==> platformEnv === "dev" || (platformEnv === "" && nodeEnv === "test")
  //@ ensures \result <==> (declaredEnv(platformEnv, nodeEnv) === "dev" && !productionEnv(nodeEnv, platformEnv))
  return !productionEnv(nodeEnv, platformEnv) && declaredEnv(platformEnv, nodeEnv) === "dev";
}

/** The facts of the environment that the boot check reads. Each string is "" when the variable is unset. */
export interface BootFacts {
  platformEnv: string;
  nodeEnv: string;
  /** The problems of the OTP provider configuration (otp-config.ts). */
  otpProblems: string[];
  turnstileSecret: string;
  proxySecret: string;
  hashKey: string;
  sessionSecret: string;
  networkDatabaseUrl: string;
  databaseUrl: string;
  /** True when NETWORK_REVIEW_MODE is set, also when it is set to "". */
  reviewModeSet: boolean;
  reviewMode: string;
  /** Every variable name, in the order of the environment, and its value at the same index. */
  envKeys: string[];
  envValues: string[];
}

/** One problem when bad, else none. */
function problem(bad: boolean, text: string): string[] {
  //@ verify
  //@ ensures \result.length === (bad ? 1 : 0)
  return bad ? [text] : [];
}

/** The problem of one secret: unset, or shorter than MIN_SECRET_LENGTH. */
function secretProblem(name: string, value: string): string[] {
  //@ verify
  //@ ensures \result.length === 0 <==> value.length >= MIN_SECRET_LENGTH
  if (value === "") return [name];
  return value.length < MIN_SECRET_LENGTH ? [name + " (at least 32 characters)"] : [];
}

/** True when a variable is a dev-only switch that is turned on (PLATFORM_DEV_* with a value). */
function devSwitchOn(key: string, value: string): boolean {
  //@ verify
  return key.startsWith("PLATFORM_DEV_") && value !== "";
}

/** One problem for each dev-only switch that is on from index i, in the order of the environment. */
function devSwitchProblems(keys: string[], values: string[], i: number): string[] {
  //@ verify
  //@ requires keys.length === values.length && 0 <= i && i <= keys.length
  //@ decreases keys.length - i
  //@ ensures \result.length === 0 <==> forall(k: nat, i <= k && k < keys.length ==> !devSwitchOn(keys[k], values[k]))
  if (i >= keys.length) return [];
  return problem(devSwitchOn(keys[i], values[i]), "unset " + keys[i] + " (dev only)").concat(devSwitchProblems(keys, values, i + 1));
}

/** All boot requirements of a production or staging process hold. Spec of bootProblems. */
function deployedReady(f: BootFacts): boolean {
  //@ verify
  //@ requires f.envKeys.length === f.envValues.length
  return f.otpProblems.length === 0 && f.turnstileSecret !== ""
    && f.proxySecret.length >= MIN_SECRET_LENGTH && f.hashKey.length >= MIN_SECRET_LENGTH && f.sessionSecret.length >= MIN_SECRET_LENGTH
    && (f.networkDatabaseUrl !== "" || f.databaseUrl !== "")
    && (!f.reviewModeSet || f.reviewMode === "human")
    && devSwitchProblems(f.envKeys, f.envValues, 0).length === 0;
}

/**
 * What a process is missing before it may start, one line per problem; empty when it may start.
 * Fail closed: an environment that is not declared, or dev that says production, never starts. A
 * production or staging process needs the OTP provider, Turnstile, the three secrets of at least 32
 * characters, a database, review mode human (when set), and no dev-only switch. Dev needs nothing more.
 */
export function bootProblems(f: BootFacts): string[] {
  //@ verify
  //@ requires f.envKeys.length === f.envValues.length
  //@ ensures declaredEnv(f.platformEnv, f.nodeEnv) === "" ==> \result.length > 0
  //@ ensures \result.length === 0 ==> declaredEnv(f.platformEnv, f.nodeEnv) !== ""
  //@ ensures \result.length === 0 && productionEnv(f.nodeEnv, f.platformEnv) ==> declaredEnv(f.platformEnv, f.nodeEnv) !== "dev"
  //@ ensures \result.length === 0 && declaredEnv(f.platformEnv, f.nodeEnv) !== "dev" ==> deployedReady(f)
  //@ ensures declaredEnv(f.platformEnv, f.nodeEnv) !== "" && declaredEnv(f.platformEnv, f.nodeEnv) !== "dev" && deployedReady(f) ==> \result.length === 0
  //@ ensures \result.length === 0 && declaredEnv(f.platformEnv, f.nodeEnv) !== "dev" ==> f.proxySecret.length >= 32 && f.hashKey.length >= 32 && f.sessionSecret.length >= 32 && f.turnstileSecret !== ""
  const e = declaredEnv(f.platformEnv, f.nodeEnv);
  if (e === "") return ["PLATFORM_ENV must be one of production, staging, dev"];
  if (e === "dev") return problem(productionEnv(f.nodeEnv, f.platformEnv), "NODE_ENV=production with PLATFORM_ENV=dev");
  return f.otpProblems
    .concat(problem(f.turnstileSecret === "", "TURNSTILE_SECRET_KEY"))
    .concat(secretProblem("PLATFORM_PROXY_SECRET", f.proxySecret))
    .concat(secretProblem("PLATFORM_HASH_KEY", f.hashKey))
    .concat(secretProblem("PLATFORM_SESSION_SECRET", f.sessionSecret))
    .concat(problem(f.networkDatabaseUrl === "" && f.databaseUrl === "", "NETWORK_DATABASE_URL or DATABASE_URL"))
    .concat(problem(f.reviewModeSet && f.reviewMode !== "human", "NETWORK_REVIEW_MODE=human (got " + f.reviewMode + ")"))
    .concat(devSwitchProblems(f.envKeys, f.envValues, 0));
}
