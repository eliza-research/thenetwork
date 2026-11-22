# Runtime startup configuration

The [service start model](models/boot_config.md) includes database setup, process restarts and Pages proxy rotation. These generated rules decide which environment and local shortcuts apply, and which facts each startup gate requires. The entry points read environment variables and database role metadata and render the errors. In staging and production, both entry points also ask the OTP adapter for its provider problems (an explicit OTP provider and its provider-specific credentials), and both entry points list each dev-only switch (`PLATFORM_DEV_*`) that is set as a problem.

## Story: Start the service with its declared configuration

> As an operator, I want the service to use the declared environment and show which startup requirements are missing.

### An explicit environment takes precedence and local shortcuts require dev

Use a recognized nonempty `PLATFORM_ENV`. An unrecognized explicit value leaves the environment undeclared. If the value is absent or empty, `NODE_ENV=production` means production and `NODE_ENV=test` means dev. Local shortcuts require declared dev with neither variable saying production.

```quint
type Environment = Production | Staging | Dev | Undeclared

pure def declaredEnvironment(platform: str, node: str): Environment =
  if (platform == "production") Production
  else if (platform == "staging") Staging
  else if (platform == "dev") Dev
  else if (platform != "") Undeclared
  else if (node == "production") Production
  else if (node == "test") Dev
  else Undeclared

pure def productionDeclared(platform: str, node: str): bool =
  platform == "production" or node == "production"

pure def devShortcuts(platform: str, node: str): bool =
  declaredEnvironment(platform, node) == Dev and not(productionDeclared(platform, node))

pure def deployedEnvironment(environment: Environment): bool =
  environment == Production or environment == Staging

pure def lawProductionDisallowsDev(platform: str, node: str): bool =
  not(devShortcuts(platform, "production")) and not(devShortcuts("production", node))
```

### Both entries apply one rule to the session secret, the review setting and the dev-only switches

Both entries, `main.ts` and the combined backend, refuse a dev declaration combined with production in every environment. In staging and production both entries need a session secret with the secret character limit that is not the hash key, refuse a supplied review setting other than human, and refuse a set dev-only switch (`PLATFORM_DEV_*`). Changed (review): this rule is new and both entries take these decisions from it, because before it `main.ts` let the session secret be the hash key, so website sessions and the Cloud cookie seal used the phone-hash key, while the combined backend refused that value.

```quint
pure val minimumSecretLength: int = 32

type SharedBootFacts = {
  environment: Environment, production: bool, sessionLength: int, sessionIsHashKey: bool,
  review: str, reviewSet: bool, devSwitch: bool
}

type SharedBoot = {
  deployed: bool, devConflict: bool, sessionMissing: bool, sessionShort: bool, sessionReused: bool,
  reviewInvalid: bool, devSwitchSet: bool
}

pure def sharedBoot(facts: SharedBootFacts): SharedBoot = {
  val deployed = deployedEnvironment(facts.environment)
  {
    deployed: deployed,
    devConflict: facts.environment == Dev and facts.production,
    sessionMissing: deployed and facts.sessionLength == 0,
    sessionShort: deployed and facts.sessionLength < minimumSecretLength,
    sessionReused: deployed and facts.sessionIsHashKey,
    reviewInvalid: deployed and facts.reviewSet and facts.review != "human",
    devSwitchSet: deployed and facts.devSwitch
  }
}

pure def sharedBootRefused(s: SharedBoot): bool =
  s.devConflict or s.sessionMissing or s.sessionShort or s.sessionReused or s.reviewInvalid or s.devSwitchSet
```

### The network service entry checks provider, review, storage and secret configuration

`main.ts` requires a declared environment. Staging and production require a Turnstile secret, the service database, and the proxy and hash secrets with the secret character limit. The session secret, the review setting, the dev conflict and the dev-only switches come from the shared rule above. `main.ts` refuses exactly when `networkBootRefused` is true or the OTP adapter reports a problem. Changed (review): the session secret must not be the hash key, and the dev-only switch decision moved from the entry into this rule, because the shared rule now owns both for both entries.

```quint
type NetworkBootFacts = {
  environment: Environment, production: bool, turnstile: bool, database: bool,
  proxyLength: int, hashLength: int, sessionLength: int, sessionIsHashKey: bool,
  review: str, reviewSet: bool, devSwitch: bool
}

type NetworkBoot = {
  environmentMissing: bool, devConflict: bool, checkDeployed: bool, turnstileMissing: bool,
  databaseMissing: bool, proxyShort: bool, hashShort: bool, sessionShort: bool, sessionReused: bool,
  reviewInvalid: bool, devSwitchSet: bool
}

pure def networkBoot(facts: NetworkBootFacts): NetworkBoot = {
  val shared = sharedBoot({
    environment: facts.environment, production: facts.production, sessionLength: facts.sessionLength,
    sessionIsHashKey: facts.sessionIsHashKey, review: facts.review, reviewSet: facts.reviewSet, devSwitch: facts.devSwitch
  })
  {
    environmentMissing: facts.environment == Undeclared,
    devConflict: shared.devConflict,
    checkDeployed: shared.deployed,
    turnstileMissing: shared.deployed and not(facts.turnstile),
    databaseMissing: shared.deployed and not(facts.database),
    proxyShort: shared.deployed and facts.proxyLength < minimumSecretLength,
    hashShort: shared.deployed and facts.hashLength < minimumSecretLength,
    sessionShort: shared.sessionShort,
    sessionReused: shared.sessionReused,
    reviewInvalid: shared.reviewInvalid,
    devSwitchSet: shared.devSwitchSet
  }
}

pure def networkBootRefused(boot: NetworkBoot): bool =
  boot.environmentMissing or boot.devConflict or boot.turnstileMissing or boot.databaseMissing or boot.proxyShort or
    boot.hashShort or boot.sessionShort or boot.sessionReused or boot.reviewInvalid or boot.devSwitchSet

pure def readyNetworkFacts(environment: Environment): NetworkBootFacts = {
  environment: environment, production: environment == Production, turnstile: true, database: true,
  proxyLength: minimumSecretLength, hashLength: minimumSecretLength, sessionLength: minimumSecretLength,
  sessionIsHashKey: false, review: "human", reviewSet: false, devSwitch: false
}

pure def lawDeployedServiceHasOwnSessionSecret(environment: Environment, sessionLength: int, sessionIsHashKey: bool): bool =
  val ready = readyNetworkFacts(environment)
  val facts = { ...ready, sessionLength: sessionLength, sessionIsHashKey: sessionIsHashKey }
  (deployedEnvironment(environment) and not(networkBootRefused(networkBoot(facts)))) implies
    (sessionLength >= minimumSecretLength and not(sessionIsHashKey))

pure def lawReadyServiceStarts(environment: Environment): bool =
  environment != Undeclared implies not(networkBootRefused(networkBoot(readyNetworkFacts(environment))))
```

### Both entries refuse a deployment whose shared line or staff API could not work

In staging and production both entries, `main.ts` and the combined backend, need the Eliza turn secret and at least one staff token, and the turn secret and every staff token have the secret character limit. The turn secret must not also be a staff token. Changed (review): this rule is new. Before it, `main.ts` only warned when the turn secret or the staff tokens were missing, so the shared line and every staff review answered errors; a staff token count of zero or less counts as missing, because a check for exactly zero let a negative count through; and the Eliza Cloud side holds the turn secret, so it must not get staff access with it.

```quint
type LineAndStaffProblems = { turnSecretShort: bool, staffTokensMissing: bool, staffTokenShort: bool, turnSecretReused: bool }

pure def lineAndStaffProblems(deployed: bool, turnSecretLength: int, staffTokenCount: int, shortestStaffTokenLength: int, turnSecretIsStaffToken: bool): LineAndStaffProblems = {
  turnSecretShort: deployed and turnSecretLength < minimumSecretLength,
  staffTokensMissing: deployed and staffTokenCount <= 0,
  staffTokenShort: deployed and staffTokenCount > 0 and shortestStaffTokenLength < minimumSecretLength,
  turnSecretReused: deployed and turnSecretIsStaffToken
}

pure def lineAndStaffRefused(p: LineAndStaffProblems): bool =
  p.turnSecretShort or p.staffTokensMissing or p.staffTokenShort or p.turnSecretReused

pure val turnSecretLengthValues = Set(0, minimumSecretLength - 1, minimumSecretLength)
pure val shortestStaffTokenLengthValues = Set(0, minimumSecretLength - 1, minimumSecretLength)
pure val staffTokenCountValues = Set(-1, 0, 1, 2)

pure def lawDeployedEntryHasLineAndStaffSecrets(environment: Environment, turnSecretLength: int, staffTokenCount: int, shortestStaffTokenLength: int, turnSecretIsStaffToken: bool): bool =
  (deployedEnvironment(environment) and
    not(lineAndStaffRefused(lineAndStaffProblems(true, turnSecretLength, staffTokenCount, shortestStaffTokenLength, turnSecretIsStaffToken)))) implies
    (turnSecretLength >= minimumSecretLength and staffTokenCount > 0 and
      shortestStaffTokenLength >= minimumSecretLength and not(turnSecretIsStaffToken))
```

### The combined backend entry checks its own database, provider and secret configuration

The combined backend needs a database in every environment. It refuses a dev declaration combined with production in every environment. Staging and production also need proxy configuration, a Turnstile secret and a Turnstile site key, a hash key, a session secret, a leak-label key, the Eliza turn secret, at least one staff token, and the public event catalog's ingest login. A supplied proxy secret must meet the character limit in every environment. The deployed hash key, session secret, turn secret and every staff token have the same character limit. The deployed session secret must not be the hash key. The leak-label key limit is in UTF-8 bytes. In staging and production a supplied review setting must be human, and no dev-only switch (`PLATFORM_DEV_*`) may be set. A deployed backend that migrates at startup needs a migration URL. A supplied deployed migration URL must differ from the service URL. Changed: a deployed backend now also refuses to start without the Turnstile site key, the turn secret or a strong staff token, because without them the agent signup connector, the shared line and every staff review answered errors while health stayed green; it also needs the ingest login, because the scheduled catalog refresh runs as that login. The turn secret and staff token checks are the shared rule above. Changed (review): those four checks now come from the shared rule, so `main.ts` and the combined backend refuse the same secrets. Changed: the combined backend now also needs its own session secret, refuses dev that says production, a review setting other than human and a dev-only switch, because before this change the backend kept website sessions under the hash key with no log line and started where `main.ts` and the [service start model](models/boot_config.md) refuse. Changed (review): those decisions now come from the shared session, review and dev-switch rule above, so the two entries cannot drift apart; the combined backend refuses exactly when `backendBootRefused` is true or the OTP adapter reports a problem, and `main.ts` refuses exactly when `networkBootRefused` or `lineAndStaffRefused` is true or the OTP adapter reports a problem.

```quint
type BackendBootFacts = {
  environment: Environment, production: bool, database: bool, migrate: bool, migrationUrl: bool, sameLoginUrl: bool,
  turnstile: bool, turnstileSite: bool, proxyLength: int, hashLength: int, sessionLength: int, sessionIsHashKey: bool,
  leakKeyBytes: int, turnSecretLength: int, staffTokenCount: int, shortestStaffTokenLength: int, publicEventsLogin: bool,
  turnSecretIsStaffToken: bool, review: str, reviewSet: bool, devSwitch: bool
}

type BackendBoot = {
  deployed: bool, devConflict: bool, databaseMissing: bool, turnstileMissing: bool, turnstileSiteMissing: bool, proxyMissing: bool,
  hashMissing: bool, proxyShort: bool, hashShort: bool, sessionMissing: bool, sessionShort: bool, sessionReused: bool,
  leakKeyShort: bool, migrationMissing: bool, sharedLogin: bool,
  turnSecretShort: bool, staffTokensMissing: bool, staffTokenShort: bool, publicEventsLoginMissing: bool,
  turnSecretReused: bool, reviewInvalid: bool, devSwitchSet: bool
}

pure def backendBoot(facts: BackendBootFacts): BackendBoot = {
  val shared = sharedBoot({
    environment: facts.environment, production: facts.production, sessionLength: facts.sessionLength,
    sessionIsHashKey: facts.sessionIsHashKey, review: facts.review, reviewSet: facts.reviewSet, devSwitch: facts.devSwitch
  })
  val deployed = shared.deployed
  val secrets = lineAndStaffProblems(deployed, facts.turnSecretLength, facts.staffTokenCount, facts.shortestStaffTokenLength, facts.turnSecretIsStaffToken)
  {
    deployed: deployed,
    devConflict: shared.devConflict,
    databaseMissing: not(facts.database),
    turnstileMissing: deployed and not(facts.turnstile),
    turnstileSiteMissing: deployed and not(facts.turnstileSite),
    proxyMissing: deployed and facts.proxyLength == 0,
    hashMissing: deployed and facts.hashLength == 0,
    proxyShort: facts.proxyLength > 0 and facts.proxyLength < minimumSecretLength,
    hashShort: deployed and facts.hashLength < minimumSecretLength,
    sessionMissing: shared.sessionMissing,
    sessionShort: shared.sessionShort,
    sessionReused: shared.sessionReused,
    leakKeyShort: deployed and facts.leakKeyBytes < minimumSecretLength,
    migrationMissing: deployed and facts.migrate and not(facts.migrationUrl),
    sharedLogin: deployed and facts.sameLoginUrl,
    turnSecretShort: secrets.turnSecretShort,
    staffTokensMissing: secrets.staffTokensMissing,
    staffTokenShort: secrets.staffTokenShort,
    publicEventsLoginMissing: deployed and not(facts.publicEventsLogin),
    turnSecretReused: secrets.turnSecretReused,
    reviewInvalid: shared.reviewInvalid,
    devSwitchSet: shared.devSwitchSet
  }
}

pure def backendBootRefused(boot: BackendBoot): bool =
  boot.devConflict or boot.databaseMissing or boot.turnstileMissing or boot.turnstileSiteMissing or boot.proxyMissing or
    boot.hashMissing or boot.proxyShort or boot.hashShort or boot.sessionMissing or boot.sessionShort or boot.sessionReused or
    boot.leakKeyShort or boot.migrationMissing or boot.sharedLogin or
    boot.turnSecretShort or boot.staffTokensMissing or boot.staffTokenShort or boot.publicEventsLoginMissing or
    boot.turnSecretReused or boot.reviewInvalid or boot.devSwitchSet

pure val sessionLengthValues = Set(0, minimumSecretLength - 1, minimumSecretLength)

pure def readyBackendFacts(environment: Environment): BackendBootFacts = {
  environment: environment, production: environment == Production, database: true, migrate: false, migrationUrl: true,
  sameLoginUrl: false, turnstile: true, turnstileSite: true, proxyLength: minimumSecretLength, hashLength: minimumSecretLength,
  sessionLength: minimumSecretLength, sessionIsHashKey: false, leakKeyBytes: minimumSecretLength,
  turnSecretLength: minimumSecretLength, staffTokenCount: 1, shortestStaffTokenLength: minimumSecretLength,
  publicEventsLogin: true, turnSecretIsStaffToken: false, review: "human", reviewSet: false, devSwitch: false
}

pure def lawDeployedBackendServesSignupLineAndStaff(environment: Environment, turnstileSite: bool, turnSecretLength: int, staffTokenCount: int, shortestStaffTokenLength: int): bool =
  val ready = readyBackendFacts(environment)
  val facts = { ...ready, turnstileSite: turnstileSite, turnSecretLength: turnSecretLength,
    staffTokenCount: staffTokenCount, shortestStaffTokenLength: shortestStaffTokenLength }
  (deployedEnvironment(environment) and not(backendBootRefused(backendBoot(facts)))) implies
    (turnstileSite and turnSecretLength >= minimumSecretLength and
      staffTokenCount > 0 and shortestStaffTokenLength >= minimumSecretLength)

pure def lawDeployedBackendHasOwnSessionSecret(environment: Environment, sessionLength: int, sessionIsHashKey: bool): bool =
  val ready = readyBackendFacts(environment)
  val facts = { ...ready, sessionLength: sessionLength, sessionIsHashKey: sessionIsHashKey }
  (deployedEnvironment(environment) and not(backendBootRefused(backendBoot(facts)))) implies
    (sessionLength >= minimumSecretLength and not(sessionIsHashKey))

pure def lawBackendRefusesDevThatSaysProduction(database: bool): bool =
  val ready = readyBackendFacts(Dev)
  backendBootRefused(backendBoot({ ...ready, production: true, database: database }))

pure def lawEntriesShareSessionDecision(environment: Environment, sessionLength: int, sessionIsHashKey: bool, reviewSet: bool, devSwitch: bool): bool =
  val readyNetwork = readyNetworkFacts(environment)
  val readyBackend = readyBackendFacts(environment)
  val network = networkBoot({ ...readyNetwork, sessionLength: sessionLength, sessionIsHashKey: sessionIsHashKey,
    review: "manual", reviewSet: reviewSet, devSwitch: devSwitch })
  val backend = backendBoot({ ...readyBackend, sessionLength: sessionLength, sessionIsHashKey: sessionIsHashKey,
    review: "manual", reviewSet: reviewSet, devSwitch: devSwitch })
  network.sessionShort == backend.sessionShort and network.sessionReused == backend.sessionReused and
    network.reviewInvalid == backend.reviewInvalid and network.devSwitchSet == backend.devSwitchSet and
    network.devConflict == backend.devConflict

pure def lawReadyBackendStarts(environment: Environment): bool =
  val ready = readyBackendFacts(environment)
  environment != Undeclared implies not(backendBootRefused(backendBoot(ready)))
```

### The combined backend turns photo relay on only with a complete photo relay setup

The photo relay setup has four parts: the notice version, the notice text with the `{{recipient}}` placeholder, at least one designated safety reviewer, and the exact origin of the photo delivery links. All four parts with a valid notice and origin turn photo relay on. No part keeps photo relay off, and every photo request of a member gets the refusal. Any other setup refuses to start. Changed: this rule is new, because the deployed backend gave the service no relay policy and no delivery origin, so no operator could turn photo relay on after approval. The founder approves the notice text and the reviewers before an operator sets them.

```quint
type PhotoRelaySetup = PhotoRelayOff | PhotoRelayOn | PhotoRelayIncomplete

pure def photoRelaySetup(versionSet: bool, noticeSet: bool, noticeNamesRecipient: bool, reviewersSet: bool, originSet: bool, originValid: bool): PhotoRelaySetup =
  if (not(versionSet) and not(noticeSet) and not(reviewersSet) and not(originSet)) PhotoRelayOff
  else if (versionSet and noticeSet and noticeNamesRecipient and reviewersSet and originSet and originValid) PhotoRelayOn
  else PhotoRelayIncomplete

pure def lawPhotoRelayOnNeedsEveryPart(versionSet: bool, noticeSet: bool, noticeNamesRecipient: bool, reviewersSet: bool, originSet: bool, originValid: bool): bool =
  photoRelaySetup(versionSet, noticeSet, noticeNamesRecipient, reviewersSet, originSet, originValid) == PhotoRelayOn implies
    (versionSet and noticeSet and noticeNamesRecipient and reviewersSet and originSet and originValid)

pure def lawPartialPhotoRelaySetupRefused(noticeNamesRecipient: bool, originValid: bool): bool =
  photoRelaySetup(true, false, noticeNamesRecipient, true, true, originValid) == PhotoRelayIncomplete and
    photoRelaySetup(false, false, noticeNamesRecipient, false, true, originValid) == PhotoRelayIncomplete
```

### Exactly one system answers the carrier's inbound messages

With `NETWORK_CHANNEL=eliza_cloud` the Eliza gateway owns the carrier webhook and calls the signed turn route. The backend then does not serve its own Blooio webhook route on either listener, whatever secret is set. Any other channel setting keeps the backend's Blooio webhook as the inbound owner. Changed: before this rule the legacy webhook stayed open beside the gateway, so one text could get two answers.

```quint
type CarrierInboundOwner = ElizaGateway | BackendWebhook

pure def carrierInboundOwner(channelSetting: str): CarrierInboundOwner =
  if (channelSetting == "eliza_cloud") ElizaGateway else BackendWebhook

pure def backendWebhookServed(channelSetting: str): bool = carrierInboundOwner(channelSetting) == BackendWebhook

pure def lawGatewayClosesBackendWebhook(channelSetting: str): bool =
  carrierInboundOwner(channelSetting) == ElizaGateway implies not(backendWebhookServed(channelSetting))
```

### A deployed service login must be a restricted database role

The database role check rejects a missing role, a superuser, a role with BYPASSRLS, and a role that owns the service tables directly or through membership. It reports the first reason in that order.

```quint
type LoginCheck = MissingRole | Superuser | BypassRls | OwnsTables | RestrictedRole

pure def databaseLogin(rolePresent: bool, superuser: bool, bypass: bool, owner: bool): LoginCheck =
  if (not(rolePresent)) MissingRole
  else if (superuser) Superuser
  else if (bypass) BypassRls
  else if (owner) OwnsTables
  else RestrictedRole

pure def lawRestrictedRoleHasNoElevatedPrivileges(rolePresent: bool, superuser: bool, bypass: bool, owner: bool): bool =
  databaseLogin(rolePresent, superuser, bypass, owner) == RestrictedRole implies
    rolePresent and not(superuser) and not(bypass) and not(owner)
```
