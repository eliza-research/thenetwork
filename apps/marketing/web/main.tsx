import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  BrandMark,
  Button,
  Segments,
  Select,
  SelectItem,
  SimControlBar,
  StatusMark,
  Toast,
  Toaster,
  TokenPrompt,
  TopBar,
  type SimChaosOption,
  type SimResponseMode,
  type SimSpeed,
  type SimStepSize,
} from "@thenetwork/ui";
import { ntwrkBrand } from "../../../packages/core/src/generated/brandIdentity.ts";
import { humanize } from "./format.ts";
import { marketingStore, useMarketingStore } from "./store.ts";
import type { BrandTheme, WorkspaceId } from "./types.ts";
import { CommandWorkspace } from "./workspaces/Command.tsx";
import { FieldTrustWorkspace } from "./workspaces/FieldTrust.tsx";
import { FleetOpsWorkspace } from "./workspaces/FleetOps.tsx";
import { GrowthAnalyticsWorkspace } from "./workspaces/GrowthAnalytics.tsx";
import { OutreachPipelinesWorkspace } from "./workspaces/OutreachPipelines.tsx";

const WORKSPACES: { value: WorkspaceId; label: string }[] = [
  { value: "command", label: "Command" },
  { value: "analytics", label: "Growth & Analytics" },
  { value: "outreach", label: "Outreach & Pipelines" },
  { value: "trust", label: "Field & Trust" },
  { value: "fleet", label: "Fleet & Ops" },
];

const DEFAULT_SCENARIOS = [
  { id: "city_launch", label: "City Launch" },
  { id: "viral_spike", label: "Viral Spike" },
  { id: "platform_crackdown", label: "Platform Crackdown" },
  { id: "cold_start", label: "Cold Start" },
  { id: "high_volume_stress", label: "High Volume Stress" },
];

const CHAOS_FAULTS: Array<{ id: string; label: string; rule: Record<string, unknown> }> = [
  { id: "rate_limit_spike", label: "429 Spike", rule: { id: "rate_limit_spike", service: "social", probability: 0.7, fault: { kind: "rate_limit_spike", multiplier: 4, retryAfterSec: 30 }, enabled: true } },
  { id: "shadowban_wave", label: "Shadowban Wave", rule: { id: "shadowban_wave", service: "social", probability: 1, fault: { kind: "shadowban_wave", reachMultiplier: 0.05 }, enabled: true } },
  { id: "email_bounce_storm", label: "Email Bounce Storm", rule: { id: "email_bounce_storm", service: "email", probability: 1, fault: { kind: "email_bounce_storm", hardBounceRate: 0.12, spamComplaintRate: 0.005 }, enabled: true } },
  { id: "stop_storm", label: "STOP Storm", rule: { id: "stop_storm", service: "blooio", probability: 0.5, fault: { kind: "http_error", status: 429, retryAfterSec: 60 }, enabled: true } },
  { id: "blooio_safety", label: "Blooio Safety", rule: { id: "blooio_safety", service: "blooio", probability: 1, fault: { kind: "blooio_safety", action: "reply_only" }, enabled: true } },
  { id: "core_backlog", label: "Core Backlog", rule: { id: "core_backlog", service: "all", probability: 0.8, fault: { kind: "latency", medianMs: 1200 }, enabled: true } },
];

export function App() {
  const s = useMarketingStore();
  const [tokenInput, setTokenInput] = useState("");

  useEffect(() => {
    if (s.token) {
      void marketingStore.loadAll();
      marketingStore.connectSse();
    }
    return () => {
      marketingStore.disconnectSse();
    };
  }, [s.token]);

  if (s.authStatus === "unauthorized" || (!s.token && s.authStatus !== "authed")) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-card p-6 shadow-md">
          <div className="flex items-center gap-2 text-base font-semibold">
            <BrandMark logo={ntwrkBrand.logo} className="size-6" />
            <span>Global Growth Command Center</span>
          </div>
          {s.authMessage ? <Alert variant="destructive">{s.authMessage}</Alert> : null}
          <TokenPrompt
            title="Bearer token required"
            inputLabel="Marketing bearer token"
            placeholder="Paste MARKETING_TOKEN"
            submitLabel="Connect"
            value={tokenInput}
            onValueChange={setTokenInput}
            canSubmit={tokenInput.trim().length > 0}
            onSubmitToken={(tok) => {
              marketingStore.setToken(tok);
              setTokenInput("");
            }}
          />
        </div>
      </main>
    );
  }

  const snap = s.simState?.snapshot;
  const simRunning = snap?.paused !== undefined ? !snap.paused : Boolean(snap?.playing ?? snap?.running);
  const simSpeed: SimSpeed = snap?.speedPreset ?? snap?.speed ?? "60x";
  const simMode: SimResponseMode = snap?.responseMode ?? snap?.responseStats?.mode ?? s.simState?.responseMode ?? "canned";
  const simScenarioId = s.simState?.scenarioId ?? "city_launch";
  const simScenarios =
    s.simState?.scenarios && s.simState.scenarios.length > 0
      ? s.simState.scenarios.map((sc) => ({ id: sc.id, label: sc.title ?? sc.label ?? sc.name ?? humanize(sc.id) }))
      : DEFAULT_SCENARIOS;

  const budgetSpentUsd =
    snap?.llmBudget?.spentUsd ??
    (snap?.llmBudget?.spentMicros !== undefined ? snap.llmBudget.spentMicros / 1_000_000 : undefined) ??
    snap?.responseStats?.costUsd ??
    (s.summary?.llmUsage.usage.costMicros ?? 0) / 1_000_000;
  const budgetLimitUsd =
    snap?.llmBudget?.limitUsd ??
    (snap?.llmBudget?.limitMicros !== undefined ? snap.llmBudget.limitMicros / 1_000_000 : undefined) ??
    snap?.responseStats?.budgetLimitUsd ??
    (s.summary?.llmUsage.caps.dailyCostCapMicros ?? 10_000_000) / 1_000_000;

  const score = Math.round(snap?.scorecard?.totalScore ?? snap?.scorecard?.score ?? snap?.score ?? 100);
  const safetyViolations =
    snap?.scorecard?.safetyViolations ??
    snap?.safetyViolations ??
    (s.anomalies?.safety.canaryLeaks ?? 0) +
      (s.anomalies?.safety.teenViolationContacts ?? 0) +
      (s.anomalies?.safety.crossAppLeaks ?? 0);

  const activeChaosIds = new Set(
    (snap?.activeChaos ?? []).map((item) => (typeof item === "string" ? item : item.id)),
  );
  const chaosOptions: SimChaosOption[] = CHAOS_FAULTS.map((fault) => ({
    id: fault.id,
    label: fault.label,
    active: activeChaosIds.has(fault.id),
  }));

  const simDay = snap?.simDay ?? snap?.scorecard?.simDay;
  const simTimeLabel = (() => {
    if (snap?.simTimeLabel) return snap.simTimeLabel;
    if (snap?.simTimeMs !== undefined && Number.isFinite(snap.simTimeMs)) {
      const dt = new Date(snap.simTimeMs);
      const hh = String(dt.getUTCHours()).padStart(2, "0");
      const mm = String(dt.getUTCMinutes()).padStart(2, "0");
      return `Day ${Math.max(0, Math.floor(simDay ?? 0))} · ${hh}:${mm}`;
    }
    if (simDay !== undefined) return `Day ${Math.max(0, Math.floor(simDay))} · 00:00`;
    return "Sim Ready";
  })();

  const handleStep = (step: SimStepSize) => {
    const preset = step === "15m" ? "+15m" : step === "1h" ? "+1h" : "+1d";
    void marketingStore.sendSimCommand({ type: "step", step: preset });
  };

  const handleToggleChaos = (chaosId: string) => {
    const active = activeChaosIds.has(chaosId);
    const fault = CHAOS_FAULTS.find((f) => f.id === chaosId);
    if (active) {
      void marketingStore.sendSimCommand({ type: "clear_chaos", id: chaosId }, `Cleared ${fault?.label ?? chaosId}`);
    } else if (fault) {
      void marketingStore.sendSimCommand({ type: "trigger_chaos", rule: fault.rule }, `Injected ${fault.label}`);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TopBar
        brand={
          <span className="inline-flex items-center gap-2">
            <BrandMark logo={ntwrkBrand.logo} className="size-5" />
            <span>Command Center</span>
          </span>
        }
        end={
          <div className="flex items-center gap-2">
            <div className="w-28">
              <Select aria-label="Brand theme" value={s.brand} onValueChange={(b) => marketingStore.setBrand(b as BrandTheme)} className="h-8 text-xs">
                <SelectItem value="network">ntwrk.party</SelectItem>
                <SelectItem value="slop">slop.date</SelectItem>
                <SelectItem value="peon">peon.biz</SelectItem>
                <SelectItem value="friends">friends.help</SelectItem>
              </Select>
            </div>
            <StatusMark tone={s.sseConnected ? "ok" : "warn"} label={s.sseConnected ? "Live SSE" : "Polling"} showLabel />
            <Button variant="outline" size="sm" loading={s.loading} onClick={() => void marketingStore.loadAll()}>
              Refresh
            </Button>
          </div>
        }
      >
        <Segments
          aria-label="Command Center workspace"
          value={s.workspace}
          onValueChange={(w) => marketingStore.setWorkspace(w as WorkspaceId)}
          options={WORKSPACES}
        />
      </TopBar>

      <div className="border-b border-border bg-background/95 px-4 py-2">
        <SimControlBar
          running={simRunning}
          onToggleRun={() => void marketingStore.sendSimCommand({ type: simRunning ? "pause" : "play" })}
          onStep={handleStep}
          speed={simSpeed}
          onSpeedChange={(speed) => void marketingStore.sendSimCommand({ type: "set_speed", speed })}
          scenarios={simScenarios}
          scenarioId={simScenarioId}
          onScenarioChange={(scenarioId) =>
            void marketingStore.sendSimCommand({ type: "reset_scenario", scenarioId }, `Loaded ${scenarioId}`)
          }
          responseMode={simMode}
          onResponseModeChange={(mode) =>
            void marketingStore.sendSimCommand({ type: "set_response_mode", mode }, `Response mode: ${mode}`)
          }
          budgetSpentUsd={budgetSpentUsd}
          budgetLimitUsd={budgetLimitUsd}
          chaosOptions={chaosOptions}
          onTriggerChaos={handleToggleChaos}
          score={score}
          safetyViolations={safetyViolations}
          simTimeLabel={simTimeLabel}
        />
      </div>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4">
        {s.workspace === "command" ? <CommandWorkspace /> : null}
        {s.workspace === "analytics" ? <GrowthAnalyticsWorkspace /> : null}
        {s.workspace === "outreach" ? <OutreachPipelinesWorkspace /> : null}
        {s.workspace === "trust" ? <FieldTrustWorkspace /> : null}
        {s.workspace === "fleet" ? <FleetOpsWorkspace /> : null}
      </main>

      <Toaster>
        {s.toasts.map((toast) => (
          <Toast key={toast.id} variant={toast.tone} onDismiss={() => marketingStore.dismissToast(toast.id)}>
            {toast.message}
          </Toast>
        ))}
      </Toaster>
    </div>
  );
}

const mount = document.getElementById("root");
if (mount) {
  createRoot(mount).render(<App />);
}
