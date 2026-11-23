// GENERATED from spec/bootPolicy.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Start the service with its declared configuration / An explicit environment takes precedence and local shortcuts require dev (spec/bootPolicy.md) */
export type Environment = "Production" | "Staging" | "Dev" | "Undeclared";
/** Story: Start the service with its declared configuration / Both entries apply one rule to the session secret, the model provider and the dev-only switches (spec/bootPolicy.md) */
export interface SharedBoot { deployed: boolean; devConflict: boolean; sessionMissing: boolean; sessionShort: boolean; sessionReused: boolean; modelProviderMissing: boolean; devSwitchSet: boolean }
/** Story: Start the service with its declared configuration / Both entries apply one rule to the session secret, the model provider and the dev-only switches (spec/bootPolicy.md) */
export interface SharedBootFacts { environment: Environment; production: boolean; sessionLength: number; sessionIsHashKey: boolean; modelProvider: boolean; devSwitch: boolean }
/** Story: Start the service with its declared configuration / The network service entry checks provider, model provider, storage and secret configuration (spec/bootPolicy.md) */
export interface NetworkBoot { environmentMissing: boolean; devConflict: boolean; checkDeployed: boolean; turnstileMissing: boolean; databaseMissing: boolean; proxyShort: boolean; hashShort: boolean; sessionShort: boolean; sessionReused: boolean; modelProviderMissing: boolean; devSwitchSet: boolean }
/** Story: Start the service with its declared configuration / The network service entry checks provider, model provider, storage and secret configuration (spec/bootPolicy.md) */
export interface NetworkBootFacts { environment: Environment; production: boolean; turnstile: boolean; database: boolean; proxyLength: number; hashLength: number; sessionLength: number; sessionIsHashKey: boolean; modelProvider: boolean; devSwitch: boolean }
/** Story: Start the service with its declared configuration / Both entries refuse a deployment whose shared line or staff API could not work (spec/bootPolicy.md) */
export interface LineAndStaffProblems { turnSecretShort: boolean; staffTokensMissing: boolean; staffTokenShort: boolean; turnSecretReused: boolean }
/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md) */
export interface BackendBoot { deployed: boolean; devConflict: boolean; databaseMissing: boolean; turnstileMissing: boolean; turnstileSiteMissing: boolean; proxyMissing: boolean; hashMissing: boolean; proxyShort: boolean; hashShort: boolean; sessionMissing: boolean; sessionShort: boolean; sessionReused: boolean; leakKeyShort: boolean; migrationMissing: boolean; sharedLogin: boolean; turnSecretShort: boolean; staffTokensMissing: boolean; staffTokenShort: boolean; publicEventsLoginMissing: boolean; turnSecretReused: boolean; modelProviderMissing: boolean; devSwitchSet: boolean }
/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md) */
export interface BackendBootFacts { environment: Environment; production: boolean; database: boolean; migrate: boolean; migrationUrl: boolean; sameLoginUrl: boolean; turnstile: boolean; turnstileSite: boolean; proxyLength: number; hashLength: number; sessionLength: number; sessionIsHashKey: boolean; leakKeyBytes: number; turnSecretLength: number; staffTokenCount: number; shortestStaffTokenLength: number; publicEventsLogin: boolean; turnSecretIsStaffToken: boolean; modelProvider: boolean; devSwitch: boolean }
/** Story: Start the service with its declared configuration / A deployed backend keeps photos in private storage (spec/bootPolicy.md) */
export type PhotoStorageSetup = "PhotoStorageReady" | "PhotoStorageOff" | "PhotoStorageRefused";
/** Story: Start the service with its declared configuration / Exactly one system answers the carrier's inbound messages (spec/bootPolicy.md) */
export type CarrierInboundOwner = "ElizaGateway" | "BackendWebhook";
/** Story: Start the service with its declared configuration / The configured channel alone decides whether a send is real (spec/bootPolicy.md) */
export type SendChannel = "DryRunChannel" | "BlooioChannel" | "ElizaCloudChannel";
/** Story: Start the service with its declared configuration / A deployed service login must be a restricted database role (spec/bootPolicy.md) */
export type LoginCheck = "MissingRole" | "Superuser" | "BypassRls" | "OwnsTables" | "RestrictedRole";

/** Story: Start the service with its declared configuration / Both entries apply one rule to the session secret, the model provider and the dev-only switches (spec/bootPolicy.md) */
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

/** Story: Start the service with its declared configuration / Both entries apply one rule to the session secret, the model provider and the dev-only switches (spec/bootPolicy.md) */
//@ pure
export function sharedBootRefused(s: SharedBoot): boolean {
  return s.devConflict || s.sessionMissing || s.sessionShort || s.sessionReused || s.modelProviderMissing || s.devSwitchSet;
}

/** Story: Start the service with its declared configuration / Both entries apply one rule to the session secret, the model provider and the dev-only switches (spec/bootPolicy.md) */
//@ pure
export function sharedBoot(facts: SharedBootFacts): SharedBoot {
  const local_0 = deployedEnvironment(facts.environment);
  return { deployed: local_0, devConflict: facts.environment === "Dev" && facts.production, sessionMissing: local_0 && facts.sessionLength === 0, sessionShort: local_0 && facts.sessionLength < minimumSecretLength, sessionReused: local_0 && facts.sessionIsHashKey, modelProviderMissing: local_0 && !facts.modelProvider, devSwitchSet: local_0 && facts.devSwitch };
}

/** Story: Start the service with its declared configuration / The network service entry checks provider, model provider, storage and secret configuration (spec/bootPolicy.md) */
//@ pure
export function networkBootRefused(boot: NetworkBoot): boolean {
  return boot.environmentMissing || boot.devConflict || boot.turnstileMissing || boot.databaseMissing || boot.proxyShort || boot.hashShort || boot.sessionShort || boot.sessionReused || boot.modelProviderMissing || boot.devSwitchSet;
}

/** Story: Start the service with its declared configuration / The network service entry checks provider, model provider, storage and secret configuration (spec/bootPolicy.md) */
//@ pure
export function readyNetworkFacts(environment: Environment): NetworkBootFacts {
  return { environment: environment, production: environment === "Production", turnstile: true, database: true, proxyLength: minimumSecretLength, hashLength: minimumSecretLength, sessionLength: minimumSecretLength, sessionIsHashKey: false, modelProvider: true, devSwitch: false };
}

/** Story: Start the service with its declared configuration / The network service entry checks provider, model provider, storage and secret configuration (spec/bootPolicy.md) */
//@ pure
export function networkBoot(facts: NetworkBootFacts): NetworkBoot {
  const local_1: SharedBoot = sharedBoot(({ environment: facts.environment, production: facts.production, sessionLength: facts.sessionLength, sessionIsHashKey: facts.sessionIsHashKey, modelProvider: facts.modelProvider, devSwitch: facts.devSwitch } as SharedBootFacts));
  return { environmentMissing: facts.environment === "Undeclared", devConflict: local_1.devConflict, checkDeployed: local_1.deployed, turnstileMissing: local_1.deployed && !facts.turnstile, databaseMissing: local_1.deployed && !facts.database, proxyShort: local_1.deployed && facts.proxyLength < minimumSecretLength, hashShort: local_1.deployed && facts.hashLength < minimumSecretLength, sessionShort: local_1.sessionShort, sessionReused: local_1.sessionReused, modelProviderMissing: local_1.modelProviderMissing, devSwitchSet: local_1.devSwitchSet };
}

/** Story: Start the service with its declared configuration / The network service entry checks provider, model provider, storage and secret configuration (spec/bootPolicy.md) */
//@ pure
export function lawDeployedServiceHasOwnSessionSecret(environment: Environment, sessionLength: number, sessionIsHashKey: boolean): boolean {
  //@ ensures \result === true
  const local_2: NetworkBootFacts = readyNetworkFacts(environment);
  const local_3: NetworkBootFacts = { ...local_2, sessionLength: sessionLength, sessionIsHashKey: sessionIsHashKey };
  return !(deployedEnvironment(environment) && !networkBootRefused(networkBoot(local_3))) || (sessionLength >= minimumSecretLength && !sessionIsHashKey);
}

/** Story: Start the service with its declared configuration / The network service entry checks provider, model provider, storage and secret configuration (spec/bootPolicy.md) */
//@ pure
export function lawReadyServiceStarts(environment: Environment): boolean {
  //@ ensures \result === true
  return !(environment !== "Undeclared") || !networkBootRefused(networkBoot(readyNetworkFacts(environment)));
}

/** Story: Start the service with its declared configuration / The network service entry checks provider, model provider, storage and secret configuration (spec/bootPolicy.md) */
//@ pure
export function lawDeployedBootNeedsModelProvider(environment: Environment): boolean {
  //@ ensures \result === true
  return !deployedEnvironment(environment) || networkBootRefused(networkBoot(({ ...readyNetworkFacts(environment), modelProvider: false } as NetworkBootFacts)));
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
  return boot.devConflict || boot.databaseMissing || boot.turnstileMissing || boot.turnstileSiteMissing || boot.proxyMissing || boot.hashMissing || boot.proxyShort || boot.hashShort || boot.sessionMissing || boot.sessionShort || boot.sessionReused || boot.leakKeyShort || boot.migrationMissing || boot.sharedLogin || boot.turnSecretShort || boot.staffTokensMissing || boot.staffTokenShort || boot.publicEventsLoginMissing || boot.turnSecretReused || boot.modelProviderMissing || boot.devSwitchSet;
}

/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md) */
//@ pure
export function readyBackendFacts(environment: Environment): BackendBootFacts {
  return { environment: environment, production: environment === "Production", database: true, migrate: false, migrationUrl: true, sameLoginUrl: false, turnstile: true, turnstileSite: true, proxyLength: minimumSecretLength, hashLength: minimumSecretLength, sessionLength: minimumSecretLength, sessionIsHashKey: false, leakKeyBytes: minimumSecretLength, turnSecretLength: minimumSecretLength, staffTokenCount: 1, shortestStaffTokenLength: minimumSecretLength, publicEventsLogin: true, turnSecretIsStaffToken: false, modelProvider: true, devSwitch: false };
}

/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md) */
//@ pure
export function backendBoot(facts: BackendBootFacts): BackendBoot {
  const local_4: SharedBoot = sharedBoot(({ environment: facts.environment, production: facts.production, sessionLength: facts.sessionLength, sessionIsHashKey: facts.sessionIsHashKey, modelProvider: facts.modelProvider, devSwitch: facts.devSwitch } as SharedBootFacts));
  const local_5 = local_4.deployed;
  const local_6: LineAndStaffProblems = lineAndStaffProblems(local_5, facts.turnSecretLength, facts.staffTokenCount, facts.shortestStaffTokenLength, facts.turnSecretIsStaffToken);
  return { deployed: local_5, devConflict: local_4.devConflict, databaseMissing: !facts.database, turnstileMissing: local_5 && !facts.turnstile, turnstileSiteMissing: local_5 && !facts.turnstileSite, proxyMissing: local_5 && facts.proxyLength === 0, hashMissing: local_5 && facts.hashLength === 0, proxyShort: facts.proxyLength > 0 && facts.proxyLength < minimumSecretLength, hashShort: local_5 && facts.hashLength < minimumSecretLength, sessionMissing: local_4.sessionMissing, sessionShort: local_4.sessionShort, sessionReused: local_4.sessionReused, leakKeyShort: local_5 && facts.leakKeyBytes < minimumSecretLength, migrationMissing: local_5 && facts.migrate && !facts.migrationUrl, sharedLogin: local_5 && facts.sameLoginUrl, turnSecretShort: local_6.turnSecretShort, staffTokensMissing: local_6.staffTokensMissing, staffTokenShort: local_6.staffTokenShort, publicEventsLoginMissing: local_5 && !facts.publicEventsLogin, turnSecretReused: local_6.turnSecretReused, modelProviderMissing: local_4.modelProviderMissing, devSwitchSet: local_4.devSwitchSet };
}

/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md) */
//@ pure
export function lawDeployedBackendServesSignupLineAndStaff(environment: Environment, turnstileSite: boolean, turnSecretLength: number, staffTokenCount: number, shortestStaffTokenLength: number): boolean {
  //@ ensures \result === true
  const local_7: BackendBootFacts = readyBackendFacts(environment);
  const local_8: BackendBootFacts = { ...local_7, turnstileSite: turnstileSite, turnSecretLength: turnSecretLength, staffTokenCount: staffTokenCount, shortestStaffTokenLength: shortestStaffTokenLength };
  return !(deployedEnvironment(environment) && !backendBootRefused(backendBoot(local_8))) || (turnstileSite && turnSecretLength >= minimumSecretLength && staffTokenCount > 0 && shortestStaffTokenLength >= minimumSecretLength);
}

/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md) */
//@ pure
export function lawDeployedBackendHasOwnSessionSecret(environment: Environment, sessionLength: number, sessionIsHashKey: boolean): boolean {
  //@ ensures \result === true
  const local_9: BackendBootFacts = readyBackendFacts(environment);
  const local_10: BackendBootFacts = { ...local_9, sessionLength: sessionLength, sessionIsHashKey: sessionIsHashKey };
  return !(deployedEnvironment(environment) && !backendBootRefused(backendBoot(local_10))) || (sessionLength >= minimumSecretLength && !sessionIsHashKey);
}

/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md) */
//@ pure
export function lawBackendRefusesDevThatSaysProduction(database: boolean): boolean {
  //@ ensures \result === true
  const local_11: BackendBootFacts = readyBackendFacts("Dev");
  return backendBootRefused(backendBoot(({ ...local_11, production: true, database: database } as BackendBootFacts)));
}

/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md) */
//@ pure
export function lawReadyBackendStarts(environment: Environment): boolean {
  //@ ensures \result === true
  const local_12: BackendBootFacts = readyBackendFacts(environment);
  return !(environment !== "Undeclared") || !backendBootRefused(backendBoot(local_12));
}

/** Story: Start the service with its declared configuration / The combined backend entry checks its own database, provider and secret configuration (spec/bootPolicy.md) */
//@ pure
export function lawEntriesShareSessionDecision(environment: Environment, sessionLength: number, sessionIsHashKey: boolean, modelProvider: boolean, devSwitch: boolean): boolean {
  //@ ensures \result === true
  const local_13: NetworkBootFacts = readyNetworkFacts(environment);
  const local_14: BackendBootFacts = readyBackendFacts(environment);
  const local_15: NetworkBoot = networkBoot(({ ...local_13, sessionLength: sessionLength, sessionIsHashKey: sessionIsHashKey, modelProvider: modelProvider, devSwitch: devSwitch } as NetworkBootFacts));
  const local_16: BackendBoot = backendBoot(({ ...local_14, sessionLength: sessionLength, sessionIsHashKey: sessionIsHashKey, modelProvider: modelProvider, devSwitch: devSwitch } as BackendBootFacts));
  return local_15.sessionShort === local_16.sessionShort && local_15.sessionReused === local_16.sessionReused && local_15.modelProviderMissing === local_16.modelProviderMissing && local_15.devSwitchSet === local_16.devSwitchSet && local_15.devConflict === local_16.devConflict;
}

/** Story: Start the service with its declared configuration / A deployed backend keeps photos in private storage (spec/bootPolicy.md) */
//@ pure
export function photoStorageSetup(deployed: boolean, storageSet: boolean, storageIsR2: boolean): PhotoStorageSetup {
  return storageIsR2 ? "PhotoStorageReady" : (deployed ? "PhotoStorageRefused" : (storageSet ? "PhotoStorageReady" : "PhotoStorageOff"));
}

/** Story: Start the service with its declared configuration / A deployed backend keeps photos in private storage (spec/bootPolicy.md) */
//@ pure
export function lawDeployedNeedsPrivatePhotoStorage(storageSet: boolean, storageIsR2: boolean): boolean {
  //@ ensures \result === true
  return (photoStorageSetup(true, storageSet, storageIsR2) === "PhotoStorageReady") === storageIsR2;
}

/** Story: Start the service with its declared configuration / A deployed backend keeps photos in private storage (spec/bootPolicy.md) */
//@ pure
export function lawDeployedNeverRunsWithoutPhotos(storageSet: boolean, storageIsR2: boolean): boolean {
  //@ ensures \result === true
  return photoStorageSetup(true, storageSet, storageIsR2) !== "PhotoStorageOff";
}

/** Story: Start the service with its declared configuration / A deployed backend keeps photos in private storage (spec/bootPolicy.md) */
//@ pure
export function lawDevMayRunWithoutPhotos(deployed: boolean): boolean {
  //@ ensures \result === true
  return !(!deployed) || photoStorageSetup(deployed, false, false) === "PhotoStorageOff";
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

/** Story: Start the service with its declared configuration / The configured channel alone decides whether a send is real (spec/bootPolicy.md) */
//@ pure
export function sendChannel(channelSetting: string, dryRunRequested: boolean, isolatedRoute: boolean): SendChannel {
  return dryRunRequested || isolatedRoute ? "DryRunChannel" : (channelSetting === "blooio" ? "BlooioChannel" : (channelSetting === "eliza_cloud" ? "ElizaCloudChannel" : "DryRunChannel"));
}

/** Story: Start the service with its declared configuration / The configured channel alone decides whether a send is real (spec/bootPolicy.md) */
//@ pure
export function channelCredentialsMissing(channel: SendChannel, blooioKey: boolean, senderLine: boolean, cloudOrigin: boolean, turnSecretLength: number): boolean {
  return channel === "BlooioChannel" ? !blooioKey || !senderLine : (channel === "ElizaCloudChannel" ? !cloudOrigin || !senderLine || turnSecretLength < minimumSecretLength : false);
}

/** Story: Start the service with its declared configuration / The configured channel alone decides whether a send is real (spec/bootPolicy.md) */
//@ pure
export function lawUnconfiguredChannelNeverSends(dryRunRequested: boolean, isolatedRoute: boolean): boolean {
  //@ ensures \result === true
  return sendChannel("", dryRunRequested, isolatedRoute) === "DryRunChannel";
}

/** Story: Start the service with its declared configuration / The configured channel alone decides whether a send is real (spec/bootPolicy.md) */
//@ pure
export function lawDryRunRequestAndIsolatedRouteNeverSend(channelSetting: string, dryRunRequested: boolean, isolatedRoute: boolean): boolean {
  //@ ensures \result === true
  return !(dryRunRequested || isolatedRoute) || sendChannel(channelSetting, dryRunRequested, isolatedRoute) === "DryRunChannel";
}

/** Story: Start the service with its declared configuration / The configured channel alone decides whether a send is real (spec/bootPolicy.md) */
//@ pure
export function lawRealChannelHasCredentials(channelSetting: string, blooioKey: boolean, senderLine: boolean, cloudOrigin: boolean, turnSecretLength: number): boolean {
  //@ ensures \result === true
  const local_17: SendChannel = sendChannel(channelSetting, false, false);
  return !(local_17 !== "DryRunChannel" && !channelCredentialsMissing(local_17, blooioKey, senderLine, cloudOrigin, turnSecretLength)) || (senderLine && (local_17 === "BlooioChannel" ? blooioKey : cloudOrigin && turnSecretLength >= minimumSecretLength));
}

/** Story: Start the service with its declared configuration / A deployed entry refuses a partial Workers AI setup, and production needs Workers AI (spec/bootPolicy.md) */
//@ pure
export function workersAiSetupMissing(deployed: boolean, production: boolean, tokenSet: boolean, accountSet: boolean): boolean {
  return (deployed && tokenSet && !accountSet) || (production && !(tokenSet && accountSet));
}

/** Story: Start the service with its declared configuration / A deployed entry refuses a partial Workers AI setup, and production needs Workers AI (spec/bootPolicy.md) */
//@ pure
export function lawDeployedWorkersAiTokenHasAccount(production: boolean, tokenSet: boolean, accountSet: boolean): boolean {
  //@ ensures \result === true
  return !(!workersAiSetupMissing(true, production, tokenSet, accountSet)) || (!tokenSet || accountSet);
}

/** Story: Start the service with its declared configuration / A deployed entry refuses a partial Workers AI setup, and production needs Workers AI (spec/bootPolicy.md) */
//@ pure
export function lawProductionStartsOnlyWithWorkersAi(tokenSet: boolean, accountSet: boolean): boolean {
  //@ ensures \result === true
  return !(!workersAiSetupMissing(true, true, tokenSet, accountSet)) || (tokenSet && accountSet);
}

/** Story: Start the service with its declared configuration / A deployed entry refuses a partial Workers AI setup, and production needs Workers AI (spec/bootPolicy.md) */
//@ pure
export function lawStagingAndDevMayStartWithoutWorkersAi(deployed: boolean): boolean {
  //@ ensures \result === true
  return !workersAiSetupMissing(deployed, false, false, false);
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
