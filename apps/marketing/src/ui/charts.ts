import { channelIconSvg, escHtml } from "./icons.ts";

export interface BudgetTrackDatum {
  track: string;
  label: string;
  capCents: number;
  spentCents: number;
  reservedCents?: number;
}

export interface BudgetChartInput {
  monthlyBudgetCents: number;
  spentCents: number;
  reservedCents: number;
  dailySpentCents: number;
  dailyCapCents: number;
  tracks?: readonly BudgetTrackDatum[];
}

export interface FunnelChartInput {
  fliersOrViews: number;
  qrScans: number;
  signupsStarted: number;
  verifiedAdultSignups: number;
  blendedCpaCents: number | null;
  targetCpaCents?: number;
  cpaHistoryCents?: readonly number[];
}

export interface BanditArmDatum {
  armKey: string;
  label: string;
  weight: number;
  uncertainty?: number;
  cpaCents?: number | null;
  status: "active" | "killed" | "paused";
  trend?: "up" | "down" | "flat";
}

export interface BanditChartInput {
  arms: readonly BanditArmDatum[];
  hasObservations?: boolean;
}

export interface DeviceGaugeInput {
  label: string;
  platform: "macbook" | "android" | "ios";
  batteryPct: number;
  tempC: number;
  warmupDay: number;
  dailyActionsUsed: number;
  dailyActionCap: number;
  batteryMin?: number;
  batteryMax?: number;
  tempMaxC?: number;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function fmtUsd(cents: number): string {
  const value = (Number(cents) || 0) / 100;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 1000 ? 0 : 2,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  })}`;
}

function fmtUsdExact(cents: number): string {
  const value = (Number(cents) || 0) / 100;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtInt(n: number): string {
  return Math.max(0, Math.round(Number(n) || 0)).toLocaleString("en-US");
}

const DEFAULT_NYC_TRACKS: readonly BudgetTrackDatum[] = [
  { track: "creator_video", label: "Creator Video", capCents: 330_000, spentCents: 0, reservedCents: 0 },
  { track: "street_fliering", label: "Street Fliering", capCents: 320_000, spentCents: 0, reservedCents: 0 },
  { track: "event_activation", label: "Event Activators", capCents: 170_000, spentCents: 0, reservedCents: 0 },
  { track: "agency_reserve", label: "W-2 Agency Reserve", capCents: 100_000, spentCents: 0, reservedCents: 0 },
  { track: "print_qr", label: "Print & Serialized QR", capCents: 80_000, spentCents: 0, reservedCents: 0 },
];

function truncateLabel(text: string, maxChars = 19): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 1).trimEnd()}…`;
}

const SHORT_TRACK_LABELS: Readonly<Record<string, string>> = {
  street_fliering: "Street Fliering",
  creator_video: "Creator Video",
  street_interview_creators: "Creator Video",
  event_activation: "Event Activators",
  event_activators: "Event Activators",
  print_qr: "Print & QR",
  serialized_qr_print: "Print & QR",
  agency_reserve: "Agency Reserve",
  w2_agency_reserve: "Agency Reserve",
  bd_venues: "BD Venues",
  bd_venue: "BD Venues",
  vip_salons: "VIP Salons",
  vip_salon: "VIP Salons",
  video_factory: "Video Factory",
  organic_play: "Organic Loops",
};

function shortTrackLabel(key: string, fallback: string): string {
  const mapped = SHORT_TRACK_LABELS[key.toLowerCase()];
  if (mapped) return mapped;
  return truncateLabel(fallback, 19);
}

const TRACK_COLORS = [
  "var(--primary)",
  "var(--ok)",
  "var(--info)",
  "var(--warn)",
  "var(--muted-foreground)",
] as const;

export function budgetAllocationChartSvg(input: BudgetChartInput): string {
  const monthlyCap = Math.max(1, Number(input.monthlyBudgetCents) || 1_000_000);
  const spent = Math.max(0, Number(input.spentCents) || 0);
  const reserved = Math.max(0, Number(input.reservedCents) || 0);
  const remaining = Math.max(0, monthlyCap - spent - reserved);
  const dailyCap = Math.max(1, Number(input.dailyCapCents) || 100_000);
  const dailySpent = Math.max(0, Number(input.dailySpentCents) || 0);

  const radius = 48;
  const circ = 2 * Math.PI * radius;
  const spentRatio = clamp(spent / monthlyCap, 0, 1);
  const reservedRatio = clamp(reserved / monthlyCap, 0, Math.max(0, 1 - spentRatio));
  const spentLen = spentRatio * circ;
  const reservedLen = reservedRatio * circ;
  const dailyRatio = clamp(dailySpent / dailyCap, 0, 1);
  const dailyTone = dailyRatio >= 0.9 ? "var(--destructive)" : dailyRatio >= 0.7 ? "var(--warn)" : "var(--primary)";

  const tracks = input.tracks && input.tracks.length > 0 ? input.tracks : DEFAULT_NYC_TRACKS;
  const totalTrackCap = Math.max(
    1,
    tracks.reduce((sum, t) => sum + Math.max(0, t.capCents), 0),
  );

  let stackOffset = 0;
  const stackedSegments = tracks
    .map((t, idx) => {
      const widthPct = (Math.max(0, t.capCents) / totalTrackCap) * 100;
      const color = TRACK_COLORS[idx % TRACK_COLORS.length] ?? "var(--primary)";
      const x = stackOffset;
      stackOffset += widthPct;
      return `<rect x="${x.toFixed(2)}%" y="0" width="${Math.max(0.4, widthPct - 0.5).toFixed(2)}%" height="10" rx="2" fill="${color}"><title>${escHtml(t.label)}: ${fmtUsd(t.capCents)} (${Math.round(widthPct)}%)</title></rect>`;
    })
    .join("");

  const trackRows = tracks
    .map((t, idx) => {
      const cap = Math.max(1, t.capCents);
      const used = Math.max(0, t.spentCents + (t.reservedCents ?? 0));
      const fillPct = clamp((used / cap) * 100, 0, 100);
      const toneIdx = idx % TRACK_COLORS.length;
      const shortName = shortTrackLabel(t.track, t.label);
      return `<div class="track-row" title="${escHtml(t.label)}: ${fmtUsdExact(used)} of ${fmtUsd(cap)}">
        <span class="track-name"><svg width="8" height="8" viewBox="0 0 8 8" class="track-dot-svg tone-${toneIdx}" aria-hidden="true"><circle cx="4" cy="4" r="4"/></svg>${channelIconSvg(t.track, 13)}<span class="track-text">${escHtml(shortName)}</span></span>
        <svg class="track-bar-svg" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="bar-track" width="100" height="6" rx="3"/><rect class="tone-${toneIdx}" width="${fillPct.toFixed(1)}" height="6" rx="3"/></svg>
        <span class="track-val tnum">${escHtml(fmtUsd(used))} / ${escHtml(fmtUsd(cap))}</span>
      </div>`;
    })
    .join("");

  const ariaLabel = `Budget remaining ${fmtUsd(remaining)} of ${fmtUsd(monthlyCap)}. Spent ${fmtUsdExact(spent)}, reserved ${fmtUsdExact(reserved)}, daily ${fmtUsdExact(dailySpent)} of ${fmtUsd(dailyCap)}.`;

  return `<div class="budget-chart" role="group" aria-label="${escHtml(ariaLabel)}">
    <div class="budget-donut-wrap">
      <svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="${escHtml(ariaLabel)}">
        <circle cx="64" cy="64" r="${radius}" fill="none" stroke="var(--muted)" stroke-width="11"/>
        ${spentLen > 0.1 ? `<circle cx="64" cy="64" r="${radius}" fill="none" stroke="var(--primary)" stroke-width="11" stroke-dasharray="${spentLen.toFixed(2)} ${(circ - spentLen).toFixed(2)}" transform="rotate(-90 64 64)"/>` : ""}
        ${reservedLen > 0.1 ? `<circle cx="64" cy="64" r="${radius}" fill="none" stroke="var(--warn)" stroke-width="11" stroke-dasharray="${reservedLen.toFixed(2)} ${(circ - reservedLen).toFixed(2)}" stroke-dashoffset="${(-spentLen).toFixed(2)}" transform="rotate(-90 64 64)"/>` : ""}
        <text x="64" y="61" text-anchor="middle" class="svg-kpi">${escHtml(fmtUsd(remaining))}</text>
        <text x="64" y="77" text-anchor="middle" class="svg-sub">of ${escHtml(fmtUsd(monthlyCap))}</text>
      </svg>
      <div class="breaker-bar" title="Daily spend circuit breaker: ${escHtml(fmtUsdExact(dailySpent))} of ${escHtml(fmtUsd(dailyCap))}">
        <div class="breaker-head"><span>Daily cap</span><span class="tnum">${escHtml(fmtUsd(dailySpent))} / ${escHtml(fmtUsd(dailyCap))}</span></div>
        <svg width="100%" height="12" viewBox="0 0 160 12" preserveAspectRatio="none" aria-hidden="true">
          <rect x="0" y="3" width="154" height="6" rx="3" fill="var(--muted)"/>
          <rect x="0" y="3" width="${(dailyRatio * 154).toFixed(1)}" height="6" rx="3" fill="${dailyTone}"/>
          <line x1="154" y1="1" x2="154" y2="11" stroke="var(--destructive)" stroke-width="2"/>
        </svg>
      </div>
    </div>
    <div class="budget-tracks-wrap">
      <svg width="100%" height="10" class="stacked-bar" role="img" aria-label="NYC track allocation split">${stackedSegments}</svg>
      <div class="track-list">${trackRows}</div>
    </div>
  </div>`;
}

export function attributionFunnelSvg(input: FunnelChartInput): string {
  const fliers = Math.max(0, Number(input.fliersOrViews) || 0);
  const scans = Math.max(0, Number(input.qrScans) || 0);
  const started = Math.max(0, Number(input.signupsStarted) || 0);
  const verified = Math.max(0, Number(input.verifiedAdultSignups) || 0);
  const targetCpa = Math.max(100, Number(input.targetCpaCents) || 858);

  const stages = [
    { label: "Fliers & Views", value: fliers, tone: "var(--muted-foreground)" },
    { label: "QR Scans", value: scans, tone: "var(--info)" },
    { label: "Signups Started", value: started, tone: "var(--primary)" },
    { label: "Verified 18+", value: verified, tone: "var(--ok)" },
  ];
  const maxVal = Math.max(1, ...stages.map((s) => s.value));

  const stageRows = stages
    .map((stage, idx) => {
      const y = idx * 32 + 6;
      const barW = stage.value > 0 ? Math.max(6, (stage.value / maxVal) * 260) : 2;
      const prev = idx > 0 ? stages[idx - 1]?.value ?? 0 : 0;
      const convPct = idx > 0 && prev > 0 ? `${Math.round((stage.value / prev) * 100)}%` : "";
      return `<g transform="translate(0 ${y})">
        <text x="0" y="15" class="svg-label">${escHtml(stage.label)}</text>
        <rect x="118" y="4" width="260" height="14" rx="4" fill="var(--muted)"/>
        <rect x="118" y="4" width="${barW.toFixed(1)}" height="14" rx="4" fill="${stage.tone}"><title>${escHtml(stage.label)}: ${fmtInt(stage.value)}</title></rect>
        <text x="438" y="15" text-anchor="end" class="svg-num">${escHtml(fmtInt(stage.value))}</text>
        ${convPct ? `<text x="484" y="15" text-anchor="end" class="svg-sub">${escHtml(convPct)}</text>` : ""}
      </g>`;
    })
    .join("");

  const history =
    input.cpaHistoryCents && input.cpaHistoryCents.length >= 2
      ? input.cpaHistoryCents
      : input.blendedCpaCents !== null
        ? [targetCpa, input.blendedCpaCents]
        : [];

  let sparkMarkup = `<div class="cpa-empty"><span class="cpa-val-inline"><span>Blended CPA</span><strong class="tnum">${input.blendedCpaCents !== null ? escHtml(fmtUsdExact(input.blendedCpaCents)) : "—"}</strong></span><span class="tnum muted">Target ${escHtml(fmtUsdExact(targetCpa))}</span></div>`;
  if (history.length >= 2) {
    const maxCpa = Math.max(targetCpa * 1.4, ...history);
    const minCpa = Math.min(0, ...history);
    const span = Math.max(1, maxCpa - minCpa);
    const pts = history.map((val, i) => {
      const x = 6 + (i / (history.length - 1)) * 208;
      const y = 38 - ((val - minCpa) / span) * 30;
      return { x, y, val };
    });
    const targetY = 38 - ((targetCpa - minCpa) / span) * 30;
    const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const last = pts[pts.length - 1] ?? { x: 214, y: 20, val: targetCpa };
    const dotColor =
      last.val <= targetCpa
        ? "var(--ok)"
        : last.val <= targetCpa * 1.4
          ? "var(--warn)"
          : "var(--destructive)";
    sparkMarkup = `<div class="cpa-row">
      <div class="cpa-meta">
        <span class="svg-sub-txt">Blended CPA</span>
        <strong class="tnum">${escHtml(fmtUsdExact(last.val))}</strong>
        <span class="cpa-target tnum">target ${escHtml(fmtUsdExact(targetCpa))}</span>
      </div>
      <svg width="220" height="44" viewBox="0 0 220 44" role="img" aria-label="Blended CPA trend, latest ${escHtml(fmtUsdExact(last.val))}, target ${escHtml(fmtUsdExact(targetCpa))}">
        <line x1="6" y1="${targetY.toFixed(1)}" x2="214" y2="${targetY.toFixed(1)}" stroke="var(--muted-foreground)" stroke-width="1" stroke-dasharray="3 3"/>
        <polyline fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${poly}"/>
        <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3.5" fill="${dotColor}"/>
      </svg>
    </div>`;
  }

  const ariaLabel = `Acquisition funnel: ${fmtInt(fliers)} views or fliers, ${fmtInt(scans)} QR scans, ${fmtInt(started)} signups started, ${fmtInt(verified)} verified 18+ adults.`;

  return `<div class="funnel-chart">
    <svg width="100%" height="136" viewBox="0 0 490 136" role="img" aria-label="${escHtml(ariaLabel)}">${stageRows}</svg>
    ${sparkMarkup}
  </div>`;
}

export function banditWeightsChartSvg(input: BanditChartInput): string {
  const arms = [...input.arms].sort((a, b) => b.weight - a.weight);
  if (arms.length === 0) {
    return `<div class="empty-inline">No bandit arms configured.</div>`;
  }

  const rowH = 30;
  const height = arms.length * rowH + 10;
  const barStartX = 160;
  const barMaxW = 250;
  const rows = arms
    .map((arm, idx) => {
      const y = idx * rowH + 5;
      const weightPct = clamp(arm.weight * 100, 0, 100);
      const barW = Math.max(2, (weightPct / 100) * barMaxW);
      const unc = clamp((arm.uncertainty ?? 0) * 100, 0, 35);
      const uncLow = (clamp(weightPct - unc, 0, 100) / 100) * barMaxW;
      const uncHigh = (clamp(weightPct + unc, 0, 100) / 100) * barMaxW;
      const tone =
        arm.status === "killed"
          ? "var(--destructive)"
          : arm.status === "paused"
            ? "var(--warn)"
            : idx < 2 && weightPct >= 20
              ? "var(--ok)"
              : "var(--primary)";
      const trendGlyph =
        arm.status === "killed"
          ? "✕"
          : arm.trend === "up"
            ? "↗"
            : arm.trend === "down"
              ? "↘"
              : "—";
      const cpaText =
        arm.cpaCents !== null && arm.cpaCents !== undefined
          ? fmtUsdExact(arm.cpaCents)
          : "—";
      const displayLabel = shortTrackLabel(arm.armKey, arm.label);

      return `<g transform="translate(0 ${y})">
        <text x="0" y="15" class="svg-label"><title>${escHtml(arm.label)}</title>${escHtml(displayLabel)}</text>
        <rect x="${barStartX}" y="5" width="${barMaxW}" height="12" rx="3" fill="var(--muted)"/>
        <rect x="${barStartX}" y="5" width="${barW.toFixed(1)}" height="12" rx="3" fill="${tone}" opacity="${arm.status === "killed" ? "0.45" : "1"}">
          <title>${escHtml(arm.label)}: ${weightPct.toFixed(1)}% (${escHtml(arm.status)}), CPA ${escHtml(cpaText)}</title>
        </rect>
        ${unc > 0.5 && arm.status === "active" ? `<line x1="${(barStartX + uncLow).toFixed(1)}" y1="11" x2="${(barStartX + uncHigh).toFixed(1)}" y2="11" stroke="var(--foreground)" stroke-width="1.5" opacity="0.65"/>` : ""}
        <text x="458" y="15" text-anchor="end" class="svg-num">${weightPct.toFixed(0)}%</text>
        <text x="484" y="15" text-anchor="middle" class="svg-sub">${trendGlyph}</text>
        <text x="554" y="15" text-anchor="end" class="svg-sub">${escHtml(cpaText)}</text>
      </g>`;
    })
    .join("");

  const ariaLabel = `Bandit weights across ${arms.length} arms. Top arm: ${arms[0]?.label ?? "none"} at ${Math.round((arms[0]?.weight ?? 0) * 100)} percent.`;
  const priorNote =
    input.hasObservations === false
      ? `<div class="chart-foot">Uniform prior · updates on verified 18+ signups</div>`
      : "";

  return `<div class="bandit-chart">
    <svg class="chart-svg-full" viewBox="0 0 560 ${height}" role="img" aria-label="${escHtml(ariaLabel)}">${rows}</svg>
    ${priorNote}
  </div>`;
}

export function deviceHealthGaugeSvg(input: DeviceGaugeInput): string {
  const bMin = input.batteryMin ?? 35;
  const bMax = input.batteryMax ?? 80;
  const tMax = input.tempMaxC ?? 41;
  const batt = clamp(Number(input.batteryPct) || 0, 0, 100);
  const temp = clamp(Number(input.tempC) || 0, 0, 55);
  const battSafe = batt >= bMin && batt <= bMax;
  const tempSafe = temp >= 0 && temp <= tMax;
  const battColor = battSafe ? "var(--ok)" : "var(--destructive)";
  const tempColor = temp > tMax ? "var(--destructive)" : temp >= tMax - 3 ? "var(--warn)" : "var(--ok)";

  const battX = (batt / 100) * 150;
  const bMinX = (bMin / 100) * 150;
  const bBandW = ((bMax - bMin) / 100) * 150;
  const tempX = (temp / 55) * 150;
  const tMaxX = (tMax / 55) * 150;

  const day = Math.max(0, Math.round(Number(input.warmupDay) || 0));
  const tiers = [
    { label: "D1–3", cap: 5, minDay: 1 },
    { label: "D4–7", cap: 12, minDay: 4 },
    { label: "D8–14", cap: 25, minDay: 8 },
    { label: "D15–30", cap: 50, minDay: 15 },
    { label: "D31+", cap: 80, minDay: 31 },
  ];
  const tierSegs = tiers
    .map((tier, i) => {
      const x = i * 31;
      const reached = day >= tier.minDay;
      return `<rect x="${x}" y="3" width="27" height="6" rx="2" fill="${reached ? "var(--primary)" : "var(--muted)"}"><title>${tier.label}: ${tier.cap} actions/day</title></rect>`;
    })
    .join("");

  const used = Math.max(0, Number(input.dailyActionsUsed) || 0);
  const cap = Math.max(0, Number(input.dailyActionCap) || 0);
  const quotaText = cap > 0 ? `${used}/${cap}` : "passive";
  const ariaLabel = `${input.label} (${input.platform}): battery ${batt}% (${battSafe ? "safe" : "outside 35-80%"}), temperature ${temp.toFixed(1)} C (${tempSafe ? "safe" : "above 41 C"}), warm-up day ${day}, actions ${quotaText}.`;

  const battClass = battSafe ? "val-ok" : "val-destructive";
  const tempClass = temp > tMax ? "val-destructive" : temp >= tMax - 3 ? "val-warn" : "val-ok";

  return `<div class="dev-gauges" role="group" aria-label="${escHtml(ariaLabel)}">
    <div class="gauge-row">
      <span class="gauge-k">Battery</span>
      <svg width="150" height="16" viewBox="0 0 150 16" aria-hidden="true">
        <rect x="0" y="5" width="150" height="6" rx="3" fill="var(--muted)"/>
        <rect x="${bMinX.toFixed(1)}" y="5" width="${bBandW.toFixed(1)}" height="6" rx="2" fill="var(--ok)" opacity="0.28"/>
        <line x1="${bMinX.toFixed(1)}" y1="3" x2="${bMinX.toFixed(1)}" y2="13" stroke="var(--ok)" stroke-width="1"/>
        <line x1="${(bMinX + bBandW).toFixed(1)}" y1="3" x2="${(bMinX + bBandW).toFixed(1)}" y2="13" stroke="var(--ok)" stroke-width="1"/>
        <rect x="${clamp(battX - 2.5, 0, 145).toFixed(1)}" y="2" width="5" height="12" rx="2" fill="${battColor}"/>
      </svg>
      <span class="gauge-v tnum ${battClass}">${batt.toFixed(0)}%</span>
    </div>
    <div class="gauge-row">
      <span class="gauge-k">Thermal</span>
      <svg width="150" height="16" viewBox="0 0 150 16" aria-hidden="true">
        <rect x="0" y="5" width="150" height="6" rx="3" fill="var(--muted)"/>
        <rect x="0" y="5" width="${tempX.toFixed(1)}" height="6" rx="3" fill="${tempColor}"/>
        <line x1="${tMaxX.toFixed(1)}" y1="2" x2="${tMaxX.toFixed(1)}" y2="14" stroke="var(--destructive)" stroke-width="1.5"/>
      </svg>
      <span class="gauge-v tnum ${tempClass}">${temp.toFixed(1)}°C</span>
    </div>
    <div class="gauge-row">
      <span class="gauge-k">Warm-up</span>
      <svg width="150" height="12" viewBox="0 0 152 12" aria-hidden="true">${tierSegs}</svg>
      <span class="gauge-v tnum">D${day} · ${escHtml(quotaText)}</span>
    </div>
  </div>`;
}
