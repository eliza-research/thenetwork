// Local HTTP Command Center + JSON REST API for @thenetwork/marketing (Node 26).
// Runs strictly on loopback (127.0.0.1:4949) with Bearer token authentication
// (timingSafeEqual) on all /api/* routes. Public GET /health and single-file UI at GET /.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RealClock } from "../../../packages/core/src/clock.ts";
import { adultParticipantAge } from "../../../packages/core/src/generated/marketingPolicy.ts";
import { serveHttp, type HttpServer } from "../../../packages/core/src/runtime/http.ts";
import {
  createPaidAdapterRegistry,
  type PaidAdapterRegistry,
} from "./adapters/paid.ts";
import {
  AgentLifecycleManager,
  type CliProcessRunner,
} from "./agent-lifecycle.ts";
import {
  CrowdsourcingEngine,
  type SubmitProofInput,
} from "./crowdsourcing.ts";
import {
  DeviceBridge,
  toDeviceNode,
  type DeviceAction,
  type DeviceActionContext,
} from "./devices/bridge.ts";
import {
  discoverNycLeads,
  type DiscoverySource,
} from "./discovery.ts";
import {
  buildNycLaunchSeed,
  NYC_LAUNCH_CAMPAIGN,
  NYC_LOCAL_PRINTERS,
  NYC_TIER2_DEVICES,
  SELF_SERVICE_PLATFORMS,
  VETTED_NYC_AGENCIES,
} from "./nyc-seed.ts";
import {
  SlopCashBridge,
  SlopCashDisabledError,
} from "./slop-cash-bridge.ts";
import {
  MemoryMarketingStore,
  PgMarketingStore,
  PolicyViolationError,
  type CreateAttributionEventInput,
  type CreateCampaignInput,
  type CreateTaskInput,
  type MarketingStore,
  type UpsertAgentInput,
  type UpsertDeviceInput,
  type UpsertHumanInput,
} from "./store.ts";
import type {
  BrandAppId,
  Campaign,
  Clock,
  DeviceNode,
  DevicePlatform,
  HumanPartner,
  MarketingAgent,
  MarketingTask,
  OutreachChannel,
  RiskDial,
  SlopCashVaultChain,
} from "./types.ts";

export interface MarketingServerOptions {
  store: MarketingStore;
  clock?: Clock;
  port?: number;
  hostname?: string;
  token?: string;
  deviceBridge?: DeviceBridge;
  paidAdapters?: PaidAdapterRegistry;
  discoveryFetch?: typeof fetch;
  cliRunner?: CliProcessRunner;
  env?: NodeJS.ProcessEnv;
}

export interface NycSeedResult {
  campaign: Campaign;
  agents: MarketingAgent[];
  devices: DeviceNode[];
  agenciesPersisted: HumanPartner[];
  tasks: MarketingTask[];
  directory: {
    agenciesCount: number;
    platformsCount: number;
    printersCount: number;
  };
  budgetTracksCents: Record<string, number>;
}

export async function seedNycLaunch(store: MarketingStore): Promise<NycSeedResult> {
  const seed = buildNycLaunchSeed();

  let campaign = await store.getCampaignBySlug(seed.campaign.slug);
  if (!campaign) {
    campaign = await store.createCampaign({
      id: seed.campaign.id,
      slug: seed.campaign.slug,
      name: seed.campaign.name,
      city: seed.campaign.city,
      appId: seed.campaign.appId,
      riskZone: seed.campaign.riskZone,
      riskDial: seed.campaign.riskDial,
      monthlyBudgetCents: seed.campaign.monthlyBudgetCents,
      dailyCapCents: seed.campaign.dailyCapCents,
      maxTaskCents: seed.campaign.maxTaskCents,
      billingArmed: seed.campaign.billingArmed,
      slopCashEnabled: seed.campaign.slopCashEnabled,
      status: "active",
    });
  }

  const agents: MarketingAgent[] = [];
  for (const agentCfg of seed.agents) {
    const existing = await store.getAgentByPersona(agentCfg.personaId);
    if (existing) {
      agents.push(existing);
    } else {
      const appId: BrandAppId = agentCfg.appId === "all" ? "ntwrk" : agentCfg.appId;
      agents.push(
        await store.upsertAgent({
          id: agentCfg.id,
          personaId: agentCfg.personaId,
          displayName: agentCfg.displayName,
          appId,
          provider: agentCfg.provider,
          failoverProvider: agentCfg.failoverProvider,
          authMode: agentCfg.authMode,
          sessionRef: agentCfg.sessionRef,
          sessionHealthy: true,
          dailyTurnCap: agentCfg.dailyTurnCap,
          turnsUsedToday: 0,
          status: "idle",
        }),
      );
    }
  }

  const devices: DeviceNode[] = [];
  const existingDevices = await store.listDevices();
  const bySerial = new Map(existingDevices.map((d) => [d.serialOrUdid, d]));
  for (const slot of NYC_TIER2_DEVICES) {
    const existing = bySerial.get(slot.serialOrUdid);
    if (existing) {
      devices.push(existing);
    } else {
      devices.push(
        await store.upsertDevice({
          id: slot.id,
          label: slot.label,
          platform: slot.platform as DevicePlatform,
          hostMachine: slot.hostMachine,
          serialOrUdid: slot.serialOrUdid,
          assignedPersona: slot.assignedPersona,
          simCarrier: slot.simCarrier,
          batteryPct: slot.batteryPct,
          tempC: slot.tempC,
          warmupDay: slot.warmupStage === "steady_state" ? 30 : 0,
          warmupStage: slot.warmupStage,
          dailyActionsUsed: 0,
          dailyActionCap: slot.dailyActionCap,
          status: "online",
        }),
      );
    }
  }

  const agenciesPersisted: HumanPartner[] = [];
  for (const agency of VETTED_NYC_AGENCIES) {
    const hmac = `agency:${agency.id}`;
    const existing = await store.getHumanByHmac(hmac);
    if (existing) {
      agenciesPersisted.push(existing);
    } else {
      agenciesPersisted.push(
        await store.upsertHuman({
          handleOrEmailHmac: hmac,
          displayLabel: `${agency.name} (${agency.contactEmailOrIntake})`,
          channel: "email",
          role: "agency",
          city: "nyc",
          lowestAge: null,
          stopped: false,
          banned: false,
        }),
      );
    }
  }

  const existingTasks = await store.listTasks({ campaignId: campaign.id });
  const existingBatch = new Set(existingTasks.map((t) => t.qrBatchCode).filter(Boolean));
  const tasks: MarketingTask[] = [...existingTasks];
  for (const starter of seed.starterTasks) {
    if (existingBatch.has(starter.qrBatchCode)) continue;
    const vendorChannel =
      starter.vendorChannel === "backstage"
        ? "agency_email"
        : starter.vendorChannel === "print_local"
          ? "print_api"
          : starter.vendorChannel;
    const payoutRail =
      starter.payoutRail === "agency_invoice" || starter.payoutRail === "platform_escrow"
        ? "fiat_stripe"
        : starter.payoutRail;
    const taskKind = starter.taskKind === "discovery" ? "digital_outreach" : starter.taskKind;
    tasks.push(
      await store.createTask({
        id: starter.id,
        campaignId: campaign.id,
        tier: starter.tier,
        taskKind,
        city: starter.city,
        title: starter.title,
        briefText: starter.briefText,
        vendorChannel,
        amountCents: starter.amountCents,
        qrBatchCode: starter.qrBatchCode,
        payoutRail,
        status: "drafted",
      }),
    );
  }

  const budgetTracksCents: Record<string, number> = {};
  for (const t of seed.campaign.tracks) {
    budgetTracksCents[t.track] = t.amountCents;
  }

  return {
    campaign,
    agents,
    devices,
    agenciesPersisted,
    tasks,
    directory: {
      agenciesCount: VETTED_NYC_AGENCIES.length,
      platformsCount: SELF_SERVICE_PLATFORMS.length,
      printersCount: NYC_LOCAL_PRINTERS.length,
    },
    budgetTracksCents,
  };
}

function timingSafeBearerMatch(header: string | null, expectedToken: string): boolean {
  if (!header) return false;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const candidate = header.slice(prefix.length).trim();
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expectedToken, "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function readJsonBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpInputError(400, "Invalid JSON request body");
  }
}

class HttpInputError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function mapErrorToResponse(err: unknown): Response {
  if (err instanceof SlopCashDisabledError) {
    return jsonResponse(
      { error: err.message, code: err.code, invariant: err.invariant },
      403,
    );
  }
  if (err instanceof PolicyViolationError) {
    return jsonResponse(
      { error: err.message, code: err.code, invariant: err.invariant },
      403,
    );
  }
  if (err instanceof HttpInputError) {
    return jsonResponse({ error: err.message }, err.status);
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(message)) {
    return jsonResponse({ error: message }, 404);
  }
  return jsonResponse({ error: message }, 400);
}

function renderCommandCenterHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>The Network — Marketing Command Center</title>
  <style>
    :root { --bg: #0f1115; --card: #171a21; --border: #262b36; --text: #f3f5f8; --muted: #98a2b3; --accent: #dcf24a; --danger: #f04438; --ok: #12b76a; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); line-height: 1.45; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid var(--border); background: #12151b; }
    h1 { font-size: 18px; margin: 0; letter-spacing: -0.01em; }
    .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid var(--border); background: #1d222c; }
    .pill.ok { color: var(--ok); border-color: rgba(18,183,106,.4); }
    .pill.warn { color: var(--accent); border-color: rgba(220,242,74,.4); }
    .pill.off { color: var(--danger); border-color: rgba(240,68,56,.4); }
    main { max-width: 1200px; margin: 0 auto; padding: 20px 24px 48px; display: grid; gap: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
    .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 10px; }
    .kpi { font-size: 26px; font-weight: 700; margin: 4px 0; }
    .sub { font-size: 12px; color: var(--muted); }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    button { background: #222733; color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; font-size: 13px; cursor: pointer; }
    button.primary { background: var(--accent); color: #111; border-color: var(--accent); font-weight: 600; }
    button:hover { opacity: 0.9; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 600; }
    pre { background: #0c0e12; border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-size: 12px; overflow: auto; max-height: 260px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>The Network — Marketing Command Center</h1>
      <div class="sub">Local Loopback Control Plane · NYC Month-1 ($10,000 Cap) · Vibestack + Quint Verified</div>
    </div>
    <div id="status-bar" class="actions">
      <span id="slop-pill" class="pill off">slop.cash: DISABLED</span>
      <span id="auth-pill" class="pill warn">Auth: checking...</span>
    </div>
  </header>
  <main>
    <div class="card">
      <h2>Operator Controls</h2>
      <div class="actions">
        <button class="primary" onclick="callApi('POST','/api/seed/nyc')">Seed NYC $10k Launch</button>
        <button onclick="callApi('POST','/api/devices/scan')">Scan Local MacBook Phones</button>
        <button onclick="callApi('POST','/api/discovery/nyc')">Run $0 NYC Discovery</button>
        <button onclick="callApi('POST','/api/autopilot/tick')">Run Autopilot Tick</button>
        <button onclick="refresh()">Refresh Overview</button>
      </div>
    </div>
    <div class="grid" id="kpis"></div>
    <div class="grid">
      <div class="card">
        <h2>5 Branded Agents (ChatGPT / Claude / Gemini / Surplus)</h2>
        <div id="agents-list" class="sub">Loading...</div>
      </div>
      <div class="card">
        <h2>Tier-2 Local Hardware (MacBook + Android + iPhone)</h2>
        <div id="devices-list" class="sub">Loading...</div>
      </div>
    </div>
    <div class="card">
      <h2>Tier-3 Credit-Card Adapter Readiness</h2>
      <div id="adapters-list" class="sub">Loading...</div>
    </div>
    <div class="card">
      <h2>Last Action Output</h2>
      <pre id="output">Ready.</pre>
    </div>
  </main>
  <script>
    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
    let token = hashParams.get("token") || sessionStorage.getItem("marketing_token") || "";
    if (token) sessionStorage.setItem("marketing_token", token);
    const hdrs = () => ({ "Authorization": "Bearer " + token, "Content-Type": "application/json" });
    const usd = (c) => "$" + ((Number(c) || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    async function callApi(method, path, body) {
      const res = await fetch(path, { method, headers: hdrs(), body: body ? JSON.stringify(body) : undefined });
      const data = await res.json().catch(() => ({}));
      document.getElementById("output").textContent = JSON.stringify({ status: res.status, path, data }, null, 2);
      if (res.ok) await refresh();
    }

    async function refresh() {
      const pill = document.getElementById("auth-pill");
      if (!token) {
        pill.textContent = "Auth: add #token=<token> to URL";
        pill.className = "pill off";
        return;
      }
      const [ovRes, agRes, devRes, adRes] = await Promise.all([
        fetch("/api/overview", { headers: hdrs() }),
        fetch("/api/agents", { headers: hdrs() }),
        fetch("/api/devices", { headers: hdrs() }),
        fetch("/api/adapters", { headers: hdrs() }),
      ]);
      if (ovRes.status === 401) {
        pill.textContent = "Auth: 401 Invalid Token";
        pill.className = "pill off";
        return;
      }
      pill.textContent = "Auth: Verified";
      pill.className = "pill ok";
      const ov = await ovRes.json();
      const agents = await agRes.json();
      const devices = await devRes.json();
      const adapters = await adRes.json();

      document.getElementById("slop-pill").textContent = "slop.cash: " + (ov.slopCash && ov.slopCash.enabled ? "ENABLED" : "DISABLED");
      document.getElementById("kpis").innerHTML = [
        ["Monthly Budget", usd(ov.budget.monthlyBudgetCents), "Spent " + usd(ov.budget.spentCents) + " · Remaining " + usd(ov.budget.remainingMonthlyCents)],
        ["Campaigns", String(ov.campaigns.active) + " active", "Billing armed: " + ov.campaigns.billingArmedCount + " · Lockdown: " + ov.campaigns.lockdownCount],
        ["Tasks & Proofs", String(ov.tasks.total) + " tasks", "Paid: " + ov.tasks.paid + " · Verified proofs: " + ov.proofs.verified],
        ["NYC Attribution", String(ov.attribution.verifiedAdultSignups) + " verified 18+", "QR scans: " + ov.attribution.qrScans + " · Blended CPA: " + (ov.attribution.blendedCpaCents ? usd(ov.attribution.blendedCpaCents) : "n/a")],
      ].map(([t, v, s]) => '<div class="card"><h2>' + t + '</h2><div class="kpi">' + v + '</div><div class="sub">' + s + '</div></div>').join("");

      document.getElementById("agents-list").innerHTML = (agents.agents || []).length
        ? "<table><tr><th>Agent</th><th>Provider</th><th>Turns</th><th>Status</th></tr>" +
          agents.agents.map((a) => "<tr><td>" + a.displayName + "</td><td>" + a.provider + "</td><td>" + a.turnsUsedToday + "/" + a.dailyTurnCap + "</td><td>" + a.status + "</td></tr>").join("") + "</table>"
        : "No agents seeded yet.";

      document.getElementById("devices-list").innerHTML = (devices.devices || []).length
        ? "<table><tr><th>Device</th><th>Platform</th><th>Battery / Temp</th><th>Status</th></tr>" +
          devices.devices.map((d) => "<tr><td>" + d.label + "</td><td>" + d.platform + "</td><td>" + d.batteryPct + "% · " + d.tempC + "°C</td><td>" + d.status + "</td></tr>").join("") + "</table>"
        : "No devices registered yet.";

      document.getElementById("adapters-list").innerHTML =
        "<table><tr><th>Adapter</th><th>Tier</th><th>Readiness</th><th>Active Provider</th></tr>" +
        (adapters.adapters || []).map((a) => "<tr><td>" + a.label + "</td><td>T" + a.tier + "</td><td>" + a.readiness + "</td><td>" + (a.activeProvider || "none") + "</td></tr>").join("") + "</table>";
    }
    refresh();
  </script>
</body>
</html>`;
}

export async function createMarketingServer(opts: MarketingServerOptions): Promise<{
  server: HttpServer;
  url: string;
  token: string;
  stop: () => Promise<void>;
}> {
  const env = opts.env ?? process.env;
  const clock = opts.clock ?? opts.store.clock ?? new RealClock();
  const port = opts.port ?? Number(env.MARKETING_PORT || 4949);
  const hostname = opts.hostname ?? "127.0.0.1";
  const token =
    opts.token ?? env.MARKETING_TOKEN?.trim() ?? randomBytes(24).toString("hex");

  const deviceBridge = opts.deviceBridge ?? new DeviceBridge({ clock, env });
  const paidAdapters =
    opts.paidAdapters ?? createPaidAdapterRegistry({ clock, env });
  const agentManager = new AgentLifecycleManager({
    store: opts.store,
    clock,
    env,
    cliRunner: opts.cliRunner,
    dryRun: opts.cliRunner ? false : undefined,
  });
  const crowdsourcing = new CrowdsourcingEngine({
    store: opts.store,
    clock,
    env,
  });
  const slopCashBridge = new SlopCashBridge({
    store: opts.store,
    clock,
    env,
    configEnabled: false,
  });

  const requireAuth = (req: Request): Response | null => {
    if (!timingSafeBearerMatch(req.headers.get("authorization"), token)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    return null;
  };

  const server = await serveHttp({
    hostname,
    port,
    fetch: async (request) => {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();

      if (method === "GET" && path === "/health") {
        return jsonResponse({
          ok: true,
          service: "marketing",
          time: new Date(clock.now()).toISOString(),
        });
      }

      if (method === "GET" && path === "/") {
        return new Response(renderCommandCenterHtml(), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }

      if (path.startsWith("/api/")) {
        const unauthorized = requireAuth(request);
        if (unauthorized) return unauthorized;
      } else {
        return jsonResponse({ error: "Not found" }, 404);
      }

      try {
        // Overview
        if (method === "GET" && path === "/api/overview") {
          const campaignId = url.searchParams.get("campaignId") ?? undefined;
          const overview = await opts.store.getOverview(campaignId);
          return jsonResponse({
            ...overview,
            adapters: paidAdapters.listStatus(),
            slopCash: slopCashBridge.status(),
            directory: {
              agencies: VETTED_NYC_AGENCIES.length,
              platforms: SELF_SERVICE_PLATFORMS.length,
              printers: NYC_LOCAL_PRINTERS.length,
            },
          });
        }

        // Seed NYC launch dataset
        if (method === "POST" && path === "/api/seed/nyc") {
          const seeded = await seedNycLaunch(opts.store);
          return jsonResponse(seeded, 200);
        }

        // Campaigns
        if (method === "GET" && path === "/api/campaigns") {
          const campaigns = await opts.store.listCampaigns();
          return jsonResponse({ campaigns });
        }
        if (method === "POST" && path === "/api/campaigns") {
          const body = await readJsonBody<CreateCampaignInput>(request);
          if (!body.slug || !body.name || !body.appId) {
            throw new HttpInputError(400, "slug, name, and appId are required");
          }
          const campaign = await opts.store.createCampaign(body);
          return jsonResponse({ campaign }, 201);
        }
        const riskDialMatch = /^\/api\/campaigns\/([^/]+)\/risk-dial$/.exec(path);
        if (method === "POST" && riskDialMatch) {
          const id = decodeURIComponent(riskDialMatch[1]!);
          const body = await readJsonBody<{ riskDial: RiskDial; billingArmed?: boolean }>(request);
          if (!body.riskDial) throw new HttpInputError(400, "riskDial is required");
          const campaign = await opts.store.setRiskDial(id, body.riskDial, body.billingArmed);
          return jsonResponse({ campaign });
        }
        const campaignPatchMatch = /^\/api\/campaigns\/([^/]+)$/.exec(path);
        if ((method === "PATCH" || method === "PUT") && campaignPatchMatch) {
          const id = decodeURIComponent(campaignPatchMatch[1]!);
          const body = await readJsonBody<Record<string, unknown>>(request);
          const campaign = await opts.store.updateCampaign(id, body);
          return jsonResponse({ campaign });
        }

        // Agents
        if (method === "GET" && path === "/api/agents") {
          const agents = await opts.store.listAgents();
          return jsonResponse({ agents });
        }
        if (method === "POST" && path === "/api/agents") {
          const body = await readJsonBody<UpsertAgentInput>(request);
          if (!body.personaId || !body.displayName || !body.appId || !body.provider) {
            throw new HttpInputError(
              400,
              "personaId, displayName, appId, and provider are required",
            );
          }
          const agent = await agentManager.registerAgent(body);
          return jsonResponse({ agent }, 201);
        }
        const agentTickMatch = /^\/api\/agents\/([^/]+)\/tick$/.exec(path);
        if (method === "POST" && agentTickMatch) {
          const id = decodeURIComponent(agentTickMatch[1]!);
          const body = await readJsonBody<{
            prompt?: string;
            campaignId?: string | null;
            targetHumanId?: string | null;
            targetStopped?: boolean;
            lastMessageText?: string;
            lockdown?: boolean;
            allowFailover?: boolean;
            dryRun?: boolean;
          }>(request);
          const prompt = body.prompt?.trim() || "Execute scheduled NYC growth coordination turn.";
          const targetContact =
            body.targetHumanId || body.targetStopped !== undefined || body.lastMessageText
              ? {
                  id: body.targetHumanId ?? undefined,
                  stopped: body.targetStopped,
                  lastMessageText: body.lastMessageText,
                }
              : null;
          const result = await agentManager.dispatchTurn(id, prompt, {
            campaignId: body.campaignId ?? null,
            targetContact,
            lockdown: body.lockdown,
            allowFailover: body.allowFailover,
            dryRun: body.dryRun,
          });
          return jsonResponse(result, result.ok ? 200 : 403);
        }
        const agentPauseMatch = /^\/api\/agents\/([^/]+)\/pause$/.exec(path);
        if (method === "POST" && agentPauseMatch) {
          const id = decodeURIComponent(agentPauseMatch[1]!);
          const agent = await agentManager.pauseAgent(id);
          return jsonResponse({ agent });
        }
        const agentResumeMatch = /^\/api\/agents\/([^/]+)\/resume$/.exec(path);
        if (method === "POST" && agentResumeMatch) {
          const id = decodeURIComponent(agentResumeMatch[1]!);
          const agent = await agentManager.resumeAgent(id);
          return jsonResponse({ agent });
        }

        // Devices
        if (method === "GET" && path === "/api/devices") {
          const devices = await opts.store.listDevices();
          return jsonResponse({ devices });
        }
        if (method === "POST" && path === "/api/devices") {
          const body = await readJsonBody<UpsertDeviceInput>(request);
          if (!body.label || !body.platform || !body.serialOrUdid) {
            throw new HttpInputError(400, "label, platform, and serialOrUdid are required");
          }
          const device = await opts.store.upsertDevice(body);
          return jsonResponse({ device }, 201);
        }
        if (method === "POST" && path === "/api/devices/scan") {
          const scan = await deviceBridge.scanConnectedDevices();
          const upserted: DeviceNode[] = [];
          for (const scanned of scan.devices) {
            const node = toDeviceNode(scanned, clock);
            upserted.push(
              await opts.store.upsertDevice({
                id: node.id,
                label: node.label,
                platform: node.platform,
                hostMachine: node.hostMachine,
                serialOrUdid: node.serialOrUdid,
                batteryPct: node.batteryPct,
                tempC: node.tempC,
                warmupDay: node.warmupDay,
                warmupStage: node.warmupStage,
                dailyActionsUsed: node.dailyActionsUsed,
                dailyActionCap: node.dailyActionCap,
                status: node.status,
              }),
            );
          }
          const diagnostics = await deviceBridge.buildSetupDiagnostics();
          return jsonResponse({ scan, devices: upserted, diagnostics });
        }
        const deviceActionMatch = /^\/api\/devices\/([^/]+)\/action$/.exec(path);
        if (method === "POST" && deviceActionMatch) {
          const id = decodeURIComponent(deviceActionMatch[1]!);
          let device = await opts.store.getDevice(id);
          if (!device) throw new HttpInputError(404, `Device not found: ${id}`);
          const body = await readJsonBody<{
            action: DeviceAction;
            leaseHolder?: string;
            lockdown?: boolean;
            targetStopped?: boolean;
            dryRun?: boolean;
            challengeDetected?: boolean;
            batteryPct?: number;
            tempC?: number;
            warmupDay?: number;
          }>(request);
          if (!body.action || typeof body.action !== "object") {
            throw new HttpInputError(400, "action object is required");
          }
          if (
            body.batteryPct !== undefined ||
            body.tempC !== undefined ||
            body.warmupDay !== undefined
          ) {
            device = await opts.store.updateDeviceTelemetry(device.id, {
              batteryPct: body.batteryPct ?? device.batteryPct,
              tempC: body.tempC ?? device.tempC,
              warmupDay: body.warmupDay ?? device.warmupDay,
            });
          }
          const context: DeviceActionContext = {
            leaseHolder: body.leaseHolder ?? "operator",
            lockdown: Boolean(body.lockdown),
            targetStopped: Boolean(body.targetStopped),
            dryRun: body.dryRun,
            challengeDetected: body.challengeDetected,
          };
          const result = await deviceBridge.executeDeviceAction(device, body.action, context);
          if (!result.ok) {
            return jsonResponse(result, 403);
          }
          const updatedDevice = await opts.store.upsertDevice({
            id: device.id,
            label: device.label,
            platform: device.platform,
            hostMachine: device.hostMachine,
            serialOrUdid: device.serialOrUdid,
            assignedPersona: device.assignedPersona,
            simCarrier: device.simCarrier,
            batteryPct: device.batteryPct,
            tempC: device.tempC,
            warmupDay: device.warmupDay,
            warmupStage: device.warmupStage,
            dailyActionsUsed: device.dailyActionsUsed + 1,
            dailyActionCap: device.dailyActionCap,
            leaseHolder: device.leaseHolder,
            leaseExpiresAt: device.leaseExpiresAt,
            status: device.status,
          });
          return jsonResponse({ ...result, device: updatedDevice });
        }

        // Humans
        if (method === "GET" && path === "/api/humans") {
          const humans = await opts.store.listHumans();
          return jsonResponse({ humans });
        }
        if (method === "POST" && path === "/api/humans") {
          const body = await readJsonBody<
            UpsertHumanInput & { requireAdult?: boolean }
          >(request);
          if (!body.handleOrEmailHmac || !body.displayLabel || !body.channel || !body.role) {
            throw new HttpInputError(
              400,
              "handleOrEmailHmac, displayLabel, channel, and role are required",
            );
          }
          const paidRole =
            body.role === "street_worker" || body.role === "creator" || body.requireAdult;
          if (
            paidRole &&
            body.lowestAge !== undefined &&
            body.lowestAge !== null &&
            !adultParticipantAge(body.lowestAge)
          ) {
            throw new PolicyViolationError(
              "UNDERAGE_APPLICANT",
              "inv_adult_only_paid",
              `Paid marketing participant must be at least 18 years old (got ${body.lowestAge}).`,
            );
          }
          const human = await opts.store.upsertHuman(body);
          return jsonResponse({ human }, 201);
        }
        const humanStopMatch = /^\/api\/humans\/([^/]+)\/stop$/.exec(path);
        if (method === "POST" && humanStopMatch) {
          const id = decodeURIComponent(humanStopMatch[1]!);
          const body = await readJsonBody<{ reason?: string }>(request);
          const human = await opts.store.markHumanStopped(id, body.reason ?? "operator_stop");
          return jsonResponse({ human });
        }

        // Tasks
        if (method === "GET" && path === "/api/tasks") {
          const campaignId = url.searchParams.get("campaignId") ?? undefined;
          const tasks = await opts.store.listTasks(campaignId ? { campaignId } : undefined);
          return jsonResponse({ tasks });
        }
        if (method === "POST" && path === "/api/tasks") {
          const body = await readJsonBody<CreateTaskInput>(request);
          if (!body.campaignId || !body.tier || !body.taskKind || !body.title || !body.briefText || !body.vendorChannel) {
            throw new HttpInputError(
              400,
              "campaignId, tier, taskKind, title, briefText, and vendorChannel are required",
            );
          }
          if (
            body.tier === 4 &&
            body.assigneeAgeYears !== undefined &&
            body.assigneeAgeYears !== null &&
            !adultParticipantAge(body.assigneeAgeYears)
          ) {
            throw new PolicyViolationError(
              "UNDERAGE_OR_UNKNOWN_WORKER",
              "inv_adult_only_paid",
              `Tier 4 paid human task requires an adult participant aged 18+ (got ${body.assigneeAgeYears}).`,
            );
          }
          const task = await opts.store.createTask(body);
          return jsonResponse({ task }, 201);
        }

        // Proofs (submit & evaluate + optional payout authorization)
        if (method === "GET" && path === "/api/proofs") {
          const taskId = url.searchParams.get("taskId") ?? undefined;
          const proofs = await opts.store.listProofs(taskId ? { taskId } : undefined);
          return jsonResponse({ proofs });
        }
        if (method === "POST" && path === "/api/proofs") {
          const body = await readJsonBody<SubmitProofInput>(request);
          if (!body.taskId || !body.proofKind) {
            throw new HttpInputError(400, "taskId and proofKind are required");
          }
          const result = await crowdsourcing.submitAndEvaluateProof({
            ...body,
            ftcDisclosed: Boolean(body.ftcDisclosed),
            geoTimeValid: Boolean(body.geoTimeValid),
          });
          if (!result.approved) {
            return jsonResponse(result, 400);
          }
          if (result.payoutError) {
            return jsonResponse(result, 403);
          }
          return jsonResponse(result, 201);
        }

        // Outreach
        if (method === "GET" && path === "/api/outreach") {
          const campaignId = url.searchParams.get("campaignId") ?? undefined;
          const messages = await opts.store.listOutreachMessages(
            campaignId ? { campaignId } : undefined,
          );
          return jsonResponse({ messages });
        }
        if (method === "POST" && path === "/api/outreach") {
          const body = await readJsonBody<{
            campaignId: string;
            agentId: string;
            humanId: string;
            channel: OutreachChannel;
            tier?: 1 | 2 | 3 | 4;
            subject?: string | null;
            bodyText: string;
            dailyOutreachCap?: number;
          }>(request);
          if (!body.campaignId || !body.agentId || !body.humanId || !body.channel || !body.bodyText) {
            throw new HttpInputError(
              400,
              "campaignId, agentId, humanId, channel, and bodyText are required",
            );
          }
          const message = await crowdsourcing.queueOutreach(body);
          const blocked =
            message.status === "blocked_stop" || message.status === "blocked_policy";
          return jsonResponse({ message }, blocked ? 403 : 201);
        }
        if (method === "POST" && path === "/api/outreach/dispatch") {
          const body = await readJsonBody<{
            campaignId?: string;
            dailyOutreachCap?: number;
            dryRun?: boolean;
          }>(request);
          let campaignId = body.campaignId;
          if (!campaignId) {
            const campaigns = await opts.store.listCampaigns({ status: "active" });
            campaignId = campaigns[0]?.id;
          }
          if (!campaignId) throw new HttpInputError(400, "campaignId is required");
          const result = await crowdsourcing.dispatchPendingOutreach(campaignId, {
            dailyOutreachCap: body.dailyOutreachCap,
            dryRun: body.dryRun,
          });
          return jsonResponse(result);
        }

        // Tier-1 $0 Open-Web NYC Discovery
        if (method === "POST" && path === "/api/discovery/nyc") {
          const body = await readJsonBody<{
            city?: string;
            limitPerSource?: number;
            redditSubreddits?: string[];
            youtubeChannelIds?: string[];
            includeSources?: DiscoverySource[];
          }>(request);
          const result = await discoverNycLeads({
            fetchImpl: opts.discoveryFetch,
            clock,
            city: body.city ?? "nyc",
            limitPerSource: body.limitPerSource,
            redditSubreddits: body.redditSubreddits,
            youtubeChannelIds: body.youtubeChannelIds,
            includeSources: body.includeSources,
          });
          return jsonResponse(result);
        }

        // Attribution
        if (method === "GET" && path === "/api/attribution") {
          const campaignId = url.searchParams.get("campaignId") ?? undefined;
          const events = await opts.store.listAttributionEvents(
            campaignId ? { campaignId } : undefined,
          );
          return jsonResponse({ events });
        }
        if (method === "POST" && path === "/api/attribution") {
          const body = await readJsonBody<CreateAttributionEventInput>(request);
          if (!body.campaignId || !body.eventKind || !body.appId) {
            throw new HttpInputError(400, "campaignId, eventKind, and appId are required");
          }
          const event = await opts.store.recordAttributionEvent(body);
          return jsonResponse({ event }, 201);
        }

        // Tier-3/4 Paid Adapters
        if (method === "GET" && path === "/api/adapters") {
          return jsonResponse({
            liveBillingEnabled: paidAdapters.isLiveBillingEnabled(),
            adapters: paidAdapters.listStatus(),
          });
        }

        // slop.cash (disabled by default)
        if (method === "GET" && path === "/api/slop-cash/status") {
          const hooks = await opts.store.listSlopCashHooks();
          return jsonResponse({
            ...slopCashBridge.status(),
            hooks,
          });
        }
        if (method === "POST" && path === "/api/slop-cash/preview") {
          const body = await readJsonBody<{
            taskId: string;
            proofId?: string;
            repoSlug?: string;
            issueNumber?: number | null;
            vaultChain?: SlopCashVaultChain;
          }>(request);
          if (!body.taskId) throw new HttpInputError(400, "taskId is required");
          const task = await opts.store.getTask(body.taskId);
          if (!task) throw new HttpInputError(404, `Task not found: ${body.taskId}`);
          const proof = body.proofId
            ? await opts.store.getProof(body.proofId)
            : (await opts.store.listProofs({ taskId: task.id }))[0] ?? null;
          const preview = slopCashBridge.previewHook(task, proof, {
            repoSlug: body.repoSlug,
            issueNumber: body.issueNumber,
            vaultChain: body.vaultChain,
          });
          const persisted = await opts.store.upsertSlopCashHook({
            taskId: task.id,
            repoSlug: preview.hook.repoSlug,
            issueNumber: preview.hook.issueNumber,
            vaultChain: preview.hook.vaultChain,
            estimatedUsdcCents: preview.hook.estimatedUsdcCents,
            hookState: "disabled_stub",
            enabled: false,
          });
          return jsonResponse({ ...preview, hook: persisted });
        }
        if (method === "POST" && path === "/api/slop-cash/settle") {
          const body = await readJsonBody<{
            taskId?: string;
            proofId?: string;
            repoSlug?: string;
            issueNumber?: number | null;
            vaultChain?: SlopCashVaultChain;
          }>(request);
          if (!slopCashBridge.isEnabled()) {
            throw new SlopCashDisabledError();
          }
          if (!body.taskId) throw new HttpInputError(400, "taskId is required");
          const task = await opts.store.getTask(body.taskId);
          if (!task) throw new HttpInputError(404, `Task not found: ${body.taskId}`);
          const campaign = await opts.store.getCampaign(task.campaignId);
          if (!campaign) throw new HttpInputError(404, `Campaign not found: ${task.campaignId}`);
          const proof = body.proofId
            ? await opts.store.getProof(body.proofId)
            : (await opts.store.listProofs({ taskId: task.id }))[0] ?? null;
          const res = await slopCashBridge.settleHook({
            campaign,
            task,
            proof,
            repoSlug: body.repoSlug,
            issueNumber: body.issueNumber,
            vaultChain: body.vaultChain,
          });
          return jsonResponse(res);
        }

        // Autopilot tick
        if (method === "POST" && path === "/api/autopilot/tick") {
          const body = await readJsonBody<{ campaignId?: string }>(request);
          let campaignId = body.campaignId;
          if (!campaignId) {
            const campaigns = await opts.store.listCampaigns({ status: "active" });
            campaignId = campaigns[0]?.id ?? NYC_LAUNCH_CAMPAIGN.id;
          }
          const result = await agentManager.runAutopilotTick(campaignId);
          return jsonResponse(result);
        }

        return jsonResponse({ error: `Route not found: ${method} ${path}` }, 404);
      } catch (err) {
        return mapErrorToResponse(err);
      }
    },
  });

  const baseUrl = server.url.toString().replace(/\/$/, "");
  return {
    server,
    url: baseUrl,
    token,
    stop: async () => {
      await server.stop(true);
    },
  };
}

const isDirectEntry =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectEntry) {
  const dbUrl = process.env.NETWORK_DATABASE_URL?.trim();
  const clock = new RealClock();
  const store: MarketingStore = dbUrl
    ? new PgMarketingStore(dbUrl, { clock })
    : new MemoryMarketingStore({ clock });

  if (store instanceof PgMarketingStore) {
    await store.migrate();
  }
  const existing = await store.listCampaigns();
  if (existing.length === 0) {
    await seedNycLaunch(store);
  }

  const started = await createMarketingServer({
    store,
    clock,
    port: Number(process.env.MARKETING_PORT || 4949),
    hostname: process.env.MARKETING_HOST || "127.0.0.1",
  });

  console.log(
    `Marketing Command Center (${dbUrl ? "postgres" : "in-memory"}): ${started.url}/#token=${started.token}`,
  );

  const shutdown = async () => {
    await started.stop();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
