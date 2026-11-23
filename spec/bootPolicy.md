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

### Both entries apply one rule to the session secret, the model provider and the dev-only switches

Both entries, `main.ts` and the combined backend, refuse a dev declaration combined with production in every environment. In staging and production both entries need a session secret with the secret character limit that is not the hash key, need an API key for the judge provider and the recommender provider (`JUDGE_PROVIDER` and `RECOMMENDER_PROVIDER`, default Surplus), and refuse a set dev-only switch (`PLATFORM_DEV_*`). The entries read the key facts with `providerKeyPresent`; a provider name that is not known is a startup problem in every environment. `networkBoot` and `backendBoot` copy these facts from `sharedBoot`, so the two entries cannot decide them differently. Changed (owner decisions D15 to D17 of 2026-11-22): the review setting was removed with human review, and a deployed start now needs a model key for the judge and recommender providers, because the review judge decides every introduction; before, `main.ts` also let the session secret be the hash key, which the combined backend refused.

```quint
pure val minimumSecretLength: int = 32

type SharedBootFacts = {
  environment: Environment, production: bool, sessionLength: int, sessionIsHashKey: bool,
  modelProvider: bool, devSwitch: bool
}

type SharedBoot = {
  deployed: bool, devConflict: bool, sessionMissing: bool, sessionShort: bool, sessionReused: bool,
  modelProviderMissing: bool, devSwitchSet: bool
}

pure def sharedBoot(facts: SharedBootFacts): SharedBoot = {
  val deployed = deployedEnvironment(facts.environment)
  {
    deployed: deployed,
    devConflict: facts.environment == Dev and facts.production,
    sessionMissing: deployed and facts.sessionLength == 0,
    sessionShort: deployed and facts.sessionLength < minimumSecretLength,
    sessionReused: deployed and facts.sessionIsHashKey,
    modelProviderMissing: deployed and not(facts.modelProvider),
    devSwitchSet: deployed and facts.devSwitch
  }
}
```

### The network service entry checks provider, model provider, storage and secret configuration

`main.ts` requires a declared environment. Staging and production require a Turnstile secret, the service database, and the proxy and hash secrets with the secret character limit. The session secret, the model provider key, the dev conflict and the dev-only switches come from the shared rule above. `main.ts` refuses to start exactly when one of these is true: `networkBootRefused`, `lineAndStaffRefused`, `workersAiSetupMissing`, `channelSettingInvalid`, `channelCredentialsMissing` for the configured channel, a provider name that is not known, or a problem that the OTP adapter reports. Changed (owner decisions D15 to D17 of 2026-11-22): the review setting fact is replaced by the model provider fact, because human review was removed and a deployed service without a model key would hold every introduction for staff.

```quint
type NetworkBootFacts = {
  environment: Environment, production: bool, turnstile: bool, database: bool,
  proxyLength: int, hashLength: int, sessionLength: int, sessionIsHashKey: bool,
  modelProvider: bool, devSwitch: bool
}

type NetworkBoot = {
  environmentMissing: bool, devConflict: bool, checkDeployed: bool, turnstileMissing: bool,
  databaseMissing: bool, proxyShort: bool, hashShort: bool, sessionShort: bool, sessionReused: bool,
  modelProviderMissing: bool, devSwitchSet: bool
}

pure def networkBoot(facts: NetworkBootFacts): NetworkBoot = {
  val shared = sharedBoot({
    environment: facts.environment, production: facts.production, sessionLength: facts.sessionLength,
    sessionIsHashKey: facts.sessionIsHashKey, modelProvider: facts.modelProvider, devSwitch: facts.devSwitch
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
    modelProviderMissing: shared.modelProviderMissing,
    devSwitchSet: shared.devSwitchSet
  }
}

pure def networkBootRefused(boot: NetworkBoot): bool =
  boot.environmentMissing or boot.devConflict or boot.turnstileMissing or boot.databaseMissing or boot.proxyShort or
    boot.hashShort or boot.sessionShort or boot.sessionReused or boot.modelProviderMissing or boot.devSwitchSet

pure def readyNetworkFacts(environment: Environment): NetworkBootFacts = {
  environment: environment, production: environment == Production, turnstile: true, database: true,
  proxyLength: minimumSecretLength, hashLength: minimumSecretLength, sessionLength: minimumSecretLength,
  sessionIsHashKey: false, modelProvider: true, devSwitch: false
}

pure def lawDeployedServiceHasOwnSessionSecret(environment: Environment, sessionLength: int, sessionIsHashKey: bool): bool =
  val ready = readyNetworkFacts(environment)
  val facts = { ...ready, sessionLength: sessionLength, sessionIsHashKey: sessionIsHashKey }
  (deployedEnvironment(environment) and not(networkBootRefused(networkBoot(facts)))) implies
    (sessionLength >= minimumSecretLength and not(sessionIsHashKey))

pure def lawReadyServiceStarts(environment: Environment): bool =
  environment != Undeclared implies not(networkBootRefused(networkBoot(readyNetworkFacts(environment))))

pure def lawDeployedBootNeedsModelProvider(environment: Environment): bool =
  deployedEnvironment(environment) implies networkBootRefused(networkBoot({ ...readyNetworkFacts(environment), modelProvider: false }))
```

### Both entries refuse a deployment whose shared line or staff API could not work

In staging and production both entries, `main.ts` and the combined backend, need the Eliza turn secret and at least one staff token, and the turn secret and every staff token have the secret character limit. The turn secret must not also be a staff token, because the Eliza Cloud side holds the turn secret and must not get staff access with it. A staff token count of zero or less counts as missing. Changed: this rule is new, because before it `main.ts` only warned when the turn secret or the staff tokens were missing, and the shared line and the staff API then answered errors.

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

The combined backend needs a database in every environment. It refuses a dev declaration combined with production in every environment. Staging and production also need proxy configuration, a Turnstile secret and a Turnstile site key, a hash key, a session secret, a leak-label key, the Eliza turn secret, at least one staff token, and the public event catalog's ingest login. A supplied proxy secret must meet the character limit in every environment. The deployed hash key, session secret, turn secret and every staff token have the same character limit. The deployed session secret must not be the hash key. The leak-label key limit is in UTF-8 bytes. The session secret, the model provider key, the dev conflict and the dev-only switches come from the shared rule above, and the turn secret and staff token checks come from the line and staff rule above. A deployed backend that migrates at startup needs a migration URL. A supplied deployed migration URL must differ from the service URL. The combined backend refuses to start exactly when one of these is true: `backendBootRefused`, `workersAiSetupMissing`, `photoStorageSetup` gives `PhotoStorageRefused`, `channelSettingInvalid`, `channelCredentialsMissing` for the configured channel, a provider name that is not known, or a problem that the OTP adapter reports. Changed (owner decisions D15 to D17 of 2026-11-22): the review setting fact is replaced by the model provider fact of the shared rule, because human review was removed and the review judge and the engine judge need a model key.

```quint
type BackendBootFacts = {
  environment: Environment, production: bool, database: bool, migrate: bool, migrationUrl: bool, sameLoginUrl: bool,
  turnstile: bool, turnstileSite: bool, proxyLength: int, hashLength: int, sessionLength: int, sessionIsHashKey: bool,
  leakKeyBytes: int, turnSecretLength: int, staffTokenCount: int, shortestStaffTokenLength: int, publicEventsLogin: bool,
  turnSecretIsStaffToken: bool, modelProvider: bool, devSwitch: bool
}

type BackendBoot = {
  deployed: bool, devConflict: bool, databaseMissing: bool, turnstileMissing: bool, turnstileSiteMissing: bool, proxyMissing: bool,
  hashMissing: bool, proxyShort: bool, hashShort: bool, sessionMissing: bool, sessionShort: bool, sessionReused: bool,
  leakKeyShort: bool, migrationMissing: bool, sharedLogin: bool,
  turnSecretShort: bool, staffTokensMissing: bool, staffTokenShort: bool, publicEventsLoginMissing: bool,
  turnSecretReused: bool, modelProviderMissing: bool, devSwitchSet: bool
}

pure def backendBoot(facts: BackendBootFacts): BackendBoot = {
  val shared = sharedBoot({
    environment: facts.environment, production: facts.production, sessionLength: facts.sessionLength,
    sessionIsHashKey: facts.sessionIsHashKey, modelProvider: facts.modelProvider, devSwitch: facts.devSwitch
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
    modelProviderMissing: shared.modelProviderMissing,
    devSwitchSet: shared.devSwitchSet
  }
}

pure def backendBootRefused(boot: BackendBoot): bool =
  boot.devConflict or boot.databaseMissing or boot.turnstileMissing or boot.turnstileSiteMissing or boot.proxyMissing or
    boot.hashMissing or boot.proxyShort or boot.hashShort or boot.sessionMissing or boot.sessionShort or boot.sessionReused or
    boot.leakKeyShort or boot.migrationMissing or boot.sharedLogin or
    boot.turnSecretShort or boot.staffTokensMissing or boot.staffTokenShort or boot.publicEventsLoginMissing or
    boot.turnSecretReused or boot.modelProviderMissing or boot.devSwitchSet

pure val sessionLengthValues = Set(0, minimumSecretLength - 1, minimumSecretLength)

pure def readyBackendFacts(environment: Environment): BackendBootFacts = {
  environment: environment, production: environment == Production, database: true, migrate: false, migrationUrl: true,
  sameLoginUrl: false, turnstile: true, turnstileSite: true, proxyLength: minimumSecretLength, hashLength: minimumSecretLength,
  sessionLength: minimumSecretLength, sessionIsHashKey: false, leakKeyBytes: minimumSecretLength,
  turnSecretLength: minimumSecretLength, staffTokenCount: 1, shortestStaffTokenLength: minimumSecretLength,
  publicEventsLogin: true, turnSecretIsStaffToken: false, modelProvider: true, devSwitch: false
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

pure def lawEntriesShareSessionDecision(environment: Environment, sessionLength: int, sessionIsHashKey: bool, modelProvider: bool, devSwitch: bool): bool =
  val readyNetwork = readyNetworkFacts(environment)
  val readyBackend = readyBackendFacts(environment)
  val network = networkBoot({ ...readyNetwork, sessionLength: sessionLength, sessionIsHashKey: sessionIsHashKey,
    modelProvider: modelProvider, devSwitch: devSwitch })
  val backend = backendBoot({ ...readyBackend, sessionLength: sessionLength, sessionIsHashKey: sessionIsHashKey,
    modelProvider: modelProvider, devSwitch: devSwitch })
  network.sessionShort == backend.sessionShort and network.sessionReused == backend.sessionReused and
    network.modelProviderMissing == backend.modelProviderMissing and network.devSwitchSet == backend.devSwitchSet and
    network.devConflict == backend.devConflict

pure def lawReadyBackendStarts(environment: Environment): bool =
  val ready = readyBackendFacts(environment)
  environment != Undeclared implies not(backendBootRefused(backendBoot(ready)))
```

### A deployed backend keeps photos in private storage

A deployed backend (staging or production) starts only with private R2 photo storage (`PHOTO_STORAGE=r2`). It refuses to start without it, because photos, the photo pages and the photo relay would then be off with no error. A dev backend may run with local storage or with no photo storage; with none, every photo request gets the refusal. A partial R2 setup is refused where the storage is read. Changed (owner decision 2026-11-22): this rule replaces the photo relay setup rule, because the owner turned photo relay on with no switch; the notice is now in the code, the reviewers are the staff `safety` role and the photo pages use the app's own domain, so the four photo relay variables are removed and only the storage remains to check.

```quint
type PhotoStorageSetup = PhotoStorageReady | PhotoStorageOff | PhotoStorageRefused

pure def photoStorageSetup(deployed: bool, storageSet: bool, storageIsR2: bool): PhotoStorageSetup =
  if (storageIsR2) PhotoStorageReady
  else if (deployed) PhotoStorageRefused
  else if (storageSet) PhotoStorageReady
  else PhotoStorageOff

pure def lawDeployedNeedsPrivatePhotoStorage(storageSet: bool, storageIsR2: bool): bool =
  (photoStorageSetup(true, storageSet, storageIsR2) == PhotoStorageReady) iff storageIsR2

pure def lawDeployedNeverRunsWithoutPhotos(storageSet: bool, storageIsR2: bool): bool =
  photoStorageSetup(true, storageSet, storageIsR2) != PhotoStorageOff

pure def lawDevMayRunWithoutPhotos(deployed: bool): bool =
  not(deployed) implies photoStorageSetup(deployed, false, false) == PhotoStorageOff
```

### Exactly one system answers the carrier's inbound messages

With `NETWORK_CHANNEL=eliza_cloud` the Eliza gateway owns the carrier webhook and calls the signed turn route. The backend then does not serve its own Blooio webhook route on either listener, whatever secret is set. An empty setting and `blooio` keep the backend's Blooio webhook as the inbound owner; any other setting refuses the start (`channelSettingInvalid`, below). Changed: before this rule the backend's Blooio webhook stayed open beside the gateway, so one text could get two answers.

```quint
type CarrierInboundOwner = ElizaGateway | BackendWebhook

pure def carrierInboundOwner(channelSetting: str): CarrierInboundOwner =
  if (channelSetting == "eliza_cloud") ElizaGateway else BackendWebhook

pure def backendWebhookServed(channelSetting: str): bool = carrierInboundOwner(channelSetting) == BackendWebhook

pure def lawGatewayClosesBackendWebhook(channelSetting: str): bool =
  carrierInboundOwner(channelSetting) == ElizaGateway implies not(backendWebhookServed(channelSetting))
```

### The configured channel alone decides whether a send is real

Both entries, `main.ts` and the combined backend, take the send channel from the channel setting (`NETWORK_CHANNEL`). The value `blooio` sends through the Blooio adapter and the value `eliza_cloud` sends through Eliza Cloud, for every app. An absent or empty value, the `--dry-run` start option and an isolated staging route keep every send a dry run, so a machine without a configured channel never texts a person. Any other value refuses the start (`channelSettingInvalid`), because a mistyped channel such as `Blooio` or `eliza-cloud` would otherwise start without an error, send nothing and keep the backend's Blooio webhook open. A real channel needs its credentials in every environment: the Blooio channel needs the Blooio key and the sending line, and the Eliza Cloud channel needs the Cloud delivery origin, the sending line and a turn secret with the secret character limit. An entry refuses to start with a real channel that does not have all of its credentials. Replies to a signed turn are sent by the Eliza gateway and no backend setting gates them. Changed (owner decision D6 of 2026-11-22): this rule is new and replaces the live approvals `BLOOIO_ALLOW_SEND`, `NTWRK_LIVE_APPROVED` and `<APP>_LIVE_APPROVED`, because the owner removed approval flags; an unknown channel value refuses the start because external input is parsed at the boundary.

```quint
type SendChannel = DryRunChannel | BlooioChannel | ElizaCloudChannel

pure def sendChannel(channelSetting: str, dryRunRequested: bool, isolatedRoute: bool): SendChannel =
  if (dryRunRequested or isolatedRoute) DryRunChannel
  else if (channelSetting == "blooio") BlooioChannel
  else if (channelSetting == "eliza_cloud") ElizaCloudChannel
  else DryRunChannel

pure def channelCredentialsMissing(channel: SendChannel, blooioKey: bool, senderLine: bool, cloudOrigin: bool, turnSecretLength: int): bool =
  if (channel == BlooioChannel) not(blooioKey) or not(senderLine)
  else if (channel == ElizaCloudChannel) not(cloudOrigin) or not(senderLine) or turnSecretLength < minimumSecretLength
  else false

pure def channelSettingInvalid(channelSetting: str): bool =
  channelSetting != "" and channelSetting != "blooio" and channelSetting != "eliza_cloud"

pure val channelSettingValues = Set("", "blooio", "eliza_cloud", "dry-run", "Blooio", "eliza-cloud")

pure def lawValidChannelSettingIsKnown(channelSetting: str): bool =
  not(channelSettingInvalid(channelSetting)) implies
    (channelSetting == "" or sendChannel(channelSetting, false, false) != DryRunChannel)

pure def lawValidChannelSettingPicksInboundOwner(channelSetting: str): bool =
  not(channelSettingInvalid(channelSetting)) implies
    ((carrierInboundOwner(channelSetting) == ElizaGateway) iff (channelSetting == "eliza_cloud"))

pure def lawUnconfiguredChannelNeverSends(dryRunRequested: bool, isolatedRoute: bool): bool =
  sendChannel("", dryRunRequested, isolatedRoute) == DryRunChannel

pure def lawDryRunRequestAndIsolatedRouteNeverSend(channelSetting: str, dryRunRequested: bool, isolatedRoute: bool): bool =
  (dryRunRequested or isolatedRoute) implies sendChannel(channelSetting, dryRunRequested, isolatedRoute) == DryRunChannel

pure def lawRealChannelHasCredentials(channelSetting: str, blooioKey: bool, senderLine: bool, cloudOrigin: bool, turnSecretLength: int): bool =
  val channel = sendChannel(channelSetting, false, false)
  (channel != DryRunChannel and not(channelCredentialsMissing(channel, blooioKey, senderLine, cloudOrigin, turnSecretLength))) implies
    (senderLine and (if (channel == BlooioChannel) blooioKey else (cloudOrigin and turnSecretLength >= minimumSecretLength)))
```

### A deployed entry refuses a partial Workers AI setup, and production needs Workers AI

Photo ratings and the relay classifier use Workers AI. They are on when the Workers AI token and the Cloudflare account are both set. In staging and production both entries refuse to start with the token but without the account, because ratings and the classifier would then be off with no error. The account alone is not a partial setup, because deploy tools also use it. In production both entries also refuse to start without the token or without the account. Staging and dev may start without both; the relay classifier then cannot run, so each relayed text that the rules pass is blocked with the notice to try again, and the simulator, the local dev start (`platform:dev`) and the tests give the service a classifier that is named as simulated. The photo relay check also uses Workers AI. Changed (owner decisions D6, D14 and D18 of 2026-11-22): the ratings switch `CLEF_RATINGS` is removed so the credentials alone turn ratings on, and production now needs both credentials and a missing classifier blocks each relayed text in every environment, because the relay classifier and the photo check decide alone and nothing waits for staff.

```quint
pure def workersAiSetupMissing(deployed: bool, production: bool, tokenSet: bool, accountSet: bool): bool =
  (deployed and tokenSet and not(accountSet)) or (production and not(tokenSet and accountSet))

pure def lawDeployedWorkersAiTokenHasAccount(production: bool, tokenSet: bool, accountSet: bool): bool =
  not(workersAiSetupMissing(true, production, tokenSet, accountSet)) implies (not(tokenSet) or accountSet)

pure def lawProductionStartsOnlyWithWorkersAi(tokenSet: bool, accountSet: bool): bool =
  not(workersAiSetupMissing(true, true, tokenSet, accountSet)) implies (tokenSet and accountSet)

pure def lawStagingAndDevMayStartWithoutWorkersAi(deployed: bool): bool =
  not(workersAiSetupMissing(deployed, false, false, false))
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
