#!/usr/bin/env -S node --import=tsx

import { parseArgs } from "node:util";
import { RealClock } from "../../../packages/core/src/clock.ts";
import type { MarketingStore } from "./store.ts";

interface ParsedCli {
  command: string;
  positionals: string[];
  json: boolean;
  quick: boolean;
  help: boolean;
  vipBd: boolean;
  city?: string;
  db?: string;
  seed?: string;
  days?: string;
  limit?: string;
  campaign?: string;
  agent?: string;
  day?: string;
  role?: string;
  budget?: string;
  neighborhood?: string;
  licence?: string;
  name?: string;
  archetype?: string;
  hook?: string;
  task?: string;
  port?: string;
  host?: string;
}

function parseCliArgs(rawArgv: string[]): ParsedCli {
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h", default: false },
      json: { type: "boolean", default: false },
      quick: { type: "boolean", default: false },
      "vip-bd": { type: "boolean", default: false },
      city: { type: "string", short: "c" },
      db: { type: "string" },
      seed: { type: "string" },
      days: { type: "string" },
      limit: { type: "string" },
      campaign: { type: "string" },
      agent: { type: "string" },
      day: { type: "string" },
      role: { type: "string" },
      budget: { type: "string" },
      neighborhood: { type: "string" },
      licence: { type: "string" },
      name: { type: "string" },
      archetype: { type: "string" },
      hook: { type: "string" },
      task: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
    },
  });

  return {
    command: positionals[0] ?? "status",
    positionals: positionals.slice(1),
    json: values.json === true,
    quick: values.quick === true,
    help: values.help === true,
    vipBd: values["vip-bd"] === true,
    city: values.city,
    db: values.db,
    seed: values.seed,
    days: values.days,
    limit: values.limit,
    campaign: values.campaign,
    agent: values.agent,
    day: values.day,
    role: values.role,
    budget: values.budget,
    neighborhood: values.neighborhood,
    licence: values.licence,
    name: values.name,
    archetype: values.archetype,
    hook: values.hook,
    task: values.task,
    port: values.port,
    host: values.host,
  };
}

async function openStore(
  dbUrl: string | undefined,
  clock: RealClock,
): Promise<{ store: MarketingStore; mode: "postgres" | "memory" }> {
  const { MemoryMarketingStore, PgMarketingStore } = await import("./store.ts");
  if (dbUrl && dbUrl.trim().length > 0) {
    const store = new PgMarketingStore(dbUrl.trim(), { clock });
    await store.migrate();
    return { store, mode: "postgres" };
  }
  return { store: new MemoryMarketingStore({ clock }), mode: "memory" };
}

function printUsage(): void {
  console.log(
    [
      "Usage: pnpm run marketing:cli -- <command> [options]",
      "",
      "Offline commands (zero Postgres connection):",
      "  cities              List registered global CityPacks, stages, and platform status",
      "  desire-lanes        List all Universal Desire Lanes, apps, and air-gap groups",
      "  sim                 Run offline deterministic multi-city marketing simulation (--quick --seed 1 --days 30)",
      "  doctor              Run offline environment, safety-wall, and configuration diagnostics",
      "  bandit              Run Thompson-Sampling Bandit rebalance preview (--city nyc --seed s1)",
      "  video-lint          Lint starter short-form video scripts (--city nyc)",
      "  vip-invite          Generate & validate a <75-word VIP salon invite (--name ... --archetype ... --city nyc)",
      "",
      "Store / runtime commands:",
      "  seed                Seed any registered CityPack (--city nyc|sf|la|chicago|miami|austin|london)",
      "  seed-nyc            Alias for `seed --city nyc`",
      "  discover            Run Tier-1 $0 open-web multi-city discovery (--city nyc --limit 10 [--vip-bd])",
      "  status              Show campaign overview, budget burn, agents, devices, adapters & slop.cash status",
      "  llm-usage           Show daily LLM token/cost consumption, Dafny cap status, and recent trajectories",
      "  scan-devices        Probe USB-attached Android & iPhone devices on this MacBook",
      "  tick                Run one autonomous agent orchestration tick (--campaign <id>)",
      "  hire-batch          Generate a compliant Tier-4 hiring packet (--role ... --city nyc --budget 25000)",
      "  bd-list             List BD venue and event-host deals (--city nyc)",
      "  slop-cash-preview   Preview disabled slop.cash hook schema without settling (--task <id>)",
      "  serve               Start the local HTTP Command Center & REST API (--port 4949 --host 127.0.0.1)",
      "",
      "Global options:",
      "  --json              Emit machine-readable JSON output",
      "  --city, -c <code>   City code (nyc, sf, la, chicago, miami, austin, london)",
      "  --db <url>          Postgres connection string (defaults to NETWORK_DATABASE_URL, else in-memory)",
      "  --help, -h          Show this help message",
    ].join("\n"),
  );
}

async function runOfflineCommand(cli: ParsedCli, clock: RealClock): Promise<boolean> {
  if (cli.command === "help" || cli.help) {
    printUsage();
    return true;
  }

  if (cli.command === "cities") {
    const { listCityPacks } = await import("./city-registry.ts");
    const packs = listCityPacks();
    const rows = packs.map((p) => ({
      code: p.code,
      label: p.label,
      country: p.country,
      currency: p.currency,
      stage: p.stage,
      platformActive: p.platformActive,
      laborClassification: p.legal.laborClassification,
      w2Required: p.legal.w2RequiredForStreetTeams,
      flierLicenceRequired: p.legal.flierLicenceRequired,
      corridors: p.corridors.length,
    }));
    if (cli.json) {
      console.log(JSON.stringify({ ok: true, count: rows.length, cities: rows }, null, 2));
    } else {
      for (const r of rows) {
        console.log(
          `${r.code.padEnd(8)} ${r.label.padEnd(18)} stage=${r.stage.padEnd(18)} platform=${r.platformActive ? "active" : "mkt_only"} labor=${r.laborClassification}`,
        );
      }
    }
    return true;
  }

  if (cli.command === "desire-lanes") {
    const { listDesireLanes } = await import("./desire-lanes.ts");
    const lanes = listDesireLanes();
    const rows = lanes.map((l) => ({
      id: l.id,
      label: l.label,
      launchStatus: l.launchStatus,
      defaultAppId: l.defaultAppId,
      airGapGroup: l.airGapGroup,
      minPaidMarketingAge: l.minPaidMarketingAge,
      outcomeMetric: l.outcomeMetric,
      humanPromise: l.humanPromise,
    }));
    if (cli.json) {
      console.log(JSON.stringify({ ok: true, count: rows.length, lanes: rows }, null, 2));
    } else {
      for (const l of rows) {
        console.log(
          `${String(l.id).padEnd(24)} app=${l.defaultAppId.padEnd(8)} status=${l.launchStatus.padEnd(17)} airgap=${l.airGapGroup}`,
        );
      }
    }
    return true;
  }

  if (cli.command === "sim") {
    const { runMarketingSim } = await import("./sim.ts");
    const parsedSeed = cli.seed ? Number(cli.seed) : 1;
    const parsedDays = cli.days ? Number(cli.days) : undefined;
    const cities = cli.city
      ? cli.city
          .split(",")
          .map((c) => c.trim().toLowerCase())
          .filter(Boolean)
      : undefined;
    const summary = await runMarketingSim({
      seed: Number.isFinite(parsedSeed) ? parsedSeed : 1,
      days: parsedDays !== undefined && Number.isFinite(parsedDays) ? parsedDays : undefined,
      cities,
      quick: cli.quick,
    });
    if (cli.json) {
      console.log(JSON.stringify({ ok: summary.allBlockingPass, summary }, null, 2));
    } else {
      console.log(
        `Marketing Sim (seed=${summary.seed}, days=${summary.days}, cities=${summary.cities.join("+")}, ${summary.elapsedMs}ms, digest=${summary.digest})`,
      );
      for (const g of summary.gates) {
        const tag = g.pass ? "PASS " : g.blocking ? "FAIL " : "track";
        console.log(`  ${tag} ${g.name}: ${g.detail}`);
      }
      console.log(
        `Result: ${summary.blockingPassed}/${summary.blockingTotal} blocking gates passed`,
      );
    }
    if (!summary.allBlockingPass) process.exitCode = 1;
    return true;
  }

  if (cli.command === "doctor") {
    const [{ listCityPacks }, { listDesireLanes }, { CANONICAL_MARKETING_AGENTS, resolveMarketingOpsBaseUrl }] =
      await Promise.all([
        import("./city-registry.ts"),
        import("./desire-lanes.ts"),
        import("./constants.ts"),
      ]);
    const env = process.env;
    const report = {
      ok: true,
      nodeVersion: process.version,
      databaseConfigured: Boolean(env.NETWORK_DATABASE_URL?.trim() || env.DATABASE_URL?.trim()),
      opsBaseUrl: resolveMarketingOpsBaseUrl(env),
      safetyDefaults: {
        liveSendEnabled: env.MARKETING_LIVE_SEND === "1",
        liveBillingEnabled: env.MARKETING_LIVE_BILLING === "1",
        liveDeviceEnabled: env.MARKETING_LIVE_DEVICE === "1",
        liveAgentsEnabled: env.MARKETING_LIVE_AGENTS === "1",
        slopCashEnabled: env.MARKETING_SLOP_CASH_ENABLED === "1",
        leakLabelKeyConfigured: Boolean(env.LEAK_LABEL_KEY?.trim()),
      },
      llmProviders: {
        surplusKeyConfigured: Boolean(env.SURPLUS_API_KEY?.trim()),
        openaiKeyConfigured: Boolean(env.OPENAI_API_KEY?.trim()),
      },
      registry: {
        citiesCount: listCityPacks().length,
        desireLanesCount: listDesireLanes().length,
        canonicalAgentsCount: CANONICAL_MARKETING_AGENTS.length,
      },
    };
    if (cli.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Marketing Doctor (Node ${report.nodeVersion})`);
      console.log(`  opsBaseUrl:      ${report.opsBaseUrl}`);
      console.log(`  database:        ${report.databaseConfigured ? "configured" : "in-memory (offline)"}`);
      console.log(`  slopCashEnabled: ${report.safetyDefaults.slopCashEnabled}`);
      console.log(`  liveSend/Bill:   send=${report.safetyDefaults.liveSendEnabled} billing=${report.safetyDefaults.liveBillingEnabled}`);
      console.log(
        `  registry:        ${report.registry.citiesCount} cities, ${report.registry.desireLanesCount} desire lanes, ${report.registry.canonicalAgentsCount} agents`,
      );
    }
    return true;
  }

  if (cli.command === "bandit") {
    const [{ computeBanditAllocations, createDefaultCityBanditArms }, { requireCityPack }] =
      await Promise.all([import("./bandit.ts"), import("./city-registry.ts")]);
    const pack = requireCityPack(cli.city ?? "nyc");
    const nowIso = new Date(clock.now()).toISOString();
    const seed = cli.seed ?? `${pack.code}-cli-1`;
    const campaignId = `camp-${pack.code}-preview`;
    const arms = createDefaultCityBanditArms(campaignId, pack.code, nowIso);
    const rebalance = computeBanditAllocations({
      campaignId,
      arms,
      availableCents: pack.budgetDefaults.monthlyBudgetCents,
      seed,
      nowIso,
      riskDial: "balanced",
      billingArmed: true,
    });
    console.log(JSON.stringify({ mode: "offline", city: pack.code, rebalance }, null, 2));
    return true;
  }

  if (cli.command === "video-lint") {
    const [{ buildStarterScriptsForCity, lintVideoScript }, { requireCityPack }] =
      await Promise.all([import("./video-factory.ts"), import("./city-registry.ts")]);
    const pack = requireCityPack(cli.city ?? "nyc");
    const scripts = buildStarterScriptsForCity(pack.code);
    const results = scripts.map((script) => ({
      id: script.id,
      personaId: script.personaId,
      appId: script.appId,
      title: script.title,
      lint: lintVideoScript(script),
    }));
    const failed = results.filter((r) => !r.lint.pass);
    console.log(
      JSON.stringify(
        {
          mode: "offline",
          city: pack.code,
          total: results.length,
          passed: results.length - failed.length,
          results,
        },
        null,
        2,
      ),
    );
    if (failed.length > 0) process.exitCode = 1;
    return true;
  }

  if (cli.command === "vip-invite") {
    const [{ VipDiscoveryEngine }, { requireCityPack }] = await Promise.all([
      import("./vip-engine.ts"),
      import("./city-registry.ts"),
    ]);
    const pack = requireCityPack(cli.city ?? "nyc");
    const vipEngine = new VipDiscoveryEngine({ clock });
    const invite = vipEngine.buildAndValidateVipInvite({
      firstName: cli.name ?? "Maya",
      archetypeSlug: cli.archetype ?? "oss_maintainer",
      city: pack.code,
      neighborhood: cli.neighborhood ?? pack.corridors[0]?.neighborhood ?? pack.label,
      proofOfWork1Line: cli.hook ?? "your open-source distributed systems benchmarks",
      senderName: "The Operator",
    });
    console.log(JSON.stringify({ mode: "offline", city: pack.code, invite }, null, 2));
    if (!invite.valid) process.exitCode = 1;
    return true;
  }

  if (cli.command === "discover" || cli.command === "discover-nyc") {
    const [{ discoverCityLeads }, { requireCityPack }] = await Promise.all([
      import("./discovery.ts"),
      import("./city-registry.ts"),
    ]);
    const pack = requireCityPack(cli.city ?? "nyc");
    const limit = cli.limit ? Number(cli.limit) : 10;
    const result = await discoverCityLeads({
      clock,
      city: pack.code,
      limitPerSource: Number.isFinite(limit) && limit > 0 ? limit : 10,
      includeVipBdSources: cli.vipBd,
    });
    console.log(JSON.stringify({ mode: "offline", ...result }, null, 2));
    return true;
  }

  return false;
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const clock = new RealClock();

  if (await runOfflineCommand(cli, clock)) {
    return;
  }

  const dbFlag = cli.db ?? process.env.NETWORK_DATABASE_URL;
  const { requireCityPack } = await import("./city-registry.ts");
  const cityPack = requireCityPack(cli.city ?? "nyc");
  const city = cityPack.code;

  const { store, mode } = await openStore(dbFlag, clock);

  try {
    if (cli.command === "seed" || cli.command === "seed-nyc") {
      const { seedCityLaunch } = await import("./city-launch-engine.ts");
      const targetCity = cli.command === "seed-nyc" ? "nyc" : city;
      const seeded = await seedCityLaunch(store, targetCity);
      console.log(JSON.stringify({ ok: true, mode, city: targetCity, seeded }, null, 2));
      return;
    }

    if (cli.command === "status") {
      const [{ seedCityLaunch }, { createPaidAdapterRegistry }, { SlopCashBridge }] =
        await Promise.all([
          import("./city-launch-engine.ts"),
          import("./adapters/paid.ts"),
          import("./slop-cash-bridge.ts"),
        ]);
      if ((await store.listCampaigns()).length === 0 && mode === "memory") {
        await seedCityLaunch(store, city);
      }
      const overview = await store.getOverview();
      const adapters = createPaidAdapterRegistry({ clock }).listStatus();
      const slopCash = new SlopCashBridge({ store, clock }).status();
      console.log(JSON.stringify({ mode, city, overview, adapters, slopCash }, null, 2));
      return;
    }

    if (cli.command === "llm-usage") {
      const [{ DEFAULT_DAILY_COST_CAP_MICROS, DEFAULT_DAILY_TOKEN_CAP }, { evaluateLlmBudget }] =
        await Promise.all([import("./agent-lifecycle.ts"), import("./policy.ts")]);
      const dayIso = cli.day ?? new Date(clock.now()).toISOString().slice(0, 10);
      const limit = cli.limit ? Math.max(1, Math.min(200, Math.floor(Number(cli.limit)))) : 20;
      const [usage, trajectories] = await Promise.all([
        store.getDailyLlmUsage({
          dayIso,
          ...(cli.agent ? { agentId: cli.agent } : {}),
          ...(cli.campaign ? { campaignId: cli.campaign } : {}),
        }),
        store.listLlmTrajectories({
          ...(cli.agent ? { agentId: cli.agent } : {}),
          ...(cli.campaign ? { campaignId: cli.campaign } : {}),
          limit,
        }),
      ]);
      const budgetDecision = evaluateLlmBudget({
        tokensUsedToday: usage.totalTokens,
        estimatedTokens: 0,
        dailyTokenCap: DEFAULT_DAILY_TOKEN_CAP,
        costMicrosToday: usage.costMicros,
        estimatedCostMicros: 0,
        dailyCostCapMicros: DEFAULT_DAILY_COST_CAP_MICROS,
      });
      const payload = {
        mode,
        usage,
        caps: {
          dailyTokenCap: DEFAULT_DAILY_TOKEN_CAP,
          dailyCostCapMicros: DEFAULT_DAILY_COST_CAP_MICROS,
        },
        budgetDecision,
        trajectories,
      };
      if (cli.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(
          `LLM Usage (${usage.day}, ${mode}): calls=${usage.calls} cached=${usage.cachedCalls} tokens=${usage.totalTokens}/${DEFAULT_DAILY_TOKEN_CAP} cost=$${(usage.costMicros / 1_000_000).toFixed(4)}/$${(DEFAULT_DAILY_COST_CAP_MICROS / 1_000_000).toFixed(2)} allowed=${budgetDecision.allowed}`,
        );
      }
      return;
    }

    if (cli.command === "scan-devices") {
      const { DeviceBridge } = await import("./devices/bridge.ts");
      const bridge = new DeviceBridge({ clock });
      const [scan, diagnostics] = await Promise.all([
        bridge.scanConnectedDevices(),
        bridge.buildSetupDiagnostics(),
      ]);
      console.log(JSON.stringify({ mode, scan, diagnostics }, null, 2));
      return;
    }

    if (cli.command === "tick") {
      const [{ seedCityLaunch }, { AgentLifecycleManager }] = await Promise.all([
        import("./city-launch-engine.ts"),
        import("./agent-lifecycle.ts"),
      ]);
      if ((await store.listCampaigns()).length === 0) {
        await seedCityLaunch(store, city);
      }
      const campaigns = await store.listCampaigns({ status: "active" });
      const campaignId = cli.campaign ?? campaigns[0]?.id;
      if (!campaignId) throw new Error("No active campaign found; run `seed` first.");
      const manager = new AgentLifecycleManager({ store, clock });
      const tick = await manager.runAutopilotTick(campaignId);
      console.log(JSON.stringify({ mode, tick }, null, 2));
      return;
    }

    if (cli.command === "hire-batch") {
      const { CrowdsourcingEngine } = await import("./crowdsourcing.ts");
      const role = (cli.role ?? "street_fliering") as Parameters<
        InstanceType<typeof CrowdsourcingEngine>["buildHiringPacket"]
      >[0];
      const budgetCents = cli.budget ? Number(cli.budget) : 25_000;
      const engine = new CrowdsourcingEngine({ store, clock });
      const packet = engine.buildHiringPacket(role, city, budgetCents, {
        neighborhood: cli.neighborhood ?? cityPack.corridors[0]?.neighborhood ?? cityPack.label,
        boroughLicenceRef: cli.licence,
      });
      console.log(JSON.stringify({ mode, packet }, null, 2));
      return;
    }

    if (cli.command === "bd-list") {
      const { seedCityLaunch } = await import("./city-launch-engine.ts");
      if ((await store.listCampaigns()).length === 0 && mode === "memory") {
        await seedCityLaunch(store, city);
      }
      const deals = await store.listBdDeals({ city });
      console.log(JSON.stringify({ mode, city, deals }, null, 2));
      return;
    }

    if (cli.command === "slop-cash-preview") {
      const [{ seedCityLaunch }, { SlopCashBridge }] = await Promise.all([
        import("./city-launch-engine.ts"),
        import("./slop-cash-bridge.ts"),
      ]);
      if ((await store.listCampaigns()).length === 0) {
        await seedCityLaunch(store, city);
      }
      const tasks = await store.listTasks();
      const taskId = cli.task ?? tasks[0]?.id;
      if (!taskId) {
        throw new Error("No tasks available to preview; run `seed` first.");
      }
      const task = await store.getTask(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      const bridge = new SlopCashBridge({ store, clock, configEnabled: false });
      const preview = bridge.previewHook(task);
      console.log(JSON.stringify({ mode, status: bridge.status(), preview }, null, 2));
      return;
    }

    if (cli.command === "serve") {
      const [{ seedCityLaunch }, { DEFAULT_MARKETING_HOST, DEFAULT_MARKETING_PORT }, { createMarketingServer }] =
        await Promise.all([
          import("./city-launch-engine.ts"),
          import("./constants.ts"),
          import("./server.ts"),
        ]);
      if ((await store.listCampaigns()).length === 0) {
        await seedCityLaunch(store, city);
      }
      const port = cli.port
        ? Number(cli.port)
        : Number(process.env.MARKETING_PORT || DEFAULT_MARKETING_PORT);
      const started = await createMarketingServer({
        store,
        clock,
        port,
        hostname: cli.host ?? DEFAULT_MARKETING_HOST,
      });
      console.log(`Marketing Command Center (${mode}): ${started.url}/#token=${started.token}`);
      await new Promise<void>((resolveDone) => {
        let done = false;
        const stop = async () => {
          if (done) return;
          done = true;
          await started.stop();
          resolveDone();
        };
        process.on("SIGINT", () => void stop());
        process.on("SIGTERM", () => void stop());
      });
      return;
    }

    throw new Error(`Unknown command: ${cli.command}`);
  } finally {
    await store.close();
  }
}

await main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
