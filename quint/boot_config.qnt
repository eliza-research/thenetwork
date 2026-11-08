// -*- mode: Bluespec; -*-
// quint-check: max-steps=12 max-samples=4000
//
// boot_config: the platform process starts only with a complete configuration (fail closed), and
// the dev shortcuts run only in a declared dev environment that does not say production.
//
// WHAT THIS MODELS
//   The configuration of one platform process (packages/platform/src/env.ts) and its boot gate:
//   main.ts (packages/network/service/main.ts) calls assertBootConfig first, which throws when
//   bootConfigProblems is not empty. The decisions are the LemmaScript functions in
//   packages/platform/src/env-core.ts: declaredEnv, productionEnv, devAllowed, deployedReady and
//   bootProblems. Each is a pure def here with the same name and the same decision.
//   An operator changes the configuration between starts. A started process keeps the configuration
//   it read at start (a snapshot). While it runs, a dev shortcut (the console OTP provider, the
//   Turnstile bypass, the dev hash key, a trusted X-Forwarded-Host, cookies without Secure) can run
//   only when devAllowed (env.ts devShortcutsAllowed) says yes for that snapshot.
//
// BOUNDS
//   PLATFORM_ENV and NODE_ENV take every value class the core tells apart, plus one unknown value.
//   A secret length is 0 (unset), 10 (too short) or 32 (long enough). Run with --max-steps=12.
//
// TIME
//   No decision here uses time. Time is the order of actions only.
//
// RUN (from the repository root; quint 0.33.1)
//   quint typecheck quint/boot_config.qnt
//   quint test quint/boot_config.qnt --main boot_config
//   quint run quint/boot_config.qnt --main boot_config --invariant=safety --max-samples=4000 --max-steps=12
//   Each witness_<name> must be VIOLATED (the state is reachable).
//
// ABSTRACTIONS
//   - The OTP provider check (otp-config.ts otpConfigProblems) is one boolean: otpOk.
//   - The two database URLs are one boolean: db (NETWORK_DATABASE_URL or DATABASE_URL is set).
//   - The PLATFORM_DEV_* switches are one boolean: devSwitch (at least one is set to a value).
//   - The problem texts are outside the model; only "no problem" matters for the gate.
//
// OUTSIDE THE MODEL
//   - Each caller of devShortcutsAllowed (otp.ts, turnstile.ts, api.ts, serve.ts, service.ts,
//     mcp/handler.ts, mcp/dev-server.ts). The model has one shortcut action that asks the same def.
//   - process.env changes inside a running process. Node and Bun read the environment at start.
module boot_config {

  // ---------------------------------------------------------------- types (own, small)
  type Review = Unset | Human | Auto
  type Config = {
    platformEnv: str,   // "" when unset
    nodeEnv: str,       // "" when unset
    otpOk: bool,
    turnstile: bool,
    proxyLen: int,
    hashLen: int,
    sessionLen: int,
    db: bool,
    review: Review,
    devSwitch: bool,
  }

  pure val PLATFORM_ENVS = Set("", "production", "staging", "dev", "other")
  pure val NODE_ENVS = Set("", "production", "test", "other")
  pure val LENGTHS = Set(0, 10, 32)
  pure val MIN_SECRET_LENGTH = 32

  // ---------------------------------------------------------------- env-core.ts, def for def
  // declaredEnv: PLATFORM_ENV wins when it is set; an unknown PLATFORM_ENV is not declared.
  pure def declaredEnv(p: str, n: str): str =
    if (p != "") (if (p == "production" or p == "staging" or p == "dev") p else "")
    else if (n == "production") "production"
    else if (n == "test") "dev"
    else ""

  pure def productionEnv(n: str, p: str): bool = n == "production" or p == "production"

  pure def devAllowed(p: str, n: str): bool = not(productionEnv(n, p)) and declaredEnv(p, n) == "dev"

  pure def deployedReady(c: Config): bool = and {
    c.otpOk, c.turnstile,
    c.proxyLen >= MIN_SECRET_LENGTH, c.hashLen >= MIN_SECRET_LENGTH, c.sessionLen >= MIN_SECRET_LENGTH,
    c.db,
    c.review != Auto,
    not(c.devSwitch),
  }

  // bootProblems(f).length == 0
  pure def bootOk(c: Config): bool =
    val e = declaredEnv(c.platformEnv, c.nodeEnv)
    if (e == "") false
    else if (e == "dev") not(productionEnv(c.nodeEnv, c.platformEnv))
    else deployedReady(c)

  // ---------------------------------------------------------------- state
  var cfg: Config
  var started: bool
  var snap: Config          // the configuration the running process read at start
  var shortcutsUsed: bool   // a dev shortcut ran in the running process
  var refused: int          // boots that the gate refused

  pure val EMPTY: Config = {
    platformEnv: "", nodeEnv: "", otpOk: false, turnstile: false,
    proxyLen: 0, hashLen: 0, sessionLen: 0, db: false, review: Unset, devSwitch: false,
  }

  action init = all {
    cfg' = EMPTY,
    started' = false,
    snap' = EMPTY,
    shortcutsUsed' = false,
    refused' = 0,
  }

  // ---------------------------------------------------------------- actions
  // An operator changes the configuration of a stopped process (one or more variables).
  action configure = all {
    not(started),
    nondet p = PLATFORM_ENVS.oneOf()
    nondet n = NODE_ENVS.oneOf()
    nondet o = Set(true, false).oneOf()
    nondet t = Set(true, false).oneOf()
    nondet l1 = LENGTHS.oneOf()
    nondet l2 = LENGTHS.oneOf()
    nondet l3 = LENGTHS.oneOf()
    nondet d = Set(true, false).oneOf()
    nondet r = Set(Unset, Human, Auto).oneOf()
    nondet s = Set(true, false).oneOf()
    cfg' = { platformEnv: p, nodeEnv: n, otpOk: o, turnstile: t, proxyLen: l1, hashLen: l2, sessionLen: l3, db: d, review: r, devSwitch: s },
    started' = started, snap' = snap, shortcutsUsed' = shortcutsUsed, refused' = refused,
  }

  // main.ts: assertBootConfig(env) before anything else. A refused boot leaves the process stopped.
  action boot = all {
    not(started),
    if (bootOk(cfg)) all {
      started' = true, snap' = cfg, refused' = refused,
    } else all {
      started' = false, snap' = snap, refused' = refused + 1,
    },
    cfg' = cfg, shortcutsUsed' = false,
  }

  // A dev shortcut runs in the running process only when devShortcutsAllowed says yes for its snapshot.
  action useShortcut = all {
    started,
    devAllowed(snap.platformEnv, snap.nodeEnv),
    shortcutsUsed' = true,
    cfg' = cfg, started' = started, snap' = snap, refused' = refused,
  }

  action stop = all {
    started,
    started' = false, shortcutsUsed' = false,
    cfg' = cfg, snap' = snap, refused' = refused,
  }

  action step = any { configure, boot, useShortcut, stop }

  // ---------------------------------------------------------------- invariants
  // Rule: the service does not guess its environment (env.ts requirePlatformEnv; env-core.ts
  // bootProblems ensures "declaredEnv === "" ==> result.length > 0"; main.ts calls assertBootConfig).
  val startedOnlyDeclared = not(started) or declaredEnv(snap.platformEnv, snap.nodeEnv) != ""

  // Rule: a production or staging process has the OTP provider, Turnstile, the three secrets of at
  // least 32 characters, a database, review mode human, and no dev switch (env.ts bootConfigProblems
  // comment; env-core.ts bootProblems ensures "... ==> deployedReady(f)"; CLAUDE.md human review).
  val startedDeployedIsReady =
    not(started and declaredEnv(snap.platformEnv, snap.nodeEnv) != "dev") or and {
      snap.otpOk, snap.turnstile, snap.db, snap.review != Auto, not(snap.devSwitch),
      snap.proxyLen >= 32, snap.hashLen >= 32, snap.sessionLen >= 32,
    }

  // Rule: dev that says production never starts (env-core.ts bootProblems ensures
  // "productionEnv ==> declaredEnv !== "dev"").
  val startedDevNotProduction =
    not(started and declaredEnv(snap.platformEnv, snap.nodeEnv) == "dev") or not(productionEnv(snap.nodeEnv, snap.platformEnv))

  // Rule: dev shortcuts are never allowed in production, and only in a declared dev environment
  // (env.ts header comment; env-core.ts devAllowed ensures).
  val shortcutsOnlyInDev = not(shortcutsUsed) or and {
    started,
    snap.nodeEnv != "production",
    snap.platformEnv != "production",
    snap.platformEnv == "dev" or (snap.platformEnv == "" and snap.nodeEnv == "test"),
  }

  val safety = and {
    startedOnlyDeclared,
    startedDeployedIsReady,
    startedDevNotProduction,
    shortcutsOnlyInDev,
  }

  // ---------------------------------------------------------------- reachability witnesses (expected VIOLATED)
  // A production process starts.
  val witness_neverStartsProduction = not(started and declaredEnv(snap.platformEnv, snap.nodeEnv) == "production")
  // A dev process starts and uses a shortcut.
  val witness_neverShortcut = not(shortcutsUsed)
  // The gate refuses a boot.
  val witness_neverRefused = refused == 0
  // A staging process starts.
  val witness_neverStartsStaging = not(started and declaredEnv(snap.platformEnv, snap.nodeEnv) == "staging")

  // ---------------------------------------------------------------- traces
  pure val READY: Config = {
    platformEnv: "production", nodeEnv: "production", otpOk: true, turnstile: true,
    proxyLen: 32, hashLen: 32, sessionLen: 32, db: true, review: Human, devSwitch: false,
  }

  run declaredEnvTest = all {
    assert(declaredEnv("", "") == ""),
    assert(declaredEnv("other", "production") == ""),
    assert(declaredEnv("", "test") == "dev"),
    assert(declaredEnv("staging", "production") == "staging"),
    assert(not(devAllowed("dev", "production"))),
    assert(devAllowed("dev", "")),
    assert(not(devAllowed("", ""))),
  }

  run bootGateTest = all {
    assert(bootOk(READY)),
    assert(not(bootOk({ ...READY, hashLen: 10 }))),
    assert(not(bootOk({ ...READY, review: Auto }))),
    assert(not(bootOk({ ...READY, devSwitch: true }))),
    assert(not(bootOk({ ...READY, platformEnv: "", nodeEnv: "" }))),
    assert(not(bootOk({ ...EMPTY, platformEnv: "dev", nodeEnv: "production" }))),
    assert(bootOk({ ...EMPTY, platformEnv: "dev" })),
  }

  run shortSecretRefusedTest =
    init
      .then(all { cfg' = { ...READY, sessionLen: 10 }, started' = started, snap' = snap, shortcutsUsed' = shortcutsUsed, refused' = refused })
      .then(boot)
      .then(all { assert(not(started)), assert(refused == 1), cfg' = cfg, started' = started, snap' = snap, shortcutsUsed' = shortcutsUsed, refused' = refused })

  run productionHasNoShortcutTest =
    init
      .then(all { cfg' = READY, started' = started, snap' = snap, shortcutsUsed' = shortcutsUsed, refused' = refused })
      .then(boot)
      .then(all { assert(started), assert(not(devAllowed(snap.platformEnv, snap.nodeEnv))), cfg' = cfg, started' = started, snap' = snap, shortcutsUsed' = shortcutsUsed, refused' = refused })

  run devShortcutTest =
    init
      .then(all { cfg' = { ...EMPTY, platformEnv: "dev" }, started' = started, snap' = snap, shortcutsUsed' = shortcutsUsed, refused' = refused })
      .then(boot)
      .then(useShortcut)
      .then(all { assert(shortcutsUsed), assert(safety), cfg' = cfg, started' = started, snap' = snap, shortcutsUsed' = shortcutsUsed, refused' = refused })
}
