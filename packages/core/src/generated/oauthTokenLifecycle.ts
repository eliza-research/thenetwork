// GENERATED from spec/oauthTokenLifecycle.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md) */
export type TokenPhase = "Beginning" | "CheckingCodeBinding" | "CheckingGrant" | "CheckingAuthority" | "CheckingRefreshBinding" | "AwaitingConsumption" | "AwaitingRotation" | "TokensReady" | "RevokeGrant" | "Refused" | "RetryAuthority";
/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md) */
export type TokenReason = "NoReason" | "InvalidGrant" | "CodeExpired" | "RedirectMismatch" | "VerifierMismatch" | "InvalidScope" | "InvalidTarget";
/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md) */
export interface TokenFlow { phase: TokenPhase; reason: TokenReason; refresh: boolean }
/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md) */
export type TokenAuthority = "Current" | "Invalid" | "Unavailable";
/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md) */
export type CodeExchangeResult = "CodeNotCommitted" | "CodeAlreadyUsed" | "CodePairCommitted";
/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md) */
export type RefreshRotationResult = "RefreshNotCommitted" | "RefreshAlreadyUsed" | "RefreshPairCommitted";
/** Story: Use and renew an approved connector grant / Revocation affects credentials owned by the authenticated client (spec/oauthTokenLifecycle.md) */
export type Revocation = "NoChange" | "EndAccess" | "EndGrant";

/** One variant per transition in the spec. */
export type Event =
  | { type: "readCode"; clientMatches: boolean; used: boolean; live: boolean }
  | { type: "readCodeBinding"; redirectMatches: boolean; verifierMatches: boolean; resourceMatches: boolean }
  | { type: "readRefresh"; refreshMatches: boolean }
  | { type: "readGrant"; grantLive: boolean }
  | { type: "readAuthority"; credentialLive: boolean; authority: TokenAuthority }
  | { type: "readRefreshBinding"; scopeAllowed: boolean; resourceMatches: boolean; bothLive: boolean }
  | { type: "readCodeExchange"; result: CodeExchangeResult }
  | { type: "recordRotation"; result: RefreshRotationResult };

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md) */
export const initial: TokenFlow = { phase: "Beginning", reason: "NoReason", refresh: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: TokenFlow): boolean {
  return true;
}

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md) */
//@ pure
export function refuse(reason: TokenReason, flow: TokenFlow): TokenFlow {
  return { ...flow, phase: "Refused", reason: reason };
}

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md) */
//@ pure
export function canReadCode(flow: TokenFlow): boolean {
  return flow.phase === "Beginning";
}

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md) */
//@ pure
export function readCode(flow: TokenFlow, clientMatches: boolean, used: boolean, live: boolean): TokenFlow {
  //@ ensures (inv(flow) && canReadCode(flow)) ==> stepTokensRequireStorage(flow, "readCode", \result)
  return !clientMatches ? refuse("InvalidGrant", flow) : (used ? ({ ...flow, phase: "RevokeGrant" } as TokenFlow) : (!live ? refuse("CodeExpired", flow) : ({ ...flow, phase: "CheckingCodeBinding" } as TokenFlow)));
}

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md) */
//@ pure
export function canReadCodeBinding(flow: TokenFlow): boolean {
  return flow.phase === "CheckingCodeBinding";
}

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md) */
//@ pure
export function readCodeBinding(flow: TokenFlow, redirectMatches: boolean, verifierMatches: boolean, resourceMatches: boolean): TokenFlow {
  //@ ensures (inv(flow) && canReadCodeBinding(flow)) ==> stepTokensRequireStorage(flow, "readCodeBinding", \result)
  return !redirectMatches ? refuse("RedirectMismatch", flow) : (!verifierMatches ? refuse("VerifierMismatch", flow) : (!resourceMatches ? refuse("InvalidTarget", flow) : ({ ...flow, phase: "CheckingGrant" } as TokenFlow)));
}

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md) */
//@ pure
export function canReadRefresh(flow: TokenFlow): boolean {
  return flow.phase === "Beginning";
}

/** Story: Use and renew an approved connector grant / Each token request must match its own credential binding (spec/oauthTokenLifecycle.md) */
//@ pure
export function readRefresh(flow: TokenFlow, refreshMatches: boolean): TokenFlow {
  //@ ensures (inv(flow) && canReadRefresh(flow)) ==> stepTokensRequireStorage(flow, "readRefresh", \result)
  return refreshMatches ? ({ ...flow, phase: "CheckingGrant", refresh: true } as TokenFlow) : refuse("InvalidGrant", flow);
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md) */
//@ pure
export function accessTokenAuthority(credentialLive: boolean, authority: TokenAuthority): TokenAuthority {
  return !credentialLive ? "Invalid" : authority;
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md) */
//@ pure
export function lawExpiredAccessTokenIsInvalid(authority: TokenAuthority): boolean {
  //@ ensures \result === true
  return accessTokenAuthority(false, authority) === "Invalid";
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md) */
//@ pure
export function lawBannedAccessTokenIsInvalid(credentialLive: boolean): boolean {
  //@ ensures \result === true
  return accessTokenAuthority(credentialLive, "Invalid") === "Invalid";
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md) */
//@ pure
export function canReadGrant(flow: TokenFlow): boolean {
  return flow.phase === "CheckingGrant";
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md) */
//@ pure
export function readGrant(flow: TokenFlow, grantLive: boolean): TokenFlow {
  //@ ensures (inv(flow) && canReadGrant(flow)) ==> stepTokensRequireStorage(flow, "readGrant", \result)
  return grantLive ? ({ ...flow, phase: "CheckingAuthority" } as TokenFlow) : refuse("InvalidGrant", flow);
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md) */
//@ pure
export function canReadAuthority(flow: TokenFlow): boolean {
  return flow.phase === "CheckingAuthority";
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md) */
//@ pure
export function readAuthority(flow: TokenFlow, credentialLive: boolean, authority: TokenAuthority): TokenFlow {
  //@ ensures (inv(flow) && canReadAuthority(flow)) ==> stepTokensRequireStorage(flow, "readAuthority", \result)
  return !credentialLive ? refuse("InvalidGrant", flow) : (authority === "Unavailable" ? ({ ...flow, phase: "RetryAuthority" } as TokenFlow) : (authority === "Invalid" ? refuse("InvalidGrant", flow) : ({ ...flow, phase: flow.refresh ? "CheckingRefreshBinding" : "AwaitingConsumption" } as TokenFlow)));
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md) */
//@ pure
export function canReadRefreshBinding(flow: TokenFlow): boolean {
  return flow.phase === "CheckingRefreshBinding";
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md) */
//@ pure
export function readRefreshBinding(flow: TokenFlow, scopeAllowed: boolean, resourceMatches: boolean, bothLive: boolean): TokenFlow {
  //@ ensures (inv(flow) && canReadRefreshBinding(flow)) ==> stepTokensRequireStorage(flow, "readRefreshBinding", \result)
  return !scopeAllowed ? refuse("InvalidScope", flow) : (!resourceMatches ? refuse("InvalidTarget", flow) : (!bothLive ? refuse("InvalidGrant", flow) : ({ ...flow, phase: "AwaitingRotation" } as TokenFlow)));
}

/** Story: Use and renew an approved connector grant / The request needs current grant authority and must stay within its consent (spec/oauthTokenLifecycle.md) */
//@ pure
export function codeCanBeConsumed(flow: TokenFlow, bothLive: boolean): boolean {
  return flow.phase === "AwaitingConsumption" && bothLive;
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md) */
//@ pure
export function codeExchangeMayCommit(grantExactAndUnrevoked: boolean, codeExact: boolean, codeUnused: boolean, at: number, grantEndsAt: number, codeEndsAt: number): boolean {
  return grantExactAndUnrevoked && codeExact && codeUnused && at < grantEndsAt && at < codeEndsAt;
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md) */
//@ pure
export function lawEndedGrantCannotCommitCode(codeExact: boolean, codeUnused: boolean, at: number, grantEndsAt: number, codeEndsAt: number): boolean {
  //@ ensures \result === true
  return !codeExchangeMayCommit(false, codeExact, codeUnused, at, grantEndsAt, codeEndsAt);
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md) */
//@ pure
export function canReadCodeExchange(flow: TokenFlow): boolean {
  return flow.phase === "AwaitingConsumption";
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md) */
//@ pure
export function readCodeExchange(flow: TokenFlow, result: CodeExchangeResult): TokenFlow {
  //@ ensures (inv(flow) && canReadCodeExchange(flow)) ==> stepTokensRequireStorage(flow, "readCodeExchange", \result)
  return result === "CodeAlreadyUsed" ? ({ ...flow, phase: "RevokeGrant" } as TokenFlow) : (result === "CodePairCommitted" ? ({ ...flow, phase: "TokensReady" } as TokenFlow) : refuse("InvalidGrant", flow));
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md) */
//@ pure
export function refreshStoredAuthorityCurrent(grantExactAndUnrevoked: boolean, refreshExactAndUnrevoked: boolean, at: number, grantEndsAt: number, refreshEndsAt: number): boolean {
  return grantExactAndUnrevoked && refreshExactAndUnrevoked && at < grantEndsAt && at < refreshEndsAt;
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md) */
//@ pure
export function lawExpiredRefreshCannotBeCommitted(grantExactAndUnrevoked: boolean, refreshExactAndUnrevoked: boolean, at: number, grantEndsAt: number, refreshEndsAt: number): boolean {
  //@ ensures \result === true
  return !(refreshEndsAt <= at) || !refreshStoredAuthorityCurrent(grantExactAndUnrevoked, refreshExactAndUnrevoked, at, grantEndsAt, refreshEndsAt);
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md) */
//@ pure
export function canRecordRotation(flow: TokenFlow): boolean {
  return flow.phase === "AwaitingRotation";
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md) */
//@ pure
export function recordRotation(flow: TokenFlow, result: RefreshRotationResult): TokenFlow {
  //@ ensures (inv(flow) && canRecordRotation(flow)) ==> stepTokensRequireStorage(flow, "recordRotation", \result)
  return result === "RefreshAlreadyUsed" ? ({ ...flow, phase: "RevokeGrant" } as TokenFlow) : (result === "RefreshPairCommitted" ? ({ ...flow, phase: "TokensReady" } as TokenFlow) : refuse("InvalidGrant", flow));
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md) */
//@ pure
export function lawOnlyLiveRefreshReuseEndsGrant(flow: TokenFlow, result: RefreshRotationResult): boolean {
  //@ ensures \result === true
  return (recordRotation(flow, result).phase === "RevokeGrant") === (result === "RefreshAlreadyUsed");
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md) */
//@ pure
export function stepTokensRequireStorage(before: TokenFlow, via: string, after: TokenFlow): boolean {
  return !(after.phase === "TokensReady") || ((via === "readCodeExchange" && before.phase === "AwaitingConsumption") || (via === "recordRotation" && before.phase === "AwaitingRotation"));
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md) */
//@ pure
export function sometimesCanIssue(flow: TokenFlow): boolean {
  return flow.phase === "TokensReady" && !flow.refresh;
}

/** Story: Use and renew an approved connector grant / Token issuance requires consumption or rotation in storage (spec/oauthTokenLifecycle.md) */
//@ pure
export function sometimesCanRefresh(flow: TokenFlow): boolean {
  return flow.phase === "TokensReady" && flow.refresh;
}

/** Story: Use and renew an approved connector grant / Revocation affects credentials owned by the authenticated client (spec/oauthTokenLifecycle.md) */
//@ pure
export function tokenRevocation(clientOwns: boolean, refresh: boolean): Revocation {
  return !clientOwns ? "NoChange" : (refresh ? "EndGrant" : "EndAccess");
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: TokenFlow, event: Event): boolean {
  if (event.type === "readCode") return canReadCode(current);
  if (event.type === "readCodeBinding") return canReadCodeBinding(current);
  if (event.type === "readRefresh") return canReadRefresh(current);
  if (event.type === "readGrant") return canReadGrant(current);
  if (event.type === "readAuthority") return canReadAuthority(current);
  if (event.type === "readRefreshBinding") return canReadRefreshBinding(current);
  if (event.type === "readCodeExchange") return canReadCodeExchange(current);
  if (event.type === "recordRotation") return canRecordRotation(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: TokenFlow, event: Event): TokenFlow {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "readCode") return canReadCode(current) ? readCode(current, event.clientMatches, event.used, event.live) : current;
  if (event.type === "readCodeBinding") return canReadCodeBinding(current) ? readCodeBinding(current, event.redirectMatches, event.verifierMatches, event.resourceMatches) : current;
  if (event.type === "readRefresh") return canReadRefresh(current) ? readRefresh(current, event.refreshMatches) : current;
  if (event.type === "readGrant") return canReadGrant(current) ? readGrant(current, event.grantLive) : current;
  if (event.type === "readAuthority") return canReadAuthority(current) ? readAuthority(current, event.credentialLive, event.authority) : current;
  if (event.type === "readRefreshBinding") return canReadRefreshBinding(current) ? readRefreshBinding(current, event.scopeAllowed, event.resourceMatches, event.bothLive) : current;
  if (event.type === "readCodeExchange") return canReadCodeExchange(current) ? readCodeExchange(current, event.result) : current;
  if (event.type === "recordRotation") return canRecordRotation(current) ? recordRotation(current, event.result) : current;
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
  if (raw.type === "readCode" && typeof raw.clientMatches === "boolean" && typeof raw.used === "boolean" && typeof raw.live === "boolean") return { type: "readCode", clientMatches: raw.clientMatches, used: raw.used, live: raw.live };
  if (raw.type === "readCodeBinding" && typeof raw.redirectMatches === "boolean" && typeof raw.verifierMatches === "boolean" && typeof raw.resourceMatches === "boolean") return { type: "readCodeBinding", redirectMatches: raw.redirectMatches, verifierMatches: raw.verifierMatches, resourceMatches: raw.resourceMatches };
  if (raw.type === "readRefresh" && typeof raw.refreshMatches === "boolean") return { type: "readRefresh", refreshMatches: raw.refreshMatches };
  if (raw.type === "readGrant" && typeof raw.grantLive === "boolean") return { type: "readGrant", grantLive: raw.grantLive };
  if (raw.type === "readAuthority" && typeof raw.credentialLive === "boolean" && (raw.authority === "Current" || raw.authority === "Invalid" || raw.authority === "Unavailable")) return { type: "readAuthority", credentialLive: raw.credentialLive, authority: raw.authority };
  if (raw.type === "readRefreshBinding" && typeof raw.scopeAllowed === "boolean" && typeof raw.resourceMatches === "boolean" && typeof raw.bothLive === "boolean") return { type: "readRefreshBinding", scopeAllowed: raw.scopeAllowed, resourceMatches: raw.resourceMatches, bothLive: raw.bothLive };
  if (raw.type === "readCodeExchange" && (raw.result === "CodeNotCommitted" || raw.result === "CodeAlreadyUsed" || raw.result === "CodePairCommitted")) return { type: "readCodeExchange", result: raw.result };
  if (raw.type === "recordRotation" && (raw.result === "RefreshNotCommitted" || raw.result === "RefreshAlreadyUsed" || raw.result === "RefreshPairCommitted")) return { type: "recordRotation", result: raw.result };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Beginning" || raw.phase === "CheckingCodeBinding" || raw.phase === "CheckingGrant" || raw.phase === "CheckingAuthority" || raw.phase === "CheckingRefreshBinding" || raw.phase === "AwaitingConsumption" || raw.phase === "AwaitingRotation" || raw.phase === "TokensReady" || raw.phase === "RevokeGrant" || raw.phase === "Refused" || raw.phase === "RetryAuthority") && (raw.reason === "NoReason" || raw.reason === "InvalidGrant" || raw.reason === "CodeExpired" || raw.reason === "RedirectMismatch" || raw.reason === "VerifierMismatch" || raw.reason === "InvalidScope" || raw.reason === "InvalidTarget") && typeof raw.refresh === "boolean" && Object.keys(raw).length === 3)) return undefined;
  const parsed: TokenFlow = ({ phase: raw.phase, reason: raw.reason, refresh: raw.refresh });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): TokenFlow {
  //@ ensures inv(\result)
  return initial;
}
