// GENERATED from spec/oauthTokenLifecycle.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md:9) */
export type TokenPhase = "Beginning" | "CheckingCodeBinding" | "CheckingGrant" | "CheckingAuthority" | "CheckingRefreshBinding" | "AwaitingConsumption" | "AwaitingTokenWrite" | "AwaitingRotation" | "TokensReady" | "RevokeGrant" | "Refused" | "RetryAuthority";
/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md:9) */
export type TokenReason = "NoReason" | "InvalidGrant" | "CodeExpired" | "RedirectMismatch" | "VerifierMismatch" | "InvalidScope" | "InvalidTarget";
/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md:9) */
export interface TokenFlow { phase: TokenPhase; reason: TokenReason; refresh: boolean }
/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md:42) */
export type TokenAuthority = "Current" | "Invalid" | "Unavailable";
/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md:70) */
export type CodeConsumption = "NoCode" | "PreviousUse" | "CodeConsumed";
/** Story: Use and renew an approved connector grant / Revocation affects credentials owned by the authenticated client (spec/oauthTokenLifecycle.md:98) */
export type Revocation = "NoChange" | "EndAccess" | "EndGrant";

/** One variant per transition in the spec. */
export type Event =
  | { type: "refuse"; reason: TokenReason }
  | { type: "readCode"; clientMatches: boolean; used: boolean; live: boolean }
  | { type: "readCodeBinding"; redirectMatches: boolean; verifierMatches: boolean; resourceMatches: boolean }
  | { type: "readRefresh"; refreshMatches: boolean }
  | { type: "readGrant"; grantLive: boolean; eligible: boolean }
  | { type: "readAuthority"; credentialLive: boolean; authority: TokenAuthority }
  | { type: "readRefreshBinding"; scopeAllowed: boolean; resourceMatches: boolean; bothLive: boolean }
  | { type: "recordTokens" }
  | { type: "recordRotation"; succeeded: boolean }
  | { type: "readConsumption"; consumption: CodeConsumption; bothLive: boolean };

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md:9) */
export const initial: TokenFlow = { phase: "Beginning", reason: "NoReason", refresh: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: TokenFlow): boolean {
  return true;
}

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md:9) */
//@ pure
export function refuse(flow: TokenFlow, reason: TokenReason): TokenFlow {
  //@ ensures (inv(flow)) ==> stepTokensRequireStorage(flow, "refuse", \result)
  return { ...flow, phase: "Refused", reason: reason };
}

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md:9) */
//@ pure
export function canReadCode(flow: TokenFlow): boolean {
  return flow.phase === "Beginning";
}

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md:9) */
//@ pure
export function canReadCodeBinding(flow: TokenFlow): boolean {
  return flow.phase === "CheckingCodeBinding";
}

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md:9) */
//@ pure
export function canReadRefresh(flow: TokenFlow): boolean {
  return flow.phase === "Beginning";
}

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md:9) */
//@ pure
export function readCode(flow: TokenFlow, clientMatches: boolean, used: boolean, live: boolean): TokenFlow {
  //@ ensures (inv(flow) && canReadCode(flow)) ==> stepTokensRequireStorage(flow, "readCode", \result)
  return !clientMatches ? refuse(flow, "InvalidGrant") : (used ? ({ ...flow, phase: "RevokeGrant" } as TokenFlow) : (!live ? refuse(flow, "CodeExpired") : ({ ...flow, phase: "CheckingCodeBinding" } as TokenFlow)));
}

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md:9) */
//@ pure
export function readCodeBinding(flow: TokenFlow, redirectMatches: boolean, verifierMatches: boolean, resourceMatches: boolean): TokenFlow {
  //@ ensures (inv(flow) && canReadCodeBinding(flow)) ==> stepTokensRequireStorage(flow, "readCodeBinding", \result)
  return !redirectMatches ? refuse(flow, "RedirectMismatch") : (!verifierMatches ? refuse(flow, "VerifierMismatch") : (!resourceMatches ? refuse(flow, "InvalidTarget") : ({ ...flow, phase: "CheckingGrant" } as TokenFlow)));
}

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md:9) */
//@ pure
export function readRefresh(flow: TokenFlow, refreshMatches: boolean): TokenFlow {
  //@ ensures (inv(flow) && canReadRefresh(flow)) ==> stepTokensRequireStorage(flow, "readRefresh", \result)
  return refreshMatches ? ({ ...flow, phase: "CheckingGrant", refresh: true } as TokenFlow) : refuse(flow, "InvalidGrant");
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md:42) */
//@ pure
export function canReadGrant(flow: TokenFlow): boolean {
  return flow.phase === "CheckingGrant";
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md:42) */
//@ pure
export function canReadAuthority(flow: TokenFlow): boolean {
  return flow.phase === "CheckingAuthority";
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md:42) */
//@ pure
export function canReadRefreshBinding(flow: TokenFlow): boolean {
  return flow.phase === "CheckingRefreshBinding";
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md:42) */
//@ pure
export function codeCanBeConsumed(flow: TokenFlow, bothLive: boolean): boolean {
  return flow.phase === "AwaitingConsumption" && bothLive;
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md:42) */
//@ pure
export function readGrant(flow: TokenFlow, grantLive: boolean, eligible: boolean): TokenFlow {
  //@ ensures (inv(flow) && canReadGrant(flow)) ==> stepTokensRequireStorage(flow, "readGrant", \result)
  return grantLive && eligible ? ({ ...flow, phase: "CheckingAuthority" } as TokenFlow) : refuse(flow, "InvalidGrant");
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md:42) */
//@ pure
export function readAuthority(flow: TokenFlow, credentialLive: boolean, authority: TokenAuthority): TokenFlow {
  //@ ensures (inv(flow) && canReadAuthority(flow)) ==> stepTokensRequireStorage(flow, "readAuthority", \result)
  return !credentialLive ? refuse(flow, "InvalidGrant") : (authority === "Unavailable" ? ({ ...flow, phase: "RetryAuthority" } as TokenFlow) : (authority === "Invalid" ? refuse(flow, "InvalidGrant") : ({ ...flow, phase: flow.refresh ? "CheckingRefreshBinding" : "AwaitingConsumption" } as TokenFlow)));
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md:42) */
//@ pure
export function readRefreshBinding(flow: TokenFlow, scopeAllowed: boolean, resourceMatches: boolean, bothLive: boolean): TokenFlow {
  //@ ensures (inv(flow) && canReadRefreshBinding(flow)) ==> stepTokensRequireStorage(flow, "readRefreshBinding", \result)
  return !scopeAllowed ? refuse(flow, "InvalidScope") : (!resourceMatches ? refuse(flow, "InvalidTarget") : (!bothLive ? refuse(flow, "InvalidGrant") : ({ ...flow, phase: "AwaitingRotation" } as TokenFlow)));
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md:70) */
//@ pure
export function canReadConsumption(flow: TokenFlow): boolean {
  return flow.phase === "AwaitingConsumption";
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md:70) */
//@ pure
export function canRecordTokens(flow: TokenFlow): boolean {
  return flow.phase === "AwaitingTokenWrite";
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md:70) */
//@ pure
export function recordTokens(flow: TokenFlow): TokenFlow {
  //@ ensures (inv(flow) && canRecordTokens(flow)) ==> stepTokensRequireStorage(flow, "recordTokens", \result)
  return { ...flow, phase: "TokensReady" };
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md:70) */
//@ pure
export function canRecordRotation(flow: TokenFlow): boolean {
  return flow.phase === "AwaitingRotation";
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md:70) */
//@ pure
export function recordRotation(flow: TokenFlow, succeeded: boolean): TokenFlow {
  //@ ensures (inv(flow) && canRecordRotation(flow)) ==> stepTokensRequireStorage(flow, "recordRotation", \result)
  return { ...flow, phase: succeeded ? "TokensReady" : "RevokeGrant" };
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md:70) */
//@ pure
export function stepTokensRequireStorage(before: TokenFlow, via: string, after: TokenFlow): boolean {
  return !(after.phase === "TokensReady") || ((via === "recordTokens" && before.phase === "AwaitingTokenWrite") || (via === "recordRotation" && before.phase === "AwaitingRotation"));
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md:70) */
//@ pure
export function sometimesCanIssue(flow: TokenFlow): boolean {
  return flow.phase === "TokensReady" && !flow.refresh;
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md:70) */
//@ pure
export function sometimesCanRefresh(flow: TokenFlow): boolean {
  return flow.phase === "TokensReady" && flow.refresh;
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md:70) */
//@ pure
export function readConsumption(flow: TokenFlow, consumption: CodeConsumption, bothLive: boolean): TokenFlow {
  //@ ensures (inv(flow) && canReadConsumption(flow)) ==> stepTokensRequireStorage(flow, "readConsumption", \result)
  return consumption === "PreviousUse" ? ({ ...flow, phase: "RevokeGrant" } as TokenFlow) : (consumption !== "CodeConsumed" || !bothLive ? refuse(flow, "InvalidGrant") : ({ ...flow, phase: "AwaitingTokenWrite" } as TokenFlow));
}

/** Story: Use and renew an approved connector grant / Revocation affects credentials owned by the authenticated client (spec/oauthTokenLifecycle.md:98) */
//@ pure
export function tokenRevocation(clientOwns: boolean, refresh: boolean): Revocation {
  return !clientOwns ? "NoChange" : (refresh ? "EndGrant" : "EndAccess");
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: TokenFlow, event: Event): boolean {
  if (event.type === "refuse") return true;
  if (event.type === "readCode") return canReadCode(current);
  if (event.type === "readCodeBinding") return canReadCodeBinding(current);
  if (event.type === "readRefresh") return canReadRefresh(current);
  if (event.type === "readGrant") return canReadGrant(current);
  if (event.type === "readAuthority") return canReadAuthority(current);
  if (event.type === "readRefreshBinding") return canReadRefreshBinding(current);
  if (event.type === "recordTokens") return canRecordTokens(current);
  if (event.type === "recordRotation") return canRecordRotation(current);
  if (event.type === "readConsumption") return canReadConsumption(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: TokenFlow, event: Event): TokenFlow {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "refuse") return refuse(current, event.reason);
  if (event.type === "readCode" && canReadCode(current)) return readCode(current, event.clientMatches, event.used, event.live);
  if (event.type === "readCodeBinding" && canReadCodeBinding(current)) return readCodeBinding(current, event.redirectMatches, event.verifierMatches, event.resourceMatches);
  if (event.type === "readRefresh" && canReadRefresh(current)) return readRefresh(current, event.refreshMatches);
  if (event.type === "readGrant" && canReadGrant(current)) return readGrant(current, event.grantLive, event.eligible);
  if (event.type === "readAuthority" && canReadAuthority(current)) return readAuthority(current, event.credentialLive, event.authority);
  if (event.type === "readRefreshBinding" && canReadRefreshBinding(current)) return readRefreshBinding(current, event.scopeAllowed, event.resourceMatches, event.bothLive);
  if (event.type === "recordTokens" && canRecordTokens(current)) return recordTokens(current);
  if (event.type === "recordRotation" && canRecordRotation(current)) return recordRotation(current, event.succeeded);
  if (event.type === "readConsumption" && canReadConsumption(current)) return readConsumption(current, event.consumption, event.bothLive);
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "refuse" && (raw.reason === "NoReason" || raw.reason === "InvalidGrant" || raw.reason === "CodeExpired" || raw.reason === "RedirectMismatch" || raw.reason === "VerifierMismatch" || raw.reason === "InvalidScope" || raw.reason === "InvalidTarget")) return { type: "refuse", reason: raw.reason };
  if (raw.type === "readCode" && typeof raw.clientMatches === "boolean" && typeof raw.used === "boolean" && typeof raw.live === "boolean") return { type: "readCode", clientMatches: raw.clientMatches, used: raw.used, live: raw.live };
  if (raw.type === "readCodeBinding" && typeof raw.redirectMatches === "boolean" && typeof raw.verifierMatches === "boolean" && typeof raw.resourceMatches === "boolean") return { type: "readCodeBinding", redirectMatches: raw.redirectMatches, verifierMatches: raw.verifierMatches, resourceMatches: raw.resourceMatches };
  if (raw.type === "readRefresh" && typeof raw.refreshMatches === "boolean") return { type: "readRefresh", refreshMatches: raw.refreshMatches };
  if (raw.type === "readGrant" && typeof raw.grantLive === "boolean" && typeof raw.eligible === "boolean") return { type: "readGrant", grantLive: raw.grantLive, eligible: raw.eligible };
  if (raw.type === "readAuthority" && typeof raw.credentialLive === "boolean" && (raw.authority === "Current" || raw.authority === "Invalid" || raw.authority === "Unavailable")) return { type: "readAuthority", credentialLive: raw.credentialLive, authority: raw.authority };
  if (raw.type === "readRefreshBinding" && typeof raw.scopeAllowed === "boolean" && typeof raw.resourceMatches === "boolean" && typeof raw.bothLive === "boolean") return { type: "readRefreshBinding", scopeAllowed: raw.scopeAllowed, resourceMatches: raw.resourceMatches, bothLive: raw.bothLive };
  if (raw.type === "recordTokens") return { type: "recordTokens" };
  if (raw.type === "recordRotation" && typeof raw.succeeded === "boolean") return { type: "recordRotation", succeeded: raw.succeeded };
  if (raw.type === "readConsumption" && (raw.consumption === "NoCode" || raw.consumption === "PreviousUse" || raw.consumption === "CodeConsumed") && typeof raw.bothLive === "boolean") return { type: "readConsumption", consumption: raw.consumption, bothLive: raw.bothLive };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): TokenFlow | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Beginning" || raw.phase === "CheckingCodeBinding" || raw.phase === "CheckingGrant" || raw.phase === "CheckingAuthority" || raw.phase === "CheckingRefreshBinding" || raw.phase === "AwaitingConsumption" || raw.phase === "AwaitingTokenWrite" || raw.phase === "AwaitingRotation" || raw.phase === "TokensReady" || raw.phase === "RevokeGrant" || raw.phase === "Refused" || raw.phase === "RetryAuthority") && (raw.reason === "NoReason" || raw.reason === "InvalidGrant" || raw.reason === "CodeExpired" || raw.reason === "RedirectMismatch" || raw.reason === "VerifierMismatch" || raw.reason === "InvalidScope" || raw.reason === "InvalidTarget") && typeof raw.refresh === "boolean" && Object.keys(raw).length === 3)) return undefined;
  const parsed: TokenFlow = ({ phase: raw.phase, reason: raw.reason, refresh: raw.refresh });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): TokenFlow {
  //@ ensures inv(\result)
  return initial;
}
