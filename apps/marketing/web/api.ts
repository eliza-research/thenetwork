import type {
  AnomaliesApiPayload,
  AttributionApiPayload,
  AttributionModel,
  CompliancePayload,
  CoreCohortMatrix,
  DirectoryPayload,
  FunnelResult,
  MockTrafficEntry,
  OpsSummaryPayload,
  OutreachHeatmap,
  SimStateApiPayload,
  SliceResult,
  TimeSeriesApiPayload,
  TrajectoriesApiPayload,
  TrajectoryDetailPayload,
} from "./types.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createApiClient(getToken: () => string) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }
    if (!res.ok) {
      const rec = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
      const msg = typeof rec.error === "string" ? rec.error : `Request failed (${res.status})`;
      const code = typeof rec.code === "string" ? rec.code : undefined;
      throw new ApiError(res.status, msg, code);
    }
    return parsed as T;
  }

  async function requestText(method: string, path: string, body?: unknown): Promise<string> {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, text || `Request failed (${res.status})`);
    return text;
  }

  async function requestOptional<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    try {
      return await request<T>(method, path, body);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
        return null;
      }
      throw err;
    }
  }

  return {
    getOverview: (campaignId?: string) =>
      request<Record<string, unknown>>("GET", campaignId ? `/api/overview?campaignId=${encodeURIComponent(campaignId)}` : "/api/overview"),
    getCampaigns: () => request<{ campaigns: unknown[] }>("GET", "/api/campaigns?limit=100"),
    getOpsSummary: (campaignId?: string) =>
      request<OpsSummaryPayload>("GET", campaignId ? `/api/ops-summary?campaignId=${encodeURIComponent(campaignId)}` : "/api/ops-summary"),
    getCompliance: () => requestOptional<CompliancePayload>("GET", "/api/compliance"),
    getDirectory: (city?: string) =>
      request<DirectoryPayload>("GET", city && city !== "all" ? `/api/directory?city=${encodeURIComponent(city)}` : "/api/directory"),
    seedCity: (city: string) => request<Record<string, unknown>>("POST", `/api/seed/${encodeURIComponent(city)}`, {}),
    discoverCity: (city: string) => request<{ leads?: unknown[]; summary?: { totalLeads?: number } }>("POST", "/api/discovery", { city }),
    rebalanceBandit: (campaignId?: string) =>
      request<Record<string, unknown>>("POST", "/api/bandit/rebalance", campaignId ? { campaignId } : {}),
    setRiskDial: (campaignId: string, riskDial: string, billingArmed?: boolean) =>
      request<Record<string, unknown>>("POST", `/api/campaigns/${encodeURIComponent(campaignId)}/risk-dial`, {
        riskDial,
        ...(billingArmed !== undefined ? { billingArmed } : {}),
      }),
    toggleDaemon: (enabled: boolean) => request<Record<string, unknown>>("POST", "/api/autopilot/daemon", { enabled }),
    runAutopilotTick: (campaignId?: string) =>
      request<Record<string, unknown>>("POST", "/api/autopilot/tick", campaignId ? { campaignId } : {}),

    getAnalyticsFunnel: (campaignId?: string) =>
      requestOptional<FunnelResult>("GET", campaignId ? `/api/analytics/funnel?campaignId=${encodeURIComponent(campaignId)}` : "/api/analytics/funnel"),
    getAnalyticsCohorts: (campaignId?: string) =>
      requestOptional<CoreCohortMatrix>("GET", campaignId ? `/api/analytics/cohorts?campaignId=${encodeURIComponent(campaignId)}` : "/api/analytics/cohorts"),
    getAnalyticsTimeSeries: (granularity = "day", campaignId?: string) => {
      const qs = new URLSearchParams({ granularity });
      if (campaignId) qs.set("campaignId", campaignId);
      return requestOptional<TimeSeriesApiPayload>("GET", `/api/analytics/timeseries?${qs.toString()}`);
    },
    getAnalyticsHeatmap: (campaignId?: string) =>
      requestOptional<OutreachHeatmap>("GET", campaignId ? `/api/analytics/heatmap?campaignId=${encodeURIComponent(campaignId)}` : "/api/analytics/heatmap"),
    getAnalyticsAttribution: (model: AttributionModel, campaignId?: string) => {
      const qs = new URLSearchParams({ model });
      if (campaignId) qs.set("campaignId", campaignId);
      return requestOptional<AttributionApiPayload>("GET", `/api/analytics/attribution?${qs.toString()}`);
    },
    getAnalyticsAnomalies: () => requestOptional<AnomaliesApiPayload>("GET", "/api/analytics/anomalies"),
    querySlice: (params: { metric: string; groupBy: string[]; granularity: string }) =>
      requestOptional<SliceResult>("POST", "/api/analytics/slice", { ...params, format: "json" }),
    exportSlice: (params: { metric: string; groupBy: string[]; granularity: string; format: "csv" | "json" }) =>
      requestText("POST", "/api/analytics/slice", params),

    getBdDeals: () => request<{ deals: unknown[] }>("GET", "/api/bd?limit=200"),
    advanceBdStage: (id: string, stage: string) =>
      request<Record<string, unknown>>("POST", `/api/bd/${encodeURIComponent(id)}/stage`, { stage }),
    startBdCallback: (id: string, businessPhone: string) =>
      request<{ challenge?: { challengeId?: string; expiresAt?: string }; expectedPin?: string }>(
        "POST",
        `/api/bd/${encodeURIComponent(id)}/callback`,
        { businessPhone },
      ),
    verifyBdCallbackPin: (id: string, pin: string) =>
      request<{ verified: boolean }>("POST", `/api/bd/${encodeURIComponent(id)}/callback`, { pin }),
    generateBdContract: (id: string, kind: string) =>
      request<Record<string, unknown>>("POST", `/api/bd/${encodeURIComponent(id)}/contract`, { kind }),
    getQrBatches: () => request<{ batches: unknown[] }>("GET", "/api/qr-batches?limit=100"),
    createQrBatch: (payload: { campaignId: string; city: string; batchCode: string; destinationUrl: string; printQty: number }) =>
      request<Record<string, unknown>>("POST", "/api/qr-batches", payload),

    getVips: () => request<{ prospects: unknown[] }>("GET", "/api/vips?limit=100"),
    draftVipInvite: (id: string, proofOfWork1Line: string) =>
      request<Record<string, unknown>>("POST", `/api/vips/${encodeURIComponent(id)}/invite`, { proofOfWork1Line }),

    getVideos: () => request<{ assets: unknown[] }>("GET", "/api/videos?limit=100"),
    lintVideo: (payload: { id?: string; title: string; hookText: string; dialogue: string; ftcDisclosureText?: string | null }) =>
      request<{ lint: { pass: boolean; errors: string[]; warnings: string[] } }>("POST", "/api/videos/lint", payload),
    advanceVideoStage: (id: string, stage: string) =>
      request<Record<string, unknown>>("POST", `/api/videos/${encodeURIComponent(id)}/stage`, { stage }),

    getOutreach: () => request<{ messages: unknown[] }>("GET", "/api/outreach?limit=200"),
    queueOutreach: (payload: { campaignId: string; agentId: string; humanId: string; channel: string; tier: number; subject: string; bodyText: string }) =>
      request<Record<string, unknown>>("POST", "/api/outreach", payload),
    dispatchOutreach: (campaignId?: string) =>
      request<{ sent?: number; dryRun?: number }>("POST", "/api/outreach/dispatch", campaignId ? { campaignId } : {}),

    getTasks: () => request<{ tasks: unknown[] }>("GET", "/api/tasks?limit=200"),
    getProofs: () => request<{ proofs: unknown[] }>("GET", "/api/proofs?limit=200"),
    reviewProof: (id: string, verdict: "verified" | "rejected", verifierNotes?: string) =>
      request<Record<string, unknown>>("POST", `/api/proofs/${encodeURIComponent(id)}/review`, { verdict, verifierNotes }),
    getAntiFraud: () => request<{ claims: unknown[] }>("GET", "/api/antifraud?limit=200"),
    scanSybilRings: (campaignId?: string) =>
      request<{ scan?: { clusters?: Array<{ clusterId: string; claimIds: string[]; reasons: string[] }> }; quarantinedClaimIds?: string[] }>(
        "POST",
        "/api/antifraud/scan-sybil",
        campaignId ? { campaignId } : {},
      ),
    getHumans: () => request<{ humans: unknown[] }>("GET", "/api/humans?limit=200"),
    stopHuman: (id: string, reason: string) =>
      request<Record<string, unknown>>("POST", `/api/humans/${encodeURIComponent(id)}/stop`, { reason }),
    getSuppressions: () => request<{ suppressions: unknown[] }>("GET", "/api/suppressions?limit=200"),
    addSuppression: (payload: { email?: string; phone?: string; contactHash?: string; reason: string; sourceChannel: string; isMinor: boolean }) =>
      request<Record<string, unknown>>("POST", "/api/suppressions", payload),

    getAgents: () => request<{ agents: unknown[] }>("GET", "/api/agents?limit=50"),
    tickAgent: (id: string, payload: { campaignId?: string; prompt: string }) =>
      request<Record<string, unknown>>("POST", `/api/agents/${encodeURIComponent(id)}/tick`, payload),
    pauseAgent: (id: string) => request<Record<string, unknown>>("POST", `/api/agents/${encodeURIComponent(id)}/pause`, {}),
    resumeAgent: (id: string) => request<Record<string, unknown>>("POST", `/api/agents/${encodeURIComponent(id)}/resume`, {}),
    switchAgentProvider: (id: string, provider: string) =>
      request<Record<string, unknown>>("POST", `/api/agents/${encodeURIComponent(id)}/provider`, { provider }),

    getDevices: () => request<{ devices: unknown[] }>("GET", "/api/devices?limit=50"),
    scanDevices: () => request<{ devices: unknown[] }>("POST", "/api/devices/scan", {}),
    runDeviceAction: (id: string, payload: Record<string, unknown>) =>
      request<Record<string, unknown>>("POST", `/api/devices/${encodeURIComponent(id)}/action`, payload),

    getLlmTrajectories: () => request<{ trajectories: unknown[] }>("GET", "/api/llm/trajectories?limit=100"),
    getTrajectories: () => requestOptional<TrajectoriesApiPayload>("GET", "/api/trajectories?limit=50"),
    getTrajectoryDetail: (traceId: string) =>
      requestOptional<TrajectoryDetailPayload>("GET", `/api/trajectories/${encodeURIComponent(traceId)}?decrypt=1`),

    getSimState: () => requestOptional<SimStateApiPayload>("GET", "/api/sim/state"),
    sendSimCommand: (command: Record<string, unknown>) =>
      requestOptional<{ ok: boolean; reason?: string; state?: SimStateApiPayload }>("POST", "/api/sim/command", command),
    runLaunchSim: (payload: { days?: number; seeds?: number[]; quick?: boolean; cities?: string[] }) =>
      request<{ ok: boolean; summary?: Record<string, unknown> }>("POST", "/api/simulate/launch", payload),
    getMockTraffic: () => requestOptional<{ entries?: MockTrafficEntry[] }>("GET", "/api/sim/mock/traffic?limit=60"),
  };
}

export type MarketingApi = ReturnType<typeof createApiClient>;
