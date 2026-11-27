#!/usr/bin/env -S node --import=tsx

import { RealClock } from "../../../packages/core/src/clock.ts";
import { createPaidAdapterRegistry } from "./adapters/paid.ts";
import { AgentLifecycleManager } from "./agent-lifecycle.ts";
import { computeBanditAllocations, createDefaultBanditArms } from "./bandit.ts";
import {
  getCityConfig,
  isSupportedCity,
  normalizeCityCode,
  SUPPORTED_CITIES,
  type SupportedCity,
} from "./cities.ts";
import { DEFAULT_MARKETING_HOST, DEFAULT_MARKETING_PORT } from "./constants.ts";
import { CrowdsourcingEngine, type HiringRole } from "./crowdsourcing.ts";
import { DeviceBridge } from "./devices/bridge.ts";
import { discoverNycLeads } from "./discovery.ts";
import { NYC_LAUNCH_CAMPAIGN } from "./nyc-seed.ts";
import { createMarketingServer, seedNycLaunch } from "./server.ts";
import { SlopCashBridge } from "./slop-cash-bridge.ts";
import {
  MemoryMarketingStore,
  PgMarketingStore,
  type MarketingStore,
} from "./store.ts";
import {
  lintVideoScript,
  STARTER_COMEDY_SCRIPTS,
} from "./video-factory.ts";
import { VipDiscoveryEngine } from "./vip-engine.ts";

function parseCliArgs(argv: string[]): {
  command: string;
  flags: Record<string, string | boolean>;
  positionals: string[];
} {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg || arg === "--") continue;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq >= 0) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }
  return {
    command: positionals[0] ?? "status",
    flags,
    positionals: positionals.slice(1),
  };
}

function resolveOptionalCity(
  flagVal: string | boolean | undefined,
  env: Record<string, string | undefined> = process.env,
): SupportedCity | undefined {
  const raw =
    typeof flagVal === "string" && flagVal.trim().length > 0
      ? flagVal.trim()
      : env.MARKETING_CITY?.trim();
  if (!raw) return undefined;
  if (!isSupportedCity(raw)) {
    throw new Error(`Unsupported city "${raw}". Expected one of: ${SUPPORTED_CITIES.join(", ")}`);
  }
  return normalizeCityCode(raw);
}

function requireCity(
  flagVal: string | boolean | undefined,
  fallback?: SupportedCity,
  env: Record<string, string | undefined> = process.env,
): SupportedCity {
  const resolved = resolveOptionalCity(flagVal, env) ?? fallback;
  if (!resolved) {
    throw new Error(
      `Missing required --city <${SUPPORTED_CITIES.join("|")}> flag (or MARKETING_CITY env var).`,
    );
  }
  return resolved;
}

async function openStore(
  dbUrl?: string,
): Promise<{ store: MarketingStore; mode: "postgres" | "memory" }> {
  const clock = new RealClock();
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
      "Commands:",
      "  seed-nyc            Seed the Month-1 $10,000 NYC campaign, 5 agents, Tier-2 slots, Bandit, BD, VIP & Video assets",
      "  status              Show campaign overview, budget burn, agents, devices, adapters & slop.cash status",
      "  scan-devices        Probe USB-attached Android & iPhone devices on this MacBook",
      "  discover            Run Tier-1 $0 open-web multi-city discovery (--city nyc|sf|la|chicago|miami|austin|london)",
      "  tick                Run one autonomous agent orchestration tick",
      "  bandit              Run Thompson-Sampling Bandit rebalance preview (--city <code> --seed <n>)",
      "  hire-batch          Generate a compliant Tier-4 hiring packet (--role ... --city <code> --budget 25000)",
      "  bd-list             List BD venue and event-host deals (optional --city <code>)",
      "  vip-invite          Generate & validate a <75-word VIP salon invite (--name ... --archetype ... --city <code>)",
      "  video-lint          Lint all 10 starter short-form video scripts",
      "  slop-cash-preview   Preview disabled slop.cash hook schema without settling (--task <id>)",
      "  serve               Start the local HTTP Command Center & REST API (--port 4949)",
      "",
      "Options:",
      "  --city <code>       City code (nyc, sf, la, chicago, miami, austin, london; or MARKETING_CITY env)",
      "  --db <url>          Postgres connection string (defaults to NETWORK_DATABASE_URL, else in-memory)",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const { command, flags } = parseCliArgs(process.argv.slice(2));
  if (command === "help" || flags.help === true) {
    printUsage();
    return;
  }

  const dbFlag = typeof flags.db === "string" ? flags.db : process.env.NETWORK_DATABASE_URL;
  const { store, mode } = await openStore(dbFlag);
  const clock = store.clock;

  try {
    if (command === "seed-nyc") {
      const seeded = await seedNycLaunch(store);
      console.log(JSON.stringify({ mode, seeded }, null, 2));
      return;
    }

    if (command === "status") {
      if ((await store.listCampaigns()).length === 0 && mode === "memory") {
        await seedNycLaunch(store);
      }
      const overview = await store.getOverview();
      const adapters = createPaidAdapterRegistry({ clock }).listStatus();
      const slopCash = new SlopCashBridge({ store, clock }).status();
      console.log(JSON.stringify({ mode, overview, adapters, slopCash }, null, 2));
      return;
    }

    if (command === "scan-devices") {
      const bridge = new DeviceBridge({ clock });
      const [scan, diagnostics] = await Promise.all([
        bridge.scanConnectedDevices(),
        bridge.buildSetupDiagnostics(),
      ]);
      console.log(JSON.stringify({ mode, scan, diagnostics }, null, 2));
      return;
    }

    if (command === "discover" || command === "discover-nyc") {
      const city = requireCity(flags.city, command === "discover-nyc" ? "nyc" : undefined);
      const limit = typeof flags.limit === "string" ? Number(flags.limit) : 10;
      const result = await discoverNycLeads({
        clock,
        city,
        limitPerSource: Number.isFinite(limit) && limit > 0 ? limit : 10,
        includeVipBdSources: flags["vip-bd"] === true,
      });
      console.log(JSON.stringify({ mode, ...result }, null, 2));
      return;
    }

    if (command === "tick") {
      if ((await store.listCampaigns()).length === 0) {
        await seedNycLaunch(store);
      }
      const campaigns = await store.listCampaigns({ status: "active" });
      const campaignId =
        typeof flags.campaign === "string"
          ? flags.campaign
          : campaigns[0]?.id ?? NYC_LAUNCH_CAMPAIGN.id;
      const manager = new AgentLifecycleManager({ store, clock });
      const tick = await manager.runAutopilotTick(campaignId);
      console.log(JSON.stringify({ mode, tick }, null, 2));
      return;
    }

    if (command === "bandit") {
      const city = requireCity(flags.city);
      const cityCfg = getCityConfig(city);
      const nowIso = new Date(clock.now()).toISOString();
      const campaignId =
        typeof flags.campaign === "string"
          ? flags.campaign
          : city === "nyc"
            ? NYC_LAUNCH_CAMPAIGN.id
            : `${city}-launch-m1`;
      const seed = typeof flags.seed === "string" ? flags.seed : `${city}-cli-1`;
      const arms = createDefaultBanditArms(campaignId, city, nowIso);
      const rebalance = computeBanditAllocations({
        campaignId,
        arms,
        availableCents: cityCfg.defaultMonthlyBudgetCents,
        seed,
        nowIso,
        riskDial: "balanced",
        billingArmed: true,
      });
      console.log(JSON.stringify({ mode, city, rebalance }, null, 2));
      return;
    }

    if (command === "hire-batch") {
      const city = requireCity(flags.city);
      const cityCfg = getCityConfig(city);
      const role = (
        typeof flags.role === "string" ? flags.role : "street_fliering"
      ) as HiringRole;
      const budgetCents =
        typeof flags.budget === "string" ? Number(flags.budget) : 25_000;
      const engine = new CrowdsourcingEngine({ store, clock });
      const packet = engine.buildHiringPacket(role, city, budgetCents, {
        neighborhood:
          typeof flags.neighborhood === "string"
            ? flags.neighborhood
            : cityCfg.corridors[0]?.neighborhood ?? cityCfg.label,
        boroughLicenceRef:
          typeof flags.licence === "string" ? flags.licence : undefined,
      });
      console.log(JSON.stringify({ mode, packet }, null, 2));
      return;
    }

    if (command === "bd-list") {
      const city = resolveOptionalCity(flags.city);
      if ((await store.listCampaigns()).length === 0 && mode === "memory") {
        await seedNycLaunch(store);
      }
      const deals = await store.listBdDeals(city ? { city } : {});
      console.log(JSON.stringify({ mode, ...(city ? { city } : {}), deals }, null, 2));
      return;
    }

    if (command === "vip-invite") {
      const city = requireCity(flags.city);
      const cityCfg = getCityConfig(city);
      const vipEngine = new VipDiscoveryEngine({ clock });
      const invite = vipEngine.buildAndValidateVipInvite({
        firstName: typeof flags.name === "string" ? flags.name : "Maya",
        archetypeSlug: typeof flags.archetype === "string" ? flags.archetype : "oss_maintainer",
        city,
        neighborhood:
          typeof flags.neighborhood === "string"
            ? flags.neighborhood
            : cityCfg.corridors[0]?.neighborhood ?? cityCfg.label,
        proofOfWork1Line:
          typeof flags.hook === "string"
            ? flags.hook
            : "your open-source distributed systems benchmarks",
        senderName: "The Operator",
      });
      console.log(JSON.stringify({ mode, invite }, null, 2));
      if (!invite.valid) process.exitCode = 1;
      return;
    }

    if (command === "video-lint") {
      const results = STARTER_COMEDY_SCRIPTS.map((script) => ({
        id: script.id,
        personaId: script.personaId,
        appId: script.appId,
        title: script.title,
        lint: lintVideoScript(script),
      }));
      const failed = results.filter((r) => !r.lint.pass);
      console.log(
        JSON.stringify({ total: results.length, passed: results.length - failed.length, results }, null, 2),
      );
      if (failed.length > 0) process.exitCode = 1;
      return;
    }

    if (command === "slop-cash-preview") {
      if ((await store.listCampaigns()).length === 0) {
        await seedNycLaunch(store);
      }
      const tasks = await store.listTasks();
      const taskId = typeof flags.task === "string" ? flags.task : tasks[0]?.id;
      if (!taskId) {
        throw new Error("No tasks available to preview; run seed-nyc first.");
      }
      const task = await store.getTask(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      const bridge = new SlopCashBridge({ store, clock, configEnabled: false });
      const preview = bridge.previewHook(task);
      console.log(
        JSON.stringify({ mode, status: bridge.status(), preview }, null, 2),
      );
      return;
    }

    if (command === "serve") {
      if ((await store.listCampaigns()).length === 0) {
        await seedNycLaunch(store);
      }
      const port =
        typeof flags.port === "string"
          ? Number(flags.port)
          : Number(process.env.MARKETING_PORT || DEFAULT_MARKETING_PORT);
      const started = await createMarketingServer({
        store,
        clock,
        port,
        hostname: typeof flags.host === "string" ? flags.host : DEFAULT_MARKETING_HOST,
      });
      console.log(
        `Marketing Command Center (${mode}): ${started.url}/#token=${started.token}`,
      );
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

    throw new Error(`Unknown command: ${command}`);
  } finally {
    await store.close();
  }
}

await main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
