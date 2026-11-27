import { useSyncExternalStore } from "react";
import { ApiError, createApiClient, type MarketingApi } from "./api.ts";
import type {
  AgentTickResult,
  AnomaliesApiPayload,
  AttributionApiPayload,
  AttributionModel,
  BrandTheme,
  CompliancePayload,
  CoreCohortMatrix,
  DirectoryPayload,
  FunnelResult,
  OpsSummaryPayload,
  OutreachHeatmap,
  SimStateApiPayload,
  SliceResult,
  TimeSeriesApiPayload,
  ToastItem,
  WorkspaceDatasets,
  WorkspaceId,
} from "./types.ts";

const TOKEN_KEY = "thenetwork.marketing.token";

function readInitialToken(): string {
  if (typeof window === "undefined") return "";
  const hash = window.location.hash;
  const match = /(?:^#|&)token=([^&]+)/.exec(hash);
  if (match?.[1]) {
    const decoded = decodeURIComponent(match[1]);
    try {
      window.sessionStorage.setItem(TOKEN_KEY, decoded);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      return decoded;
    }
    return decoded;
  }
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export interface MarketingStoreState {
  token: string;
  authStatus: "checking" | "authed" | "unauthorized" | "error";
  authMessage: string | null;
  workspace: WorkspaceId;
  brand: BrandTheme;
  selectedCity: string;
  selectedCampaignId: string;
  attributionModel: AttributionModel;
  sseConnected: boolean;
  loading: boolean;
  summary: OpsSummaryPayload | null;
  compliance: CompliancePayload | null;
  directory: DirectoryPayload | null;
  funnel: FunnelResult | null;
  cohorts: CoreCohortMatrix | null;
  timeseries: TimeSeriesApiPayload | null;
  heatmap: OutreachHeatmap | null;
  attribution: AttributionApiPayload | null;
  anomalies: AnomaliesApiPayload | null;
  sliceResult: SliceResult | null;
  simState: SimStateApiPayload | null;
  lastLaunchSim: { digest?: string; seeds?: number[]; pass?: boolean; summary?: Record<string, unknown> } | null;
  lastAgentTick: Record<string, AgentTickResult>;
  datasets: WorkspaceDatasets;
  toasts: ToastItem[];
}

const emptyDatasets = (): WorkspaceDatasets => ({
  campaigns: [],
  agents: [],
  devices: [],
  deals: [],
  qrBatches: [],
  vips: [],
  videos: [],
  outreach: [],
  tasks: [],
  proofs: [],
  claims: [],
  humans: [],
  suppressions: [],
  llmTrajectories: [],
  trajectories: [],
  hotTail: [],
  selectedTraceId: null,
  selectedTraceSpans: [],
  mockTraffic: [],
  discoveredLeads: [],
});

class MarketingStore {
  private state: MarketingStoreState;
  private listeners = new Set<() => void>();
  private toastSeq = 0;
  private sseAbort: AbortController | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  readonly api: MarketingApi;

  constructor() {
    const token = readInitialToken();
    this.state = {
      token,
      authStatus: token ? "checking" : "unauthorized",
      authMessage: null,
      workspace: "command",
      brand: "network",
      selectedCity: "nyc",
      selectedCampaignId: "",
      attributionModel: "last_touch",
      sseConnected: false,
      loading: false,
      summary: null,
      compliance: null,
      directory: null,
      funnel: null,
      cohorts: null,
      timeseries: null,
      heatmap: null,
      attribution: null,
      anomalies: null,
      sliceResult: null,
      simState: null,
      lastLaunchSim: null,
      lastAgentTick: {},
      datasets: emptyDatasets(),
      toasts: [],
    };
    this.api = createApiClient(() => this.state.token);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.state;

  private update(patch: Partial<MarketingStoreState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  pushToast(tone: ToastItem["tone"], message: string) {
    const id = ++this.toastSeq;
    const next = [...this.state.toasts.slice(-3), { id, tone, message }];
    this.update({ toasts: next });
    setTimeout(() => {
      this.update({ toasts: this.state.toasts.filter((item) => item.id !== id) });
    }, 4500);
  }

  dismissToast(id: number) {
    this.update({ toasts: this.state.toasts.filter((item) => item.id !== id) });
  }

  setToken(token: string) {
    const trimmed = token.trim();
    try {
      if (trimmed) window.sessionStorage.setItem(TOKEN_KEY, trimmed);
      else window.sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      this.state.token = trimmed;
    }
    this.update({ token: trimmed, authStatus: trimmed ? "checking" : "unauthorized", authMessage: null });
    if (trimmed) {
      void this.loadAll();
      this.connectSse();
    } else {
      this.disconnectSse();
    }
  }

  setWorkspace(workspace: WorkspaceId) {
    this.update({ workspace });
    void this.loadWorkspaceData(workspace);
  }

  setBrand(brand: BrandTheme) {
    this.update({ brand });
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-brand", brand);
    }
  }

  setSelectedCity(city: string) {
    this.update({ selectedCity: city });
    void this.api.getDirectory(city).then((directory) => this.update({ directory })).catch(() => undefined);
  }

  setSelectedCampaign(campaignId: string) {
    this.update({ selectedCampaignId: campaignId });
    void this.loadCore();
  }

  setAttributionModel(model: AttributionModel) {
    this.update({ attributionModel: model });
    void this.api
      .getAnalyticsAttribution(model, this.state.selectedCampaignId || undefined)
      .then((attribution) => {
        if (attribution) this.update({ attribution });
      })
      .catch(() => undefined);
  }

  async loadAll() {
    if (!this.state.token) {
      this.update({ authStatus: "unauthorized" });
      return;
    }
    this.update({ loading: true });
    try {
      await this.loadCore();
      await this.loadWorkspaceData(this.state.workspace);
    } finally {
      this.update({ loading: false });
    }
  }

  async loadCore() {
    const cid = this.state.selectedCampaignId || undefined;
    try {
      const [summary, campaignsRes, agentsRes, devicesRes, directory, funnel, anomalies, simState, compliance] = await Promise.all([
        this.api.getOpsSummary(cid),
        this.api.getCampaigns().catch(() => ({ campaigns: [] })),
        this.api.getAgents().catch(() => ({ agents: [] })),
        this.api.getDevices().catch(() => ({ devices: [] })),
        this.api.getDirectory(this.state.selectedCity).catch(() => null),
        this.api.getAnalyticsFunnel(cid).catch(() => null),
        this.api.getAnalyticsAnomalies().catch(() => null),
        this.api.getSimState().catch(() => null),
        this.api.getCompliance().catch(() => null),
      ]);
      const campaigns = Array.isArray(campaignsRes.campaigns)
        ? (campaignsRes.campaigns as WorkspaceDatasets["campaigns"])
        : [];
      const agents = Array.isArray(agentsRes.agents)
        ? (agentsRes.agents as WorkspaceDatasets["agents"])
        : [];
      const devices = Array.isArray(devicesRes.devices)
        ? (devicesRes.devices as WorkspaceDatasets["devices"])
        : [];
      const nextCampaign = this.state.selectedCampaignId || campaigns[0]?.id || "";
      this.update({
        authStatus: "authed",
        authMessage: null,
        summary,
        directory: directory ?? this.state.directory,
        funnel: funnel ?? this.state.funnel,
        anomalies: anomalies ?? this.state.anomalies,
        simState: simState ?? this.state.simState,
        compliance: compliance ?? summary.overview.compliance ?? this.state.compliance,
        selectedCampaignId: nextCampaign,
        datasets: {
          ...this.state.datasets,
          campaigns,
          agents,
          devices,
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.disconnectSse();
        this.update({ authStatus: "unauthorized", authMessage: "Invalid or expired bearer token." });
      } else {
        const msg = err instanceof Error ? err.message : "Failed to load Command Center.";
        this.update({ authStatus: this.state.summary ? "authed" : "error", authMessage: msg });
        this.pushToast("destructive", msg);
      }
    }
  }

  async loadWorkspaceData(workspace: WorkspaceId) {
    if (this.state.authStatus !== "authed" && !this.state.token) return;
    const cid = this.state.selectedCampaignId || undefined;
    try {
      if (workspace === "analytics") {
        const [timeseries, cohorts, heatmap, attribution, funnel] = await Promise.all([
          this.api.getAnalyticsTimeSeries("day", cid).catch(() => null),
          this.api.getAnalyticsCohorts(cid).catch(() => null),
          this.api.getAnalyticsHeatmap(cid).catch(() => null),
          this.api.getAnalyticsAttribution(this.state.attributionModel, cid).catch(() => null),
          this.api.getAnalyticsFunnel(cid).catch(() => null),
        ]);
        this.update({
          timeseries: timeseries ?? this.state.timeseries,
          cohorts: cohorts ?? this.state.cohorts,
          heatmap: heatmap ?? this.state.heatmap,
          attribution: attribution ?? this.state.attribution,
          funnel: funnel ?? this.state.funnel,
        });
      } else if (workspace === "outreach") {
        const [dealsRes, qrRes, vipsRes, videosRes, outreachRes, humansRes] = await Promise.all([
          this.api.getBdDeals().catch(() => ({ deals: [] })),
          this.api.getQrBatches().catch(() => ({ batches: [] })),
          this.api.getVips().catch(() => ({ prospects: [] })),
          this.api.getVideos().catch(() => ({ assets: [] })),
          this.api.getOutreach().catch(() => ({ messages: [] })),
          this.api.getHumans().catch(() => ({ humans: [] })),
        ]);
        this.update({
          datasets: {
            ...this.state.datasets,
            deals: dealsRes.deals as WorkspaceDatasets["deals"],
            qrBatches: qrRes.batches as WorkspaceDatasets["qrBatches"],
            vips: vipsRes.prospects as WorkspaceDatasets["vips"],
            videos: videosRes.assets as WorkspaceDatasets["videos"],
            outreach: outreachRes.messages as WorkspaceDatasets["outreach"],
            humans: humansRes.humans as WorkspaceDatasets["humans"],
          },
        });
      } else if (workspace === "trust") {
        const [tasksRes, proofsRes, afRes, humansRes, supRes, compliance] = await Promise.all([
          this.api.getTasks().catch(() => ({ tasks: [] })),
          this.api.getProofs().catch(() => ({ proofs: [] })),
          this.api.getAntiFraud().catch(() => ({ claims: [] })),
          this.api.getHumans().catch(() => ({ humans: [] })),
          this.api.getSuppressions().catch(() => ({ suppressions: [] })),
          this.api.getCompliance().catch(() => null),
        ]);
        this.update({
          compliance: compliance ?? this.state.compliance,
          datasets: {
            ...this.state.datasets,
            tasks: tasksRes.tasks as WorkspaceDatasets["tasks"],
            proofs: proofsRes.proofs as WorkspaceDatasets["proofs"],
            claims: afRes.claims as WorkspaceDatasets["claims"],
            humans: humansRes.humans as WorkspaceDatasets["humans"],
            suppressions: supRes.suppressions as WorkspaceDatasets["suppressions"],
          },
        });
      } else if (workspace === "fleet") {
        const [llmRes, trajRes, mockRes] = await Promise.all([
          this.api.getLlmTrajectories().catch(() => ({ trajectories: [] })),
          this.api.getTrajectories().catch(() => null),
          this.api.getMockTraffic().catch(() => null),
        ]);
        const traces = trajRes?.traces ?? [];
        const selectedTraceId = this.state.datasets.selectedTraceId ?? traces[0]?.traceId ?? null;
        let selectedTraceSpans = this.state.datasets.selectedTraceSpans;
        if (selectedTraceId) {
          const detail = await this.api.getTrajectoryDetail(selectedTraceId).catch(() => null);
          if (detail) selectedTraceSpans = detail.spans;
        }
        this.update({
          datasets: {
            ...this.state.datasets,
            llmTrajectories: llmRes.trajectories as WorkspaceDatasets["llmTrajectories"],
            trajectories: traces,
            hotTail: trajRes?.hotTail ?? [],
            selectedTraceId,
            selectedTraceSpans,
            mockTraffic: mockRes?.entries ?? [],
          },
        });
      }
    } catch (err) {
      if (err instanceof Error) this.pushToast("destructive", err.message);
    }
  }

  async selectTrace(traceId: string) {
    this.update({ datasets: { ...this.state.datasets, selectedTraceId: traceId } });
    const detail = await this.api.getTrajectoryDetail(traceId).catch(() => null);
    if (detail) {
      this.update({ datasets: { ...this.state.datasets, selectedTraceId: traceId, selectedTraceSpans: detail.spans } });
    }
  }

  async runSlice(params: { metric: string; groupBy: string[]; granularity: string }) {
    const result = await this.api.querySlice(params).catch((err: unknown) => {
      this.pushToast("destructive", err instanceof Error ? err.message : "Slice query failed");
      return null;
    });
    if (result) {
      this.update({ sliceResult: result });
    }
  }

  async sendSimCommand(command: Record<string, unknown>, toastLabel?: string) {
    try {
      const res = await this.api.sendSimCommand(command);
      if (res?.state) {
        this.update({ simState: res.state });
      } else {
        const fresh = await this.api.getSimState().catch(() => null);
        if (fresh) this.update({ simState: fresh });
      }
      if (res && res.ok === false && res.reason) {
        this.pushToast("destructive", res.reason);
      } else if (toastLabel) {
        this.pushToast("ok", toastLabel);
      }
      this.scheduleRefresh();
    } catch (err) {
      this.pushToast("destructive", err instanceof Error ? err.message : "Simulation command failed");
    }
  }

  async runLaunchSim(city: string) {
    try {
      const res = await this.api.runLaunchSim({ days: 14, seeds: [11], quick: true, cities: [city] });
      const summary = res.summary ?? {};
      this.update({
        lastLaunchSim: {
          digest: typeof summary.digest === "string" ? summary.digest : undefined,
          seeds: Array.isArray(summary.seeds) ? (summary.seeds as number[]) : [11],
          pass: typeof summary.passed === "boolean" ? summary.passed : true,
          summary,
        },
      });
      this.pushToast("ok", `Simulated ${city.toUpperCase()} launch`);
    } catch (err) {
      this.pushToast("destructive", err instanceof Error ? err.message : "Simulation run failed");
    }
  }

  recordAgentTick(agentId: string, result: AgentTickResult) {
    this.update({
      lastAgentTick: { ...this.state.lastAgentTick, [agentId]: result },
    });
  }

  recordDiscoveredLeads(leads: WorkspaceDatasets["discoveredLeads"]) {
    this.update({
      datasets: { ...this.state.datasets, discoveredLeads: leads },
    });
  }

  private scheduleRefresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.loadCore();
      void this.loadWorkspaceData(this.state.workspace);
    }, 350);
  }

  connectSse() {
    this.disconnectSse();
    if (!this.state.token) return;
    const controller = new AbortController();
    this.sseAbort = controller;
    const token = this.state.token;

    const run = async () => {
      try {
        const res = await fetch("/api/events", {
          headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          this.update({ sseConnected: false });
          return;
        }
        this.update({ sseConnected: true });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          if (frames.some((frame) => frame.includes("data:"))) {
            this.scheduleRefresh();
          }
        }
      } catch {
        this.update({ sseConnected: false });
      } finally {
        if (this.sseAbort === controller) {
          this.update({ sseConnected: false });
        }
      }
    };

    void run();
  }

  disconnectSse() {
    if (this.sseAbort) {
      this.sseAbort.abort();
      this.sseAbort = null;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.update({ sseConnected: false });
  }
}

export const marketingStore = new MarketingStore();

export function useMarketingStore(): MarketingStoreState {
  return useSyncExternalStore(marketingStore.subscribe, marketingStore.getSnapshot, marketingStore.getSnapshot);
}
