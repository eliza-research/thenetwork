import { renderTokensCss } from "./tokens.ts";

export function renderCommandCenterCss(): string {
  return `${renderTokensCss()}

*, *::before, *::after {
  box-sizing: border-box;
}

html, body {
  height: 100%;
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}

.tnum {
  font-variant-numeric: tabular-nums;
}

.mono {
  font-family: var(--font-mono);
  font-size: 12px;
}

.muted {
  color: var(--muted-foreground);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

a {
  color: var(--foreground);
  text-decoration: underline;
  text-underline-offset: 3px;
}

a:hover {
  opacity: 0.78;
}

button, input, select, textarea {
  font: inherit;
  color: inherit;
}

.shell {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
  background: var(--background);
}

.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--background);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.brand-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.015em;
  cursor: pointer;
}

.brand-btn:hover {
  background: var(--accent);
}

.brand-mark {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}

.provider-icon, .ico {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}

.topbar-mid {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.topbar-end {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.segments {
  display: inline-flex;
  align-items: center;
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 2px;
  gap: 2px;
}

.seg-btn {
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  padding: 4px 9px;
  border-radius: calc(var(--radius-md) - 2px);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}

.seg-btn:hover {
  color: var(--foreground);
}

.seg-btn[aria-pressed="true"] {
  background: var(--card);
  color: var(--foreground);
  box-shadow: var(--shadow-sm);
}

.seg-btn.seg-danger[aria-pressed="true"] {
  background: var(--destructive);
  color: var(--destructive-foreground);
}

.switch-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--input);
  border-radius: var(--radius-md);
  background: var(--card);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.switch-btn:hover {
  background: var(--accent);
}

.switch-btn[aria-pressed="true"] {
  border-color: var(--warn);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--input);
  border-radius: var(--radius-md);
  background: var(--card);
  color: var(--foreground);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.btn:hover:not(:disabled) {
  background: var(--accent);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--primary);
  color: var(--primary-foreground);
  border-color: var(--primary);
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary);
  opacity: 0.88;
}

.btn-danger {
  background: var(--destructive);
  color: var(--destructive-foreground);
  border-color: var(--destructive);
}

.btn-danger:hover:not(:disabled) {
  background: var(--destructive);
  opacity: 0.9;
}

.btn-ghost {
  border-color: transparent;
  background: transparent;
}

.btn-sm {
  height: 28px;
  padding: 0 9px;
  font-size: 12px;
}

.btn-icon {
  width: 30px;
  height: 30px;
  padding: 0;
}

.ctrl-select, .ctrl-input, .ctrl-textarea {
  border: 1px solid var(--input);
  border-radius: var(--radius-md);
  background: var(--card);
  color: var(--foreground);
  padding: 5px 10px;
  font-size: 13px;
  min-height: 32px;
}

.ctrl-select-sm {
  min-height: 28px;
  padding: 3px 8px;
  font-size: 12px;
}

.ctrl-textarea {
  width: 100%;
  min-height: 84px;
  resize: vertical;
  font-family: var(--font-sans);
}

.workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.rail {
  width: 212px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--background);
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.rail-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  padding: 8px 10px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}

.rail-btn:hover {
  background: var(--accent);
  color: var(--foreground);
}

.rail-btn[aria-current="page"] {
  background: var(--accent);
  color: var(--foreground);
  font-weight: 700;
}

.rail-key {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted-foreground);
  opacity: 0.75;
}

.rail-foot {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stage {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px 24px 48px;
}

.stage-inner {
  max-width: 1320px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.view-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.view-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.view-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.kpi-tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--card-foreground);
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.kpi-tile:hover {
  background: var(--accent);
}

.kpi-val {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
}

.kpi-val.tone-ok { color: var(--ok); }
.kpi-val.tone-warn { color: var(--warn); }
.kpi-val.tone-destructive { color: var(--destructive); }

.kpi-lbl {
  font-size: 13px;
  color: var(--muted-foreground);
}

.topbar .ctrl-select {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.panel-grid-start {
  align-items: start;
}

.panel-grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.panel {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--card);
  color: var(--card-foreground);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.panel-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.smark {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.smark-ok { color: var(--ok); }
.smark-warn { color: var(--warn); }
.smark-destructive { color: var(--destructive); }
.smark-primary { color: var(--primary); }
.smark-neutral { color: var(--muted-foreground); }
.smark-label { text-transform: capitalize; }

.alert-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--destructive);
  background: color-mix(in oklch, var(--destructive) 10%, var(--card));
  font-size: 13px;
  font-weight: 600;
}

.alert-strip.warn {
  border-color: var(--warn);
  background: color-mix(in oklch, var(--warn) 10%, var(--card));
}

.subtabs {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
  flex-wrap: wrap;
}

.subtab-btn {
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.subtab-btn:hover {
  background: var(--accent);
  color: var(--foreground);
}

.subtab-btn[aria-selected="true"] {
  background: var(--primary);
  color: var(--primary-foreground);
}

.search-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.search-wrap .ico {
  position: absolute;
  left: 9px;
  color: var(--muted-foreground);
  pointer-events: none;
}

.search-wrap input {
  padding-left: 30px;
  width: 220px;
}

.table-wrap {
  width: 100%;
  overflow-x: auto;
}

table.dt {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

table.dt th {
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted-foreground);
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

table.dt td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

table.dt tbody tr.row-click {
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

table.dt tbody tr.row-click:hover {
  background: var(--accent);
}

table.dt .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cell-flex {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.meter {
  display: inline-block;
  width: 72px;
  height: 6px;
  vertical-align: middle;
}

.bar-svg {
  display: inline-block;
  width: 72px;
  height: 6px;
  vertical-align: middle;
  border-radius: 3px;
  overflow: hidden;
}

.track-bar-svg {
  display: block;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
}

.bar-track {
  fill: var(--muted);
}

.bar-fill {
  fill: var(--primary);
}

.tone-0 { fill: var(--primary); }
.tone-1 { fill: var(--ok); }
.tone-2 { fill: var(--info); }
.tone-3 { fill: var(--warn); }
.tone-4 { fill: var(--muted-foreground); }

.val-ok { color: var(--ok); }
.val-warn { color: var(--warn); }
.val-destructive { color: var(--destructive); }

.col-city {
  min-width: 68px;
  padding-right: 16px;
  white-space: nowrap;
}

.chart-svg-full {
  display: block;
  width: 100%;
  height: auto;
}

.modal-msg {
  margin: 0;
}

.cpa-val-inline {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
}

.budget-chart {
  display: grid;
  grid-template-columns: 156px minmax(0, 1fr);
  gap: 18px;
  align-items: center;
}

.budget-donut-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.breaker-bar {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.breaker-head {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--muted-foreground);
}

.budget-tracks-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.stacked-bar {
  display: block;
  border-radius: 3px;
}

.track-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.track-row {
  display: grid;
  grid-template-columns: minmax(132px, 1.35fr) minmax(72px, 1fr) auto;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.track-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.track-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-dot-svg {
  flex-shrink: 0;
  display: inline-block;
}

.track-val {
  color: var(--muted-foreground);
  white-space: nowrap;
}

.svg-kpi {
  fill: var(--foreground);
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.svg-label {
  fill: var(--foreground);
  font-size: 12px;
  font-weight: 500;
}

.svg-num {
  fill: var(--foreground);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.svg-sub {
  fill: var(--muted-foreground);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.funnel-chart, .bandit-chart {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cpa-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.cpa-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.svg-sub-txt, .cpa-target, .chart-foot {
  font-size: 11px;
  color: var(--muted-foreground);
}

.cpa-empty {
  display: flex;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}

.dev-gauges {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gauge-row {
  display: grid;
  grid-template-columns: 58px 150px 1fr;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.gauge-k {
  color: var(--muted-foreground);
}

.gauge-v {
  text-align: right;
  font-weight: 600;
  white-space: nowrap;
}

.agent-card-grid, .device-card-grid, .adapter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 14px;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
}

.card-foot.card-foot-inline {
  flex-wrap: nowrap;
  gap: 8px;
}

.card-foot.card-foot-inline .btn {
  flex-shrink: 0;
  white-space: nowrap;
}

.trunc-meta {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

.checks-inline {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.stage-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
  gap: 10px;
}

.stage-col {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--background);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stage-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
}

.stage-item {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--card);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}

.stage-item:hover {
  background: var(--accent);
}

.empty-inline {
  padding: 20px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--muted-foreground);
}

.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: oklch(0 0 0 / 0.36);
  z-index: 40;
  display: flex;
  justify-content: flex-end;
}

.drawer-backdrop[hidden] {
  display: none;
}

.drawer {
  width: min(460px, 100vw);
  height: 100%;
  background: var(--card);
  color: var(--card-foreground);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.drawer-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.drawer-body {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted-foreground);
}

.field-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.check-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: oklch(0 0 0 / 0.45);
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.modal-backdrop[hidden] {
  display: none;
}

.modal {
  width: min(440px, 100%);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: var(--shadow-lg);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.signin-wrap {
  height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--background);
}

.signin-card {
  width: min(380px, 100%);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--card);
  padding: 24px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 340px;
}

.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: var(--shadow-md);
  font-size: 13px;
}

.code-block {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
  overflow: auto;
}

.mobile-menu-btn {
  display: none;
}

.backpressure-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--card);
  font-size: 13px;
}

.backpressure-banner.bp-paused {
  border-color: var(--destructive);
  background: color-mix(in oklch, var(--destructive) 10%, var(--card));
}

.backpressure-banner.bp-healthy {
  border-color: var(--border);
}

.bp-metrics {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.bp-metric {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.city-strip {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));
  gap: 10px;
}

.city-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--background);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard);
}

.city-card:hover {
  background: var(--accent);
}

.city-card-active {
  border-color: var(--foreground);
  background: var(--card);
  box-shadow: var(--shadow-sm);
}

.city-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.city-card-code {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.city-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--foreground);
}

.city-card-stage {
  font-size: 11px;
  color: var(--muted-foreground);
  text-transform: capitalize;
}

.city-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.desire-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.desire-row {
  display: grid;
  grid-template-columns: minmax(140px, 1.3fr) minmax(90px, 1fr) 64px auto;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}

.desire-row:last-child {
  border-bottom: 0;
}

.desire-row-ext {
  opacity: 0.84;
}

.desire-lane-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.desire-lane-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.desire-airgap {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted-foreground);
}

.desire-bar-svg {
  display: block;
  width: 100%;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
}

.llm-burn-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.llm-meter-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.llm-meter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.llm-meter-svg {
  display: block;
  width: 100%;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
}

.llm-stat-pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.llm-stat-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}

.llm-stat-val {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.sim-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sim-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.sim-kpi {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--background);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sim-kpi-val {
  font-size: 18px;
  font-weight: 700;
}

.sim-gate-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

.sim-gate-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--background);
  font-size: 12px;
}

.sim-gate-pass {
  border-color: color-mix(in oklch, var(--ok) 45%, var(--border));
}

.sim-gate-fail {
  border-color: var(--destructive);
  background: color-mix(in oklch, var(--destructive) 8%, var(--card));
}

.sim-lift-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}

@media (max-width: 64rem) {
  .kpi-grid, .sim-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .panel-grid, .panel-grid-3 {
    grid-template-columns: 1fr;
  }
  .budget-chart {
    grid-template-columns: 1fr;
  }
  .desire-row {
    grid-template-columns: minmax(120px, 1fr) minmax(70px, 1fr) auto;
  }
  .desire-row > :last-child {
    display: none;
  }
}

@media (max-width: 48rem) {
  .mobile-menu-btn {
    display: inline-flex;
  }
  .rail {
    position: fixed;
    top: 48px;
    left: 0;
    bottom: 0;
    z-index: 35;
    transform: translateX(-100%);
    transition: transform var(--duration-base) var(--ease-standard);
    box-shadow: var(--shadow-lg);
  }
  .rail.open {
    transform: translateX(0);
  }
  .stage {
    padding: 14px 12px 40px;
  }
  .search-wrap input {
    width: 150px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`;
}
