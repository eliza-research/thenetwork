import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../Button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../Popover.tsx";
import { Progress } from "../Progress.tsx";
import { Select, SelectItem } from "../Select.tsx";
import { Segments } from "./Segments.tsx";
import { StatusMark } from "./StatusMark.tsx";

/** Supported simulation playback speed multipliers. */
export type SimSpeed = "1x" | "10x" | "60x" | "360x" | "1000x" | "turbo";

/** Response generation backend during simulation playback. */
export type SimResponseMode = "canned" | "hybrid" | "llm";

/** Discrete time step increments for manual clock stepping. */
export type SimStepSize = "15m" | "1h" | "1d";

/** Selectable simulation scenario option. */
export type SimScenarioOption = {
  id: string;
  label: string;
};

/** Selectable chaos injection fault exposed in the chaos popover. */
export type SimChaosOption = {
  id: string;
  label: string;
  active?: boolean;
};

export type SimControlBarProps = Omit<ComponentProps<"div">, "children"> & {
  /** Whether the simulation clock is currently advancing. */
  running: boolean;
  /** Starts or pauses playback. */
  onToggleRun: () => void;
  /** Advances the simulation clock by one discrete increment. */
  onStep: (step: SimStepSize) => void;
  /** Active simulation playback speed. */
  speed: SimSpeed;
  /** Changes playback speed. */
  onSpeedChange: (speed: SimSpeed) => void;
  /** Available simulation scenarios. */
  scenarios: SimScenarioOption[];
  /** Currently selected scenario ID. */
  scenarioId: string;
  /** Switches the active scenario. */
  onScenarioChange: (scenarioId: string) => void;
  /** Current agent response mode. */
  responseMode: SimResponseMode;
  /** Switches response mode between canned, hybrid, and live LLM. */
  onResponseModeChange: (mode: SimResponseMode) => void;
  /** Live LLM spend in USD for the current simulation session. */
  budgetSpentUsd: number;
  /** Configured LLM spend cap in USD. */
  budgetLimitUsd: number;
  /** Optional fault-injection controls shown inside the Chaos popover. */
  chaosOptions?: SimChaosOption[];
  /** Triggers or toggles a chaos fault by ID. */
  onTriggerChaos?: (chaosId: string) => void;
  /** Current live composite simulation score. */
  score: number;
  /** Count of active safety invariant violations (0 is required). */
  safetyViolations: number;
  /** Optional formatted simulated clock readout, such as "Day 4 · 14:30". */
  simTimeLabel?: string;
  /** Disables transport step buttons while a simulation step is running. */
  busy?: boolean;
};

const speedOptions: { value: SimSpeed; label: string }[] = [
  { value: "1x", label: "1x" },
  { value: "10x", label: "10x" },
  { value: "60x", label: "60x" },
  { value: "360x", label: "360x" },
  { value: "1000x", label: "1000x" },
  { value: "turbo", label: "Turbo" },
];

const modeOptions: { value: SimResponseMode; label: string }[] = [
  { value: "canned", label: "Canned" },
  { value: "hybrid", label: "Hybrid" },
  { value: "llm", label: "LLM" },
];

const steps: { value: SimStepSize; label: string }[] = [
  { value: "15m", label: "+15m" },
  { value: "1h", label: "+1h" },
  { value: "1d", label: "+1d" },
];

/** Unified slim game-mode simulation command strip with transport, speed, scenario, response mode, budget meter, chaos popover, and live score/safety readouts. */
export function SimControlBar({
  running,
  onToggleRun,
  onStep,
  speed,
  onSpeedChange,
  scenarios,
  scenarioId,
  onScenarioChange,
  responseMode,
  onResponseModeChange,
  budgetSpentUsd,
  budgetLimitUsd,
  chaosOptions = [],
  onTriggerChaos,
  score,
  safetyViolations,
  simTimeLabel,
  busy = false,
  className,
  ...props
}: SimControlBarProps) {
  const budgetRatio = budgetLimitUsd > 0 ? budgetSpentUsd / budgetLimitUsd : 0;
  const activeChaosCount = chaosOptions.filter((item) => item.active).length;

  return (
    <div
      role="toolbar"
      aria-label="Simulation controls"
      className={cn("flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-card-foreground", className)}
      {...props}
    >
      <div className="flex shrink-0 items-center gap-1">
        <Button variant={running ? "secondary" : "primary"} size="sm" loading={busy} onClick={onToggleRun}>
          {running ? "Pause" : "Play"}
        </Button>
        {steps.map((item) => (
          <Button key={item.value} variant="outline" size="sm" disabled={busy} onClick={() => onStep(item.value)} className="px-2">
            {item.label}
          </Button>
        ))}
      </div>

      {simTimeLabel ? <span className="shrink-0 font-mono text-xs font-medium whitespace-nowrap tabular-nums text-foreground">{simTimeLabel}</span> : null}

      <Segments
        aria-label="Simulation speed"
        value={speed}
        onValueChange={(value) => onSpeedChange(value as SimSpeed)}
        options={speedOptions}
      />

      <div className="w-36 shrink-0">
        <Select aria-label="Scenario" value={scenarioId} onValueChange={onScenarioChange} className="h-8 text-xs">
          {scenarios.map((scenario) => (
            <SelectItem key={scenario.id} value={scenario.id}>
              {scenario.label}
            </SelectItem>
          ))}
        </Select>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Segments
          aria-label="Response mode"
          value={responseMode}
          onValueChange={(value) => onResponseModeChange(value as SimResponseMode)}
          options={modeOptions}
        />
        <div className="flex min-w-36 shrink-0 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-xs whitespace-nowrap tabular-nums">
            <span className="text-muted-foreground">Budget</span>
            <span className={cn("font-mono font-medium", budgetRatio >= 1 ? "text-destructive" : budgetRatio >= 0.8 ? "text-warn" : "text-foreground")}>
              {`$${budgetSpentUsd.toFixed(2)}/$${budgetLimitUsd.toFixed(2)}`}
            </span>
          </div>
          <Progress value={budgetSpentUsd} max={Math.max(budgetLimitUsd, 0.01)} aria-label="LLM budget spent" className="h-1.5" />
        </div>
      </div>

      {chaosOptions.length > 0 && onTriggerChaos ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant={activeChaosCount > 0 ? "destructive" : "outline"} size="sm" className="shrink-0">
              {activeChaosCount > 0 ? `Chaos (${activeChaosCount})` : "Chaos"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" aria-label="Chaos triggers" className="w-64 gap-2 p-3">
            <div className="text-xs font-medium text-muted-foreground">Fault injection</div>
            <div className="flex flex-col gap-1.5">
              {chaosOptions.map((fault) => (
                <Button
                  key={fault.id}
                  variant={fault.active ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => onTriggerChaos(fault.id)}
                  className="justify-between"
                >
                  <span>{fault.label}</span>
                  <StatusMark tone={fault.active ? "warn" : "neutral"} label={fault.active ? "Active" : "Idle"} />
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2.5 whitespace-nowrap">
        <div className="flex items-baseline gap-1 tabular-nums">
          <span className="text-xs text-muted-foreground">Score</span>
          <span className="text-sm font-semibold text-foreground">{score}</span>
        </div>
        <StatusMark
          tone={safetyViolations === 0 ? "ok" : "destructive"}
          label={safetyViolations === 0 ? "Safe · 0" : `${safetyViolations} violations`}
          showLabel
        />
      </div>
    </div>
  );
}
