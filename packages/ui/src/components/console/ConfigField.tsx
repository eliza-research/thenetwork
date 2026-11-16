// spec/consoleWorkspace.md, "The switch shows only to an admin who can change it"
// spec/consoleWorkspace.md, "The first press asks for a confirmation and the second press saves"
import type { ComponentProps } from "react";
import type { ConfigControl, ConfigPhase } from "../../../../core/src/generated/consoleWorkspace.ts";
import { cn } from "../../lib/cn.ts";
import { Button } from "../Button.tsx";
import { StatusMark } from "./StatusMark.tsx";

const note: Record<Exclude<ConfigControl, "SwitchControl">, string> = {
  LockedNote: "Off until the app's pack ships",
  AdminOnlyNote: "Admin only",
  ReadOnlyNote: "Read-only here",
};

export type ConfigFieldProps = Omit<ComponentProps<"div">, "children"> & {
  /** What the viewer gets: the generated `configControl(changeable, adminRole, packLocked, matchingOn)`. */
  control: ConfigControl;
  /** The phase of the config editor; `ConfigConfirming` asks for the second press. */
  phase: ConfigPhase;
  /** True while proactive matching is on. */
  matchingOn: boolean;
  /** The generated `canPressMatchingSwitch(w)`. */
  canPress: boolean;
  /** The generated `canConfirmMatchingSwitch(w)`. */
  canConfirm: boolean;
  /** The first press: the generated `pressMatchingSwitch`. The owner ends the confirmation when its time passes. */
  onPress: () => void;
  /** The second press: the generated `confirmMatchingSwitch`, which saves. */
  onConfirm: () => void;
  /** The review mode in force. */
  review?: string;
  /** Why the last save was refused. */
  error?: string;
};

/**
 * The proactive matching switch of an app: on or off, and for an admin a switch that asks for a second press.
 * @model spec/consoleWorkspace.md
 */
export function ConfigField({ control, phase, matchingOn, canPress, canConfirm, onPress, onConfirm, review, error, className, ...props }: ConfigFieldProps) {
  const next = matchingOn ? "off" : "on";
  const confirming = phase === "ConfigConfirming";
  return (
    <div className={cn("flex flex-col gap-2 text-sm", className)} {...props}>
      <div className="flex flex-wrap items-center gap-3">
        <StatusMark tone={matchingOn ? "ok" : "warn"} label={matchingOn ? "Proactive matching on" : "Proactive matching off"} />
        {control === "SwitchControl" ? (
          confirming ? (
            <Button variant={matchingOn ? "destructive" : "primary"} disabled={!canConfirm} onClick={onConfirm}>
              Confirm: turn {next}
            </Button>
          ) : (
            <Button variant="outline" disabled={!canPress} loading={phase === "ConfigSaving"} onClick={onPress}>
              Turn {next}
            </Button>
          )
        ) : (
          <span className="text-muted-foreground">{note[control]}</span>
        )}
        {review ? <span className="text-muted-foreground">Review: {review}</span> : null}
      </div>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
