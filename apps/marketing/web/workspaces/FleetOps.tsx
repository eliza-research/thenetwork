import { useState } from "react";
import {
  Button,
  DataCell,
  DataTable,
  Progress,
  Select,
  SelectItem,
  StatusMark,
  TableRow,
  TraceWaterfall,
  type TraceSpan,
  type TraceSpanStatus,
} from "@thenetwork/ui";
import type { DeviceNode } from "../../src/types.ts";
import { formatMicrosUsd, humanize } from "../format.ts";
import { marketingStore, useMarketingStore } from "../store.ts";
import type { AgentTickResult } from "../types.ts";

const providers = ["chatgpt", "claude", "gemini", "surplus"];

function toWaterfallStatus(status: string): TraceSpanStatus {
  if (status === "ok" || status === "cached") return "ok";
  if (status === "fallback") return "fallback";
  if (status === "leak_blocked") return "leak_blocked";
  if (status === "flagged" || status === "budget_blocked") return "flagged";
  return "error";
}

export function FleetOpsWorkspace() {
  const s = useMarketingStore();
  const [busy, setBusy] = useState<string | null>(null);

  const agents = Array.isArray(s.datasets.agents) ? s.datasets.agents : [];
  const devices = Array.isArray(s.datasets.devices) ? s.datasets.devices : [];
  const adapters = Array.isArray(s.summary?.overview.adapters) ? s.summary.overview.adapters : [];
  const slopCash = s.summary?.overview.slopCash;
  const activeCampaignId = s.selectedCampaignId || s.datasets.campaigns[0]?.id;

  const waterfallSpans: TraceSpan[] =
    s.datasets.selectedTraceSpans.length > 0
      ? s.datasets.selectedTraceSpans.map((span) => ({
          id: span.spanId,
          parentId: span.parentSpanId ?? null,
          name: span.name,
          service: span.app,
          startMs: span.startedAt,
          durationMs: span.durationMs,
          status: toWaterfallStatus(span.status),
          tokens: (span.metrics?.inputTokens ?? 0) + (span.metrics?.outputTokens ?? 0) || undefined,
          costUsd: span.metrics?.costMicros ? span.metrics.costMicros / 1_000_000 : undefined,
          model: span.metrics?.model,
          input: span.payloadState === "shredded" ? "[crypto-shredded]" : span.payload,
          attributes: span.tags,
        }))
      : s.datasets.llmTrajectories.slice(0, 12).map((item, idx) => ({
          id: item.id,
          name: `${item.provider}.${item.model}`,
          service: item.agentId ?? "marketing",
          startMs: idx * 200,
          durationMs: Math.max(10, item.latencyMs),
          status: toWaterfallStatus(item.status),
          tokens: item.inputTokens + item.outputTokens,
          costUsd: item.costMicros / 1_000_000,
          model: item.model,
          attributes: {
            cached: item.cached,
            leak_blocked: item.leakBlocked,
          },
        }));

  const handleTickAgent = async (agentId: string, displayName: string) => {
    setBusy(`tick-${agentId}`);
    try {
      const res = (await marketingStore.api.tickAgent(agentId, {
        campaignId: activeCampaignId,
        prompt: `Review ${s.selectedCity.toUpperCase()} active funnel pressure and propose next safe growth action.`,
      })) as unknown as AgentTickResult;
      marketingStore.recordAgentTick(agentId, res);
      marketingStore.pushToast(res.ok ? "ok" : "destructive", res.ok ? `Ticked ${displayName}` : res.reason ?? "Tick blocked");
      await marketingStore.loadCore();
    } catch (err) {
      marketingStore.pushToast("destructive", err instanceof Error ? err.message : "Agent tick failed");
    } finally {
      setBusy(null);
    }
  };

  const handleDeviceAction = async (device: DeviceNode, kind: "tap" | "screenshot" | "resolve_takeover") => {
    setBusy(`dev-${device.id}-${kind}`);
    try {
      if (kind === "resolve_takeover") {
        await marketingStore.sendSimCommand({ type: "resolve_device_takeover", deviceId: device.id }, `Cleared takeover on ${device.label}`);
      } else {
        const action =
          device.platform === "ios"
            ? kind === "tap"
              ? { kind: "wda_tap", x: 180, y: 420 }
              : { kind: "wda_screenshot" }
            : kind === "tap"
              ? { kind: "tap", x: 540, y: 1200 }
              : { kind: "screenshot" };
        await marketingStore.api.runDeviceAction(device.id, {
          action,
          leaseHolder: "operator",
          dryRun: true,
        });
        marketingStore.pushToast("ok", `Ran ${device.platform.toUpperCase()} ${action.kind} on ${device.label}`);
      }
      await marketingStore.loadCore();
    } catch (err) {
      marketingStore.pushToast("destructive", err instanceof Error ? err.message : "Device action blocked");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">5-Agent Fleet</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => {
            const tick = s.lastAgentTick[agent.id];
            return (
              <div key={agent.id} className="flex flex-col gap-2.5 rounded-md border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{agent.displayName}</div>
                    <div className="text-xs text-muted-foreground">{`${agent.appId} · failover ${agent.failoverProvider ?? "none"}`}</div>
                  </div>
                  <StatusMark
                    tone={agent.status === "paused_stop" || agent.status === "rate_limited" ? "warn" : agent.sessionHealthy ? "ok" : "destructive"}
                    label={humanize(agent.status)}
                    showLabel
                  />
                </div>

                <div className="flex flex-col gap-1 text-xs tabular-nums">
                  <div className="flex items-baseline justify-between text-muted-foreground">
                    <span>Daily turns</span>
                    <span className="font-mono text-foreground">{`${agent.turnsUsedToday}/${agent.dailyTurnCap}`}</span>
                  </div>
                  <Progress value={agent.turnsUsedToday} max={Math.max(1, agent.dailyTurnCap)} aria-label={`Turns for ${agent.displayName}`} className="h-1.5" />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="w-28">
                    <Select
                      aria-label={`Provider for ${agent.displayName}`}
                      value={agent.provider}
                      onValueChange={(provider) => {
                        void (async () => {
                          await marketingStore.api.switchAgentProvider(agent.id, provider);
                          marketingStore.pushToast("ok", `${agent.displayName} switched to ${provider}`);
                          await marketingStore.loadCore();
                        })();
                      }}
                      className="h-8 text-xs"
                    >
                      {providers.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy === `tick-${agent.id}`}
                    onClick={() => void handleTickAgent(agent.id, agent.displayName)}
                  >
                    Tick
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void (async () => {
                        if (agent.status === "paused_stop") await marketingStore.api.resumeAgent(agent.id);
                        else await marketingStore.api.pauseAgent(agent.id);
                        await marketingStore.loadCore();
                      })();
                    }}
                  >
                    {agent.status === "paused_stop" ? "Resume" : "Pause"}
                  </Button>
                </div>

                {tick ? (
                  <div className="flex flex-col gap-1 rounded-sm border border-border bg-background p-2 text-xs">
                    <div className="flex items-center justify-between gap-2 tabular-nums">
                      <span className="font-mono text-muted-foreground">{`${tick.providerUsed ?? agent.provider}${tick.cached ? " · cached" : ""}`}</span>
                      <StatusMark tone={tick.leakBlocked ? "destructive" : tick.ok ? "ok" : "warn"} label={tick.leakBlocked ? "Leak blocked" : tick.ok ? "Clean" : "Blocked"} showLabel />
                    </div>
                    {tick.outputText ? <p className="line-clamp-3 text-foreground">{tick.outputText}</p> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Trajectory Inspector</h2>
          {s.datasets.trajectories.length > 0 ? (
            <div className="w-72">
              <Select
                aria-label="Select trace"
                value={s.datasets.selectedTraceId ?? s.datasets.trajectories[0]?.traceId ?? ""}
                onValueChange={(id) => void marketingStore.selectTrace(id)}
                className="h-8 text-xs"
              >
                {s.datasets.trajectories.map((trace) => (
                  <SelectItem key={trace.traceId} value={trace.traceId}>
                    {`${trace.kind} · ${trace.traceId.slice(0, 10)} (${formatMicrosUsd(trace.costMicros)})`}
                  </SelectItem>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
        <TraceWaterfall spans={waterfallSpans} empty="Tick an agent or step simulation to capture trajectory spans." />
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Device Telemetry</h2>
          <Button
            variant="outline"
            size="sm"
            loading={busy === "scan-dev"}
            onClick={() => {
              void (async () => {
                setBusy("scan-dev");
                try {
                  await marketingStore.api.scanDevices();
                  marketingStore.pushToast("ok", "Scanned connected devices");
                  await marketingStore.loadCore();
                } finally {
                  setBusy(null);
                }
              })();
            }}
          >
            Scan Devices
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((device) => (
            <div key={device.id} className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-foreground">{device.label}</div>
                  <div className="text-muted-foreground">{`${device.platform.toUpperCase()} · ${device.hostMachine} · Day ${device.warmupDay}`}</div>
                </div>
                <StatusMark
                  tone={device.status === "needs_takeover" || device.status === "thermal_cooldown" ? "destructive" : device.status === "online" ? "ok" : "warn"}
                  label={humanize(device.status)}
                  showLabel
                />
              </div>
              <div className="grid grid-cols-3 gap-2 tabular-nums">
                <div className="rounded-sm bg-muted/50 p-1.5">
                  <div className="text-muted-foreground">Battery</div>
                  <div className="font-semibold text-foreground">{`${device.batteryPct}%`}</div>
                </div>
                <div className="rounded-sm bg-muted/50 p-1.5">
                  <div className="text-muted-foreground">Temp</div>
                  <div className="font-semibold text-foreground">{`${device.tempC}°C`}</div>
                </div>
                <div className="rounded-sm bg-muted/50 p-1.5">
                  <div className="text-muted-foreground">Actions</div>
                  <div className="font-semibold text-foreground">{`${device.dailyActionsUsed}/${device.dailyActionCap}`}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {device.platform === "android" || device.platform === "ios" ? (
                  <>
                    <Button variant="outline" size="sm" loading={busy === `dev-${device.id}-tap`} onClick={() => void handleDeviceAction(device, "tap")}>
                      {device.platform === "ios" ? "WDA Tap" : "ADB Tap"}
                    </Button>
                    <Button variant="outline" size="sm" loading={busy === `dev-${device.id}-screenshot`} onClick={() => void handleDeviceAction(device, "screenshot")}>
                      {device.platform === "ios" ? "WDA Shot" : "ADB Shot"}
                    </Button>
                  </>
                ) : (
                  <span className="text-muted-foreground">Host controller</span>
                )}
                {device.status === "needs_takeover" ? (
                  <Button variant="destructive" size="sm" onClick={() => void handleDeviceAction(device, "resolve_takeover")}>
                    Resolve Takeover
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Adapter Readiness</h2>
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <DataTable
              columns={[
                { key: "adapter", label: "Adapter" },
                { key: "mode", label: "Mode" },
                { key: "status", label: "Status" },
              ]}
              empty={adapters.length === 0 ? "No adapters reported." : undefined}
            >
              {adapters.map((adapter) => (
                <TableRow key={adapter.id}>
                  <DataCell>{adapter.label ?? humanize(adapter.id)}</DataCell>
                  <DataCell muted>{adapter.mode ?? (adapter.live ? "live" : "dry-run")}</DataCell>
                  <DataCell>
                    <StatusMark
                      tone={adapter.configured || adapter.live ? "ok" : "neutral"}
                      label={adapter.readiness ?? adapter.status ?? (adapter.configured ? "Ready" : "Dry-run")}
                      showLabel
                    />
                  </DataCell>
                </TableRow>
              ))}
            </DataTable>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">External HTTP Mock Traffic</h2>
            <Button variant="outline" size="sm" onClick={() => void marketingStore.loadWorkspaceData("fleet")}>
              Refresh Log
            </Button>
          </div>
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <DataTable
              columns={[
                { key: "svc", label: "Service" },
                { key: "req", label: "Request" },
                { key: "code", label: "Status", numeric: true },
                { key: "ms", label: "Latency", numeric: true },
              ]}
              empty={s.datasets.mockTraffic.length === 0 ? "Step simulation to capture mock HTTP traffic." : undefined}
            >
              {s.datasets.mockTraffic.slice(0, 20).map((entry) => (
                <TableRow key={entry.id ?? `${entry.service}-${entry.seq ?? 0}-${entry.path}`}>
                  <DataCell>{entry.service}</DataCell>
                  <DataCell className="font-mono text-xs">{`${entry.method} ${entry.path}`}</DataCell>
                  <DataCell numeric>
                    <span className={entry.status >= 400 ? "font-semibold text-destructive" : "text-ok"}>{entry.status}</span>
                  </DataCell>
                  <DataCell numeric muted>{`${entry.latencyMs ?? entry.durationMs ?? 0}ms`}</DataCell>
                </TableRow>
              ))}
            </DataTable>
          </div>
        </section>
      </div>

      <footer className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span>slop.cash settlement hook</span>
        <StatusMark tone="neutral" label={slopCash?.enabled ? "Enabled" : "Locked off"} showLabel />
      </footer>
    </div>
  );
}
