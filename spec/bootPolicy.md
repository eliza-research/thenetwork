# Runtime startup configuration

The [service start model](models/boot_config.md) includes database setup, process restarts and Pages proxy rotation. These generated rules decide which environment and local shortcuts apply, and which facts each startup gate requires, including the settings that agent signup in [Story F30](product/stories.md#story-f30--join-the-app-i-asked-for) needs. The entry points read environment variables and database role metadata and render the errors.

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

pure def lawProductionDisallowsDev(platform: str): bool = not(devShortcuts(platform, "production"))
```

### The network service entry checks provider, review, storage and secret configuration

`main.ts` requires a declared environment and rejects a dev declaration combined with production. Staging and production require an OTP provider, a Turnstile secret, the service database, and the proxy, hash, and session secrets. If supplied, the review setting must be human. Dev-only switches must be unset. The OTP adapter supplies its own provider-specific requirements.

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

The combined backend needs a database in every environment. Staging and production also need provider and proxy configuration, a Turnstile secret, a hash key, and a leak-label key. A supplied proxy secret must meet the character limit in every environment. The deployed hash key has the same character limit. The leak-label key limit is in UTF-8 bytes. A deployed backend that migrates at startup needs a migration URL. A supplied deployed migration URL must differ from the service URL.

```quint
type BackendBootFacts = {
  environment: Environment, database: bool, migrate: bool, migrationUrl: bool, sameLoginUrl: bool,
  turnstile: bool, proxyLength: int, hashLength: int, leakKeyBytes: int
}

type BackendBoot = {
  deployed: bool, databaseMissing: bool, turnstileMissing: bool, proxyMissing: bool, hashMissing: bool,
  proxyShort: bool, hashShort: bool, leakKeyShort: bool, migrationMissing: bool, sharedLogin: bool
}

pure def backendBoot(facts: BackendBootFacts): BackendBoot = {
  val deployed = deployedEnvironment(facts.environment)
  {
    deployed: deployed, databaseMissing: not(facts.database),
    turnstileMissing: deployed and not(facts.turnstile),
    proxyMissing: deployed and facts.proxyLength == 0,
    hashMissing: deployed and facts.hashLength == 0,
    proxyShort: facts.proxyLength > 0 and facts.proxyLength < minimumSecretLength,
    hashShort: deployed and facts.hashLength < minimumSecretLength,
    leakKeyShort: deployed and facts.leakKeyBytes < minimumSecretLength,
    migrationMissing: deployed and facts.migrate and not(facts.migrationUrl),
    sharedLogin: deployed and facts.sameLoginUrl
  }
}
```

### A deployed service lets each agent signup skill finish

The published signup skills for Network, Slop and Friends ask for a phone code over direct HTTPS (`spec/siteEnrollment.md`). An agent cannot pass a browser challenge. So in staging and production, when the service signs people in with phone codes, each of these apps must be listed in `PLATFORM_PHONE_OTP_ONLY_APPS`, and the codes must go through Blooio (`OTP_PROVIDER=blooio`), because the API gives the phone-code-only exemption only with Blooio. Cloud sign-in (`NETWORK_CLOUD_AUTH_ENABLED=true`) is a separate sign-in mode (`spec/cloudSignIn.md`) that does not use phone codes, so this rule does not apply to it. Peon keeps its browser Join form and its Turnstile challenge, so this rule does not apply to Peon. Both entry points keep the Turnstile secret requirement for the browser and connector paths. A dev environment has no requirement. The entry points check each skill app and name the missing setting.

```quint
type AgentSignupFacts = { environment: Environment, phoneCodeOnly: bool, blooioCodes: bool, cloudSignIn: bool }

pure def agentSignupBlocked(facts: AgentSignupFacts): bool =
  deployedEnvironment(facts.environment) and not(facts.cloudSignIn) and
    (not(facts.phoneCodeOnly) or not(facts.blooioCodes))

pure def lawDevNeverBlocksAgentSignup(phoneCodeOnly: bool, blooioCodes: bool, cloudSignIn: bool): bool =
  not(agentSignupBlocked({ environment: Dev, phoneCodeOnly: phoneCodeOnly, blooioCodes: blooioCodes, cloudSignIn: cloudSignIn }))

pure def lawDeployedAgentSignupNeedsPhoneCodes(environment: Environment, phoneCodeOnly: bool, blooioCodes: bool): bool =
  (deployedEnvironment(environment) and
    not(agentSignupBlocked({ environment: environment, phoneCodeOnly: phoneCodeOnly, blooioCodes: blooioCodes, cloudSignIn: false })))
    implies (phoneCodeOnly and blooioCodes)
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
