# Runtime startup configuration

The [service start model](models/boot_config.md) includes database setup, process restarts and Pages proxy rotation. These generated rules decide which environment and local shortcuts apply, and which facts each startup gate requires. The entry points read environment variables and database role metadata and render the errors. In staging and production, both entry points also ask the OTP adapter for its provider problems (an explicit OTP provider and its provider-specific credentials), and the network service entry lists each dev-only switch (`PLATFORM_DEV_*`) that is set as a problem.

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

### The network service entry checks provider, review, storage and secret configuration

`main.ts` requires a declared environment and rejects a dev declaration combined with production. Staging and production require a Turnstile secret, the service database, and the proxy, hash, and session secrets. If supplied, the review setting must be human.

```quint
pure val minimumSecretLength: int = 32

type NetworkBootFacts = {
  environment: Environment, production: bool, turnstile: bool, database: bool,
  proxyLength: int, hashLength: int, sessionLength: int, review: str, reviewSet: bool
}

type NetworkBoot = {
  environmentMissing: bool, devConflict: bool, checkDeployed: bool, turnstileMissing: bool,
  databaseMissing: bool, proxyShort: bool, hashShort: bool, sessionShort: bool, reviewInvalid: bool
}

pure def networkBoot(facts: NetworkBootFacts): NetworkBoot = {
  environmentMissing: facts.environment == Undeclared,
  devConflict: facts.environment == Dev and facts.production,
  checkDeployed: deployedEnvironment(facts.environment),
  turnstileMissing: not(facts.turnstile),
  databaseMissing: not(facts.database),
  proxyShort: facts.proxyLength < minimumSecretLength,
  hashShort: facts.hashLength < minimumSecretLength,
  sessionShort: facts.sessionLength < minimumSecretLength,
  reviewInvalid: facts.reviewSet and facts.review != "human"
}
```

### The combined backend entry checks its own database, provider and secret configuration

The combined backend needs a database in every environment. Staging and production also need proxy configuration, a Turnstile secret and a Turnstile site key, a hash key, a leak-label key, the Eliza turn secret, at least one staff token, and the public event catalog's ingest login. A supplied proxy secret must meet the character limit in every environment. The deployed hash key, turn secret and every staff token have the same character limit. The leak-label key limit is in UTF-8 bytes. A deployed backend that migrates at startup needs a migration URL. A supplied deployed migration URL must differ from the service URL. Changed: a deployed backend now also refuses to start without the Turnstile site key, the turn secret or a strong staff token, because without them the agent signup connector, the shared line and every staff review answered errors while health stayed green; it also needs the ingest login, because the scheduled catalog refresh runs as that login.

```quint
type BackendBootFacts = {
  environment: Environment, database: bool, migrate: bool, migrationUrl: bool, sameLoginUrl: bool,
  turnstile: bool, turnstileSite: bool, proxyLength: int, hashLength: int, leakKeyBytes: int,
  turnSecretLength: int, staffTokenCount: int, shortestStaffTokenLength: int, publicEventsLogin: bool
}

type BackendBoot = {
  deployed: bool, databaseMissing: bool, turnstileMissing: bool, turnstileSiteMissing: bool, proxyMissing: bool, hashMissing: bool,
  proxyShort: bool, hashShort: bool, leakKeyShort: bool, migrationMissing: bool, sharedLogin: bool,
  turnSecretShort: bool, staffTokensMissing: bool, staffTokenShort: bool, publicEventsLoginMissing: bool
}

pure def backendBoot(facts: BackendBootFacts): BackendBoot = {
  val deployed = deployedEnvironment(facts.environment)
  {
    deployed: deployed, databaseMissing: not(facts.database),
    turnstileMissing: deployed and not(facts.turnstile),
    turnstileSiteMissing: deployed and not(facts.turnstileSite),
    proxyMissing: deployed and facts.proxyLength == 0,
    hashMissing: deployed and facts.hashLength == 0,
    proxyShort: facts.proxyLength > 0 and facts.proxyLength < minimumSecretLength,
    hashShort: deployed and facts.hashLength < minimumSecretLength,
    leakKeyShort: deployed and facts.leakKeyBytes < minimumSecretLength,
    migrationMissing: deployed and facts.migrate and not(facts.migrationUrl),
    sharedLogin: deployed and facts.sameLoginUrl,
    turnSecretShort: deployed and facts.turnSecretLength < minimumSecretLength,
    staffTokensMissing: deployed and facts.staffTokenCount == 0,
    staffTokenShort: deployed and facts.staffTokenCount > 0 and facts.shortestStaffTokenLength < minimumSecretLength,
    publicEventsLoginMissing: deployed and not(facts.publicEventsLogin)
  }
}

pure def backendBootRefused(boot: BackendBoot): bool =
  boot.databaseMissing or boot.turnstileMissing or boot.turnstileSiteMissing or boot.proxyMissing or boot.hashMissing or
    boot.proxyShort or boot.hashShort or boot.leakKeyShort or boot.migrationMissing or boot.sharedLogin or
    boot.turnSecretShort or boot.staffTokensMissing or boot.staffTokenShort or boot.publicEventsLoginMissing

pure val turnSecretLengthValues = Set(0, minimumSecretLength - 1, minimumSecretLength)
pure val shortestStaffTokenLengthValues = Set(0, minimumSecretLength - 1, minimumSecretLength)
pure val staffTokenCountValues = Set(0, 1, 2)

pure def lawDeployedBackendServesSignupLineAndStaff(environment: Environment, turnstileSite: bool, turnSecretLength: int, staffTokenCount: int, shortestStaffTokenLength: int): bool =
  val facts = {
    environment: environment, database: true, migrate: false, migrationUrl: true, sameLoginUrl: false,
    turnstile: true, turnstileSite: turnstileSite, proxyLength: minimumSecretLength, hashLength: minimumSecretLength,
    leakKeyBytes: minimumSecretLength, turnSecretLength: turnSecretLength, staffTokenCount: staffTokenCount,
    shortestStaffTokenLength: shortestStaffTokenLength, publicEventsLogin: true
  }
  (deployedEnvironment(environment) and not(backendBootRefused(backendBoot(facts)))) implies
    (turnstileSite and turnSecretLength >= minimumSecretLength and
      staffTokenCount > 0 and shortestStaffTokenLength >= minimumSecretLength)
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
