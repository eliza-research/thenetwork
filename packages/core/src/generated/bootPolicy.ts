// GENERATED from spec/bootPolicy.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Start the service with its declared configuration / An explicit environment takes precedence and local shortcuts require dev (spec/bootPolicy.md) */
export type Environment = "Production" | "Staging" | "Dev" | "Undeclared";
/** Story: Start the service with its declared configuration / The network service entry checks provider, review, storage and secret configuration (spec/bootPolicy.md) */
export interface NetworkBoot { environmentMissing: boolean; devConflict: boolean; checkDeployed: boolean; turnstileMissing: boolean; databaseMissing: boolean; proxyShort: boolean; hashShort: boolean; sessionShort: boolean; reviewInvalid: boolean }
/** Story: Start the service with its declared configuration / The network service entry checks provider, review, storage and secret configuration (spec/bootPolicy.md) */
export interface NetworkBootFacts { environment: Environment; production: boolean; turnstile: boolean; database: boolean; proxyLength: number; hashLength: number; sessionLength: number; review: string; reviewSet: boolean }
/** Story: Start the service with its declared configuration / Both entries refuse a deployment whose shared line or staff API could not work (spec/bootPolicy.md) */
export interface LineAndStaffProblems { turnSecretShort: boolean; staffTokensMissing: boolean; staffTokenShort: boolean; turnSecretReused: boolean }
/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md) */
export interface BackendBoot { deployed: boolean; databaseMissing: boolean; turnstileMissing: boolean; turnstileSiteMissing: boolean; proxyMissing: boolean; hashMissing: boolean; proxyShort: boolean; hashShort: boolean; leakKeyShort: boolean; migrationMissing: boolean; sharedLogin: boolean; turnSecretShort: boolean; staffTokensMissing: boolean; staffTokenShort: boolean; publicEventsLoginMissing: boolean; turnSecretReused: boolean }
/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md) */
export interface BackendBootFacts { environment: Environment; database: boolean; migrate: boolean; migrationUrl: boolean; sameLoginUrl: boolean; turnstile: boolean; turnstileSite: boolean; proxyLength: number; hashLength: number; leakKeyBytes: number; turnSecretLength: number; staffTokenCount: number; shortestStaffTokenLength: number; publicEventsLogin: boolean; turnSecretIsStaffToken: boolean }
/** Story: Start the service with its declared configuration / Exactly one system answers the carrier's inbound messages (spec/bootPolicy.md) */
export type CarrierInboundOwner = "ElizaGateway" | "BackendWebhook";
/** Story: Start the service with its declared configuration / A deployed service login must be a restricted database role (spec/bootPolicy.md) */
export type LoginCheck = "MissingRole" | "Superuser" | "BypassRls" | "OwnsTables" | "RestrictedRole";

/** Story: Start the service with its declared configuration / The network service entry checks provider, review, storage and secret configuration (spec/bootPolicy.md) */
export const minimumSecretLength: number = 32;

/** Story: Start the service with its declared configuration / An explicit environment takes precedence and local shortcuts require dev (spec/bootPolicy.md) */
//@ pure
export function productionDeclared(platform: string, node: string): boolean {
  return platform === "production" || node === "production";
}

/** Story: Start the service with its declared configuration / An explicit environment takes precedence and local shortcuts require dev (spec/bootPolicy.md) */
//@ pure
export function deployedEnvironment(environment: Environment): boolean {
  return environment === "Production" || environment === "Staging";
}

/** Story: Start the service with its declared configuration / An explicit environment takes precedence and local shortcuts require dev (spec/bootPolicy.md) */
//@ pure
export function declaredEnvironment(platform: string, node: string): Environment {
  return platform === "production" ? "Production" : (platform === "staging" ? "Staging" : (platform === "dev" ? "Dev" : (platform !== "" ? "Undeclared" : (node === "production" ? "Production" : (node === "test" ? "Dev" : "Undeclared")))));
}

/** Story: Start the service with its declared configuration / An explicit environment takes precedence and local shortcuts require dev (spec/bootPolicy.md) */
//@ pure
export function devShortcuts(platform: string, node: string): boolean {
  return declaredEnvironment(platform, node) === "Dev" && !productionDeclared(platform, node);
}

/** Story: Start the service with its declared configuration / An explicit environment takes precedence and local shortcuts require dev (spec/bootPolicy.md) */
//@ pure
export function lawProductionDisallowsDev(platform: string, node: string): boolean {
  //@ ensures \result === true
  return !devShortcuts(platform, "production") && !devShortcuts("production", node);
}

/** Story: Start the service with its declared configuration / The network service entry checks provider, review, storage and secret configuration (spec/bootPolicy.md) */
//@ pure
export function networkBoot(facts: NetworkBootFacts): NetworkBoot {
  return { environmentMissing: facts.environment === "Undeclared", devConflict: facts.environment === "Dev" && facts.production, checkDeployed: deployedEnvironment(facts.environment), turnstileMissing: !facts.turnstile, databaseMissing: !facts.database, proxyShort: facts.proxyLength < minimumSecretLength, hashShort: facts.hashLength < minimumSecretLength, sessionShort: facts.sessionLength < minimumSecretLength, reviewInvalid: facts.reviewSet && facts.review !== "human" };
}

/** Story: Start the service with its declared configuration / Both entries refuse a deployment whose shared line or staff API could not work (spec/bootPolicy.md) */
//@ pure
export function lineAndStaffProblems(deployed: boolean, turnSecretLength: number, staffTokenCount: number, shortestStaffTokenLength: number, turnSecretIsStaffToken: boolean): LineAndStaffProblems {
  return { turnSecretShort: deployed && turnSecretLength < minimumSecretLength, staffTokensMissing: deployed && staffTokenCount <= 0, staffTokenShort: deployed && staffTokenCount > 0 && shortestStaffTokenLength < minimumSecretLength, turnSecretReused: deployed && turnSecretIsStaffToken };
}

/** Story: Start the service with its declared configuration / Both entries refuse a deployment whose shared line or staff API could not work (spec/bootPolicy.md) */
//@ pure
export function lineAndStaffRefused(p: LineAndStaffProblems): boolean {
  return p.turnSecretShort || p.staffTokensMissing || p.staffTokenShort || p.turnSecretReused;
}

/** Story: Start the service with its declared configuration / Both entries refuse a deployment whose shared line or staff API could not work (spec/bootPolicy.md) */
//@ pure
export function lawDeployedEntryHasLineAndStaffSecrets(environment: Environment, turnSecretLength: number, staffTokenCount: number, shortestStaffTokenLength: number, turnSecretIsStaffToken: boolean): boolean {
  //@ ensures \result === true
  return !(deployedEnvironment(environment) && !lineAndStaffRefused(lineAndStaffProblems(true, turnSecretLength, staffTokenCount, shortestStaffTokenLength, turnSecretIsStaffToken))) || (turnSecretLength >= minimumSecretLength && staffTokenCount > 0 && shortestStaffTokenLength >= minimumSecretLength && !turnSecretIsStaffToken);
}

/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md) */
//@ pure
export function backendBootRefused(boot: BackendBoot): boolean {
  return boot.databaseMissing || boot.turnstileMissing || boot.turnstileSiteMissing || boot.proxyMissing || boot.hashMissing || boot.proxyShort || boot.hashShort || boot.leakKeyShort || boot.migrationMissing || boot.sharedLogin || boot.turnSecretShort || boot.staffTokensMissing || boot.staffTokenShort || boot.publicEventsLoginMissing || boot.turnSecretReused;
}

/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md) */
//@ pure
export function backendBoot(facts: BackendBootFacts): BackendBoot {
  const local_0 = deployedEnvironment(facts.environment);
  const local_1: LineAndStaffProblems = lineAndStaffProblems(local_0, facts.turnSecretLength, facts.staffTokenCount, facts.shortestStaffTokenLength, facts.turnSecretIsStaffToken);
  return { deployed: local_0, databaseMissing: !facts.database, turnstileMissing: local_0 && !facts.turnstile, turnstileSiteMissing: local_0 && !facts.turnstileSite, proxyMissing: local_0 && facts.proxyLength === 0, hashMissing: local_0 && facts.hashLength === 0, proxyShort: facts.proxyLength > 0 && facts.proxyLength < minimumSecretLength, hashShort: local_0 && facts.hashLength < minimumSecretLength, leakKeyShort: local_0 && facts.leakKeyBytes < minimumSecretLength, migrationMissing: local_0 && facts.migrate && !facts.migrationUrl, sharedLogin: local_0 && facts.sameLoginUrl, turnSecretShort: local_1.turnSecretShort, staffTokensMissing: local_1.staffTokensMissing, staffTokenShort: local_1.staffTokenShort, publicEventsLoginMissing: local_0 && !facts.publicEventsLogin, turnSecretReused: local_1.turnSecretReused };
}

/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md) */
//@ pure
export function lawDeployedBackendServesSignupLineAndStaff(environment: Environment, turnstileSite: boolean, turnSecretLength: number, staffTokenCount: number, shortestStaffTokenLength: number): boolean {
  //@ ensures \result === true
  const local_2: BackendBootFacts = { environment: environment, database: true, migrate: false, migrationUrl: true, sameLoginUrl: false, turnstile: true, turnstileSite: turnstileSite, proxyLength: minimumSecretLength, hashLength: minimumSecretLength, leakKeyBytes: minimumSecretLength, turnSecretLength: turnSecretLength, staffTokenCount: staffTokenCount, shortestStaffTokenLength: shortestStaffTokenLength, publicEventsLogin: true, turnSecretIsStaffToken: false };
  return !(deployedEnvironment(environment) && !backendBootRefused(backendBoot(local_2))) || (turnstileSite && turnSecretLength >= minimumSecretLength && staffTokenCount > 0 && shortestStaffTokenLength >= minimumSecretLength);
}

/** Story: Start the service with its declared configuration / Exactly one system answers the carrier's inbound messages (spec/bootPolicy.md) */
//@ pure
export function carrierInboundOwner(channelSetting: string): CarrierInboundOwner {
  return channelSetting === "eliza_cloud" ? "ElizaGateway" : "BackendWebhook";
}

/** Story: Start the service with its declared configuration / Exactly one system answers the carrier's inbound messages (spec/bootPolicy.md) */
//@ pure
export function backendWebhookServed(channelSetting: string): boolean {
  return carrierInboundOwner(channelSetting) === "BackendWebhook";
}

/** Story: Start the service with its declared configuration / Exactly one system answers the carrier's inbound messages (spec/bootPolicy.md) */
//@ pure
export function lawGatewayClosesBackendWebhook(channelSetting: string): boolean {
  //@ ensures \result === true
  return !(carrierInboundOwner(channelSetting) === "ElizaGateway") || !backendWebhookServed(channelSetting);
}

/** Story: Start the service with its declared configuration / A deployed service login must be a restricted database role (spec/bootPolicy.md) */
//@ pure
export function databaseLogin(rolePresent: boolean, superuser: boolean, bypass: boolean, owner: boolean): LoginCheck {
  return !rolePresent ? "MissingRole" : (superuser ? "Superuser" : (bypass ? "BypassRls" : (owner ? "OwnsTables" : "RestrictedRole")));
}

/** Story: Start the service with its declared configuration / A deployed service login must be a restricted database role (spec/bootPolicy.md) */
//@ pure
export function lawRestrictedRoleHasNoElevatedPrivileges(rolePresent: boolean, superuser: boolean, bypass: boolean, owner: boolean): boolean {
  //@ ensures \result === true
  return !(databaseLogin(rolePresent, superuser, bypass, owner) === "RestrictedRole") || (rolePresent && !superuser && !bypass && !owner);
}
