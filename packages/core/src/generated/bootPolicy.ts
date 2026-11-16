// GENERATED from spec/bootPolicy.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Start the service with its declared configuration / An explicit environment takes precedence and local shortcuts require dev (spec/bootPolicy.md:9) */
export type Environment = "Production" | "Staging" | "Dev" | "Undeclared";
/** Story: Start the service with its declared configuration / The network service entry checks provider, review, storage and secret configuration (spec/bootPolicy.md:37) */
export interface NetworkBoot { environmentMissing: boolean; devConflict: boolean; checkDeployed: boolean; turnstileMissing: boolean; databaseMissing: boolean; proxyShort: boolean; hashShort: boolean; sessionShort: boolean; reviewInvalid: boolean }
/** Story: Start the service with its declared configuration / The network service entry checks provider, review, storage and secret configuration (spec/bootPolicy.md:37) */
export interface NetworkBootFacts { environment: Environment; production: boolean; turnstile: boolean; database: boolean; proxyLength: number; hashLength: number; sessionLength: number; review: string; reviewSet: boolean }
/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md:67) */
export interface BackendBoot { deployed: boolean; databaseMissing: boolean; turnstileMissing: boolean; proxyMissing: boolean; hashMissing: boolean; proxyShort: boolean; hashShort: boolean; leakKeyShort: boolean; migrationMissing: boolean; sharedLogin: boolean }
/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md:67) */
export interface BackendBootFacts { environment: Environment; database: boolean; migrate: boolean; migrationUrl: boolean; sameLoginUrl: boolean; turnstile: boolean; proxyLength: number; hashLength: number; leakKeyBytes: number }
/** Story: Start the service with its declared configuration / A deployed service lets each agent signup skill finish (spec/bootPolicy.md:98) */
export interface AgentSignupFacts { environment: Environment; phoneCodeOnly: boolean; blooioCodes: boolean; cloudSignIn: boolean }
/** Story: Start the service with its declared configuration / A deployed service login must be a restricted database role (spec/bootPolicy.md:118) */
export type LoginCheck = "MissingRole" | "Superuser" | "BypassRls" | "OwnsTables" | "RestrictedRole";

/** Story: Start the service with its declared configuration / The network service entry checks provider, review, storage and secret configuration (spec/bootPolicy.md:37) */
export const minimumSecretLength: number = 32;

/** Story: Start the service with its declared configuration / An explicit environment takes precedence and local shortcuts require dev (spec/bootPolicy.md:9) */
//@ pure
export function productionDeclared(platform: string, node: string): boolean {
  return platform === "production" || node === "production";
}

/** Story: Start the service with its declared configuration / An explicit environment takes precedence and local shortcuts require dev (spec/bootPolicy.md:9) */
//@ pure
export function deployedEnvironment(environment: Environment): boolean {
  return environment === "Production" || environment === "Staging";
}

/** Story: Start the service with its declared configuration / An explicit environment takes precedence and local shortcuts require dev (spec/bootPolicy.md:9) */
//@ pure
export function declaredEnvironment(platform: string, node: string): Environment {
  return platform === "production" ? "Production" : (platform === "staging" ? "Staging" : (platform === "dev" ? "Dev" : (platform !== "" ? "Undeclared" : (node === "production" ? "Production" : (node === "test" ? "Dev" : "Undeclared")))));
}

/** Story: Start the service with its declared configuration / An explicit environment takes precedence and local shortcuts require dev (spec/bootPolicy.md:9) */
//@ pure
export function devShortcuts(platform: string, node: string): boolean {
  return declaredEnvironment(platform, node) === "Dev" && !productionDeclared(platform, node);
}

/** Story: Start the service with its declared configuration / An explicit environment takes precedence and local shortcuts require dev (spec/bootPolicy.md:9) */
//@ pure
export function lawProductionDisallowsDev(platform: string): boolean {
  //@ ensures \result === true
  return !devShortcuts(platform, "production");
}

/** Story: Start the service with its declared configuration / The network service entry checks provider, review, storage and secret configuration (spec/bootPolicy.md:37) */
//@ pure
export function networkBoot(facts: NetworkBootFacts): NetworkBoot {
  return { environmentMissing: facts.environment === "Undeclared", devConflict: facts.environment === "Dev" && facts.production, checkDeployed: deployedEnvironment(facts.environment), turnstileMissing: !facts.turnstile, databaseMissing: !facts.database, proxyShort: facts.proxyLength < minimumSecretLength, hashShort: facts.hashLength < minimumSecretLength, sessionShort: facts.sessionLength < minimumSecretLength, reviewInvalid: facts.reviewSet && facts.review !== "human" };
}

/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md:67) */
//@ pure
export function backendBoot(facts: BackendBootFacts): BackendBoot {
  const local_0 = deployedEnvironment(facts.environment);
  return { deployed: local_0, databaseMissing: !facts.database, turnstileMissing: local_0 && !facts.turnstile, proxyMissing: local_0 && facts.proxyLength === 0, hashMissing: local_0 && facts.hashLength === 0, proxyShort: facts.proxyLength > 0 && facts.proxyLength < minimumSecretLength, hashShort: local_0 && facts.hashLength < minimumSecretLength, leakKeyShort: local_0 && facts.leakKeyBytes < minimumSecretLength, migrationMissing: local_0 && facts.migrate && !facts.migrationUrl, sharedLogin: local_0 && facts.sameLoginUrl };
}

/** Story: Start the service with its declared configuration / A deployed service lets each agent signup skill finish (spec/bootPolicy.md:98) */
//@ pure
export function agentSignupBlocked(facts: AgentSignupFacts): boolean {
  return deployedEnvironment(facts.environment) && !facts.cloudSignIn && (!facts.phoneCodeOnly || !facts.blooioCodes);
}

/** Story: Start the service with its declared configuration / A deployed service lets each agent signup skill finish (spec/bootPolicy.md:98) */
//@ pure
export function lawDevNeverBlocksAgentSignup(phoneCodeOnly: boolean, blooioCodes: boolean, cloudSignIn: boolean): boolean {
  //@ ensures \result === true
  return !agentSignupBlocked(({ environment: "Dev", phoneCodeOnly: phoneCodeOnly, blooioCodes: blooioCodes, cloudSignIn: cloudSignIn } as AgentSignupFacts));
}

/** Story: Start the service with its declared configuration / A deployed service lets each agent signup skill finish (spec/bootPolicy.md:98) */
//@ pure
export function lawDeployedAgentSignupNeedsPhoneCodes(environment: Environment, phoneCodeOnly: boolean, blooioCodes: boolean): boolean {
  //@ ensures \result === true
  return !(deployedEnvironment(environment) && !agentSignupBlocked(({ environment: environment, phoneCodeOnly: phoneCodeOnly, blooioCodes: blooioCodes, cloudSignIn: false } as AgentSignupFacts))) || (phoneCodeOnly && blooioCodes);
}

/** Story: Start the service with its declared configuration / A deployed service login must be a restricted database role (spec/bootPolicy.md:118) */
//@ pure
export function databaseLogin(rolePresent: boolean, superuser: boolean, bypass: boolean, owner: boolean): LoginCheck {
  return !rolePresent ? "MissingRole" : (superuser ? "Superuser" : (bypass ? "BypassRls" : (owner ? "OwnsTables" : "RestrictedRole")));
}

/** Story: Start the service with its declared configuration / A deployed service login must be a restricted database role (spec/bootPolicy.md:118) */
//@ pure
export function lawRestrictedRoleHasNoElevatedPrivileges(rolePresent: boolean, superuser: boolean, bypass: boolean, owner: boolean): boolean {
  //@ ensures \result === true
  return !(databaseLogin(rolePresent, superuser, bypass, owner) === "RestrictedRole") || (rolePresent && !superuser && !bypass && !owner);
}
