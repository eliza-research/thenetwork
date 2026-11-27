import { useState } from "react";
import {
  Alert,
  Button,
  FunnelChart,
  Kpi,
  KpiGrid,
  MeterBars,
  Progress,
  Segments,
  Select,
  SelectItem,
  StatusMark,
  type FunnelStep,
  type MeterRow,
} from "@thenetwork/ui";
import { formatDurationMs, formatMicrosUsd, formatPct, formatUsdCents, humanize } from "../format.ts";
import { marketingStore, useMarketingStore } from "../store.ts";

const riskDials = [
  { value: "conservative", label: "Conservative" },
  { value: "balanced", label: "Balanced" },
  { value: "blitz", label: "Blitz" },
  { value: "lockdown", label: "Lockdown" },
];

export function CommandWorkspace() {
  const s = useMarketingStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [dropOffFocus, setDropOffFocus] = useState<{ from: string; to: string; dropped: number } | null>(null);

  const summary = s.summary;
  const overview = summary?.overview;
  const campaigns = Array.isArray(s.datasets.campaigns) ? s.datasets.campaigns : [];
  const activeCampaign = campaigns.find((c) => c.id === s.selectedCampaignId) ?? campaigns[0];
  const cities = Array.isArray(summary?.cities) ? summary.cities : [];
  const selectedCityPack = cities.find((c) => c.code === s.selectedCity) ?? cities[0];

  const monthlyBudget = activeCampaign?.monthlyBudgetCents ?? overview?.budget?.monthlyBudgetCents ?? 1_000_000;
  const spentCents = activeCampaign?.spentCents ?? overview?.budget?.spentCents ?? 0;
  const reservedCents = activeCampaign?.reservedCents ?? overview?.budget?.reservedCents ?? 0;
  const spendShare = monthlyBudget > 0 ? (spentCents + reservedCents) / monthlyBudget : 0;

  const siteVisits = overview?.attribution?.siteVisits ?? 0;
  const verifiedSignups =
    overview?.attribution?.verifiedAdultSignups ??
    overview?.attribution?.verifiedSignups ??
    overview?.attribution?.signups ??
    0;
  const cpaCents =
    overview?.attribution?.blendedCpaCents ??
    overview?.attribution?.cpaCents ??
    (verifiedSignups > 0 ? Math.round(spentCents / verifiedSignups) : 0);
  const targetCpaCents = overview?.attribution?.targetCpaCents ?? 2500;
  const cpaHistory = (Array.isArray(overview?.attribution?.cpaHistoryCents) ? overview.attribution.cpaHistoryCents : []).map((c) => Math.round(c / 100));

  const signals = summary?.corePressure.signals ?? [];
  const openReviews = signals.reduce((sum, item) => sum + (item.openReviewCount ?? 0), 0);
  const overdueReviews = signals.reduce((sum, item) => sum + (item.overdueReviewCount ?? 0), 0);
  const outboundWaiting = signals.reduce((sum, item) => sum + (item.outboundWaitingCount ?? 0), 0);
  const pressurePaused = Boolean(summary?.corePressure.paused);

  const llmUsage = summary?.llmUsage;
  const llmCostMicros = llmUsage?.usage.costMicros ?? 0;
  const llmCostCapMicros = llmUsage?.caps.dailyCostCapMicros ?? 10_000_000;
  const llmCalls = llmUsage?.usage.calls ?? 0;
  const llmCached = llmUsage?.usage.cachedCalls ?? 0;
  const llmCacheRate = llmCalls > 0 ? llmCached / llmCalls : 0;

  const funnelSteps: FunnelStep[] = (s.funnel?.steps ?? []).map((step) => ({
    key: step.stage,
    label: humanize(step.stage),
    count: step.count,
    medianLatency: formatDurationMs(step.medianTimeFromPrevMs),
  }));

  const rawTracks = overview?.tracks ?? s.directory?.tracks ?? [];
  const trackRows: MeterRow[] = rawTracks.map((track, idx) => {
    const budget =
      track.amountCents ??
      track.monthlyBudgetCents ??
      track.budgetCents ??
      track.allocationCents ??
      track.monthlyCents ??
      0;
    return {
      key: track.track ?? track.key ?? track.id ?? `track-${idx}`,
      label: track.label ?? track.name ?? humanize(track.track ?? track.key ?? `Track ${idx + 1}`),
      value: Math.round(budget / 100),
      tone: "primary",
    };
  });

  const banditRows: MeterRow[] = (overview?.banditArms ?? []).map((arm) => ({
    key: arm.id,
    label: arm.label,
    value: Math.round(arm.weight * 100),
    tone: arm.status === "killed" ? "destructive" : arm.status === "paused" ? "warn" : "ok",
    title: `${arm.track} · ${arm.signups} signups · ${formatUsdCents(arm.spendCents)} spent`,
  }));

  const alerts = s.anomalies?.alerts ?? [];
  const safetyViolations =
    (s.anomalies?.safety.canaryLeaks ?? 0) +
    (s.anomalies?.safety.teenViolationContacts ?? 0) +
    (s.anomalies?.safety.crossAppLeaks ?? 0) +
    (s.anomalies?.safety.unverifiedAdultPayouts ?? 0);

  const runAction = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const simDigest = s.simState?.snapshot?.digest ?? s.lastLaunchSim?.digest;
  const simSeed = s.simState?.snapshot?.seed ?? s.lastLaunchSim?.seeds?.[0];

  return (
    <div className="flex flex-col gap-4">
      <KpiGrid>
        <Kpi
          label="Spend Velocity"
          value={formatUsdCents(spentCents)}
          delta={{ value: `${formatPct(spendShare)} of ${formatUsdCents(monthlyBudget)}`, tone: spendShare > 0.9 ? "warn" : "muted" }}
          tone={spendShare > 0.95 ? "warn" : undefined}
          title={`Reserved: ${formatUsdCents(reservedCents)}`}
        />
        <Kpi
          label="Blended CPA"
          value={cpaCents > 0 ? formatUsdCents(cpaCents) : "—"}
          delta={{ value: `Target ${formatUsdCents(targetCpaCents)}`, tone: cpaCents > 0 && cpaCents <= targetCpaCents ? "ok" : cpaCents > targetCpaCents ? "warn" : "muted" }}
          sparkline={cpaHistory.length >= 2 ? cpaHistory : undefined}
          target={Math.round(targetCpaCents / 100)}
          tone={cpaCents > targetCpaCents ? "warn" : cpaCents > 0 ? "ok" : undefined}
        />
        <Kpi
          label="Verified 18+ Signups"
          value={verifiedSignups.toLocaleString("en-US")}
          delta={{ value: `${siteVisits.toLocaleString("en-US")} visits`, tone: verifiedSignups > 0 ? "ok" : "muted" }}
        />
        <Kpi
          label="Core Queue Pressure"
          value={`${openReviews} open`}
          delta={{ value: `${overdueReviews} overdue · ${outboundWaiting} queued`, tone: overdueReviews > 0 || pressurePaused ? "destructive" : "ok" }}
          tone={pressurePaused || overdueReviews > 0 ? "destructive" : "ok"}
          toneLabel={pressurePaused ? "Backpressure paused" : "Core healthy"}
        />
      </KpiGrid>

      {pressurePaused || overdueReviews > 0 || alerts.length > 0 || safetyViolations > 0 ? (
        <div className="flex flex-col gap-2">
          {pressurePaused || overdueReviews > 0 ? (
            <Alert variant="warn" title="Core queue backpressure">
              {`Paused queues: ${(summary?.corePressure.pausedQueues ?? []).join(", ") || "none"} · ${overdueReviews} overdue reviews · ${outboundWaiting} outbound waiting.`}
            </Alert>
          ) : null}
          {safetyViolations > 0 ? (
            <Alert variant="destructive" title="Safety invariant alert">
              {`${safetyViolations} safety invariant violations detected. Paid acquisition and outreach require immediate inspection.`}
            </Alert>
          ) : null}
          {alerts.slice(0, 3).map((alert) => (
            <Alert key={alert.id} variant={alert.severity === "critical" ? "destructive" : "warn"} title={humanize(alert.metric)}>
              {alert.message}
            </Alert>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">9-Stage Acquisition & Consent Funnel</h2>
            {s.funnel ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                {`${s.funnel.totalActors.toLocaleString("en-US")} actors · k≥${s.funnel.kFloor}`}
              </span>
            ) : null}
          </div>
          <FunnelChart
            steps={funnelSteps}
            onInspectDropOff={(from, to) => setDropOffFocus({ from: from.label, to: to.label, dropped: Math.max(0, from.count - to.count) })}
            empty="Seed a city or step the simulation to populate funnel stages."
          />
          {dropOffFocus ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
              <span className="text-foreground">
                {`Drop-off ${dropOffFocus.from} → ${dropOffFocus.to}: ${dropOffFocus.dropped.toLocaleString("en-US")} actors`}
              </span>
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                {(s.funnel?.dropOffReasons ?? []).slice(0, 3).map((reason) => (
                  <span key={reason.reason} className="tabular-nums">
                    {`${humanize(reason.reason)}: ${reason.suppressed ? "<5" : reason.count}`}
                  </span>
                ))}
                <Button variant="ghost" size="sm" onClick={() => setDropOffFocus(null)}>
                  Clear
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">Bandit Allocation</h2>
              <Button
                variant="outline"
                size="sm"
                loading={busy === "rebalance"}
                onClick={() =>
                  void runAction("rebalance", async () => {
                    await marketingStore.api.rebalanceBandit(activeCampaign?.id);
                    marketingStore.pushToast("ok", "Rebalanced bandit arms");
                    await marketingStore.loadCore();
                  })
                }
              >
                Rebalance
              </Button>
            </div>
            <MeterBars rows={banditRows} ranked={false} max={100} format={(v) => `${v}%`} empty="No bandit arms seeded." />
          </section>

          <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">City Budget Tracks</h2>
              <span className="text-xs tabular-nums text-muted-foreground">{formatUsdCents(monthlyBudget)}</span>
            </div>
            <MeterBars rows={trackRows} ranked={false} format={(v) => `$${v.toLocaleString("en-US")}`} empty="No budget tracks configured." />
          </section>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">City Readiness</h2>
            <div className="w-36">
              <Select aria-label="Target city" value={s.selectedCity} onValueChange={(city) => marketingStore.setSelectedCity(city)} className="h-8 text-xs">
                {(cities.length ? cities : [{ code: "nyc", name: "New York City", stage: "seed_waitlist" }]).map((city) => (
                  <SelectItem key={city.code} value={city.code}>
                    {city.name}
                  </SelectItem>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
            <div className="rounded-sm bg-muted/50 p-2">
              <div className="text-muted-foreground">Stage</div>
              <div className="font-semibold text-foreground">{humanize(selectedCityPack?.overrideStage ?? selectedCityPack?.stage ?? "scout")}</div>
            </div>
            <div className="rounded-sm bg-muted/50 p-2">
              <div className="text-muted-foreground">Waitlist 18+</div>
              <div className="font-semibold text-foreground">{selectedCityPack?.readiness?.verifiedWaitlistAdults ?? 0}</div>
            </div>
            <div className="rounded-sm bg-muted/50 p-2">
              <div className="text-muted-foreground">Signed venues</div>
              <div className="font-semibold text-foreground">{selectedCityPack?.readiness?.signedVenues ?? 0}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={busy === "seed"}
              onClick={() =>
                void runAction("seed", async () => {
                  await marketingStore.api.seedCity(s.selectedCity);
                  marketingStore.pushToast("ok", `Seeded ${s.selectedCity.toUpperCase()} launch pack`);
                  await marketingStore.loadAll();
                })
              }
            >
              {`Seed ${s.selectedCity.toUpperCase()}`}
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={busy === "discover"}
              onClick={() =>
                void runAction("discover", async () => {
                  const res = await marketingStore.api.discoverCity(s.selectedCity);
                  const leads = Array.isArray(res.leads) ? res.leads : [];
                  marketingStore.recordDiscoveredLeads(leads as typeof s.datasets.discoveredLeads);
                  marketingStore.pushToast("ok", `Discovered ${leads.length} ${s.selectedCity.toUpperCase()} leads`);
                })
              }
            >
              Discover Leads
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">LLM Burn & Sim Digest</h2>
            <StatusMark
              tone={llmUsage?.budgetDecision?.allowed === false ? "destructive" : "ok"}
              label={llmUsage?.budgetDecision?.allowed === false ? "Cap reached" : "Within cap"}
              showLabel
            />
          </div>
          <div className="flex flex-col gap-1 text-xs tabular-nums">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">{`${llmCalls} calls · ${llmCached} cached (${formatPct(llmCacheRate)})`}</span>
              <span className="font-mono font-semibold text-foreground">{`${formatMicrosUsd(llmCostMicros)} / ${formatMicrosUsd(llmCostCapMicros)}`}</span>
            </div>
            <Progress value={llmCostMicros} max={Math.max(1, llmCostCapMicros)} aria-label="Daily LLM cost usage" className="h-1.5" />
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-xs">
            <span className="truncate font-mono text-muted-foreground">
              {simDigest ? `Digest ${simDigest.slice(0, 12)} · seed ${simSeed ?? 11}` : "No launch sim digest yet"}
            </span>
            <Button
              variant="outline"
              size="sm"
              loading={busy === "launch-sim"}
              onClick={() => void runAction("launch-sim", () => marketingStore.runLaunchSim(s.selectedCity))}
            >
              Dry-Run Sim
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Campaign Controls</h2>
            <StatusMark
              tone={overview?.daemon?.running ? "ok" : "neutral"}
              label={overview?.daemon?.running ? "Autopilot on" : "Autopilot idle"}
              showLabel
            />
          </div>
          {activeCampaign ? (
            <>
              <Segments
                aria-label="Campaign risk dial"
                value={activeCampaign.riskDial}
                onValueChange={(dial) =>
                  void runAction("risk", async () => {
                    await marketingStore.api.setRiskDial(activeCampaign.id, dial);
                    marketingStore.pushToast("ok", `Risk dial set to ${dial}`);
                    await marketingStore.loadCore();
                  })
                }
                options={riskDials}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={activeCampaign.billingArmed ? "destructive" : "outline"}
                  size="sm"
                  loading={busy === "billing"}
                  onClick={() =>
                    void runAction("billing", async () => {
                      await marketingStore.api.setRiskDial(activeCampaign.id, activeCampaign.riskDial, !activeCampaign.billingArmed);
                      marketingStore.pushToast("ok", activeCampaign.billingArmed ? "Billing disarmed" : "Billing armed");
                      await marketingStore.loadCore();
                    })
                  }
                >
                  {activeCampaign.billingArmed ? "Disarm Billing" : "Arm Billing"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  loading={busy === "daemon"}
                  onClick={() =>
                    void runAction("daemon", async () => {
                      await marketingStore.api.toggleDaemon(!overview?.daemon?.running);
                      await marketingStore.loadCore();
                    })
                  }
                >
                  {overview?.daemon?.running ? "Stop Autopilot" : "Start Autopilot"}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Seed a city to activate campaign controls.</p>
          )}
        </section>
      </div>
    </div>
  );
}
