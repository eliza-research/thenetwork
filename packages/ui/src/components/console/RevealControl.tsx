// spec/consoleWorkspace.md, "A reveal needs real data, the safety role and a reason"
// spec/consoleWorkspace.md, "A reveal ends early on request or when its time passes"
import type { ComponentProps } from "react";
import { type RevealForm, maxRevealMinutes, minReasonChars, revealMinuteChoices } from "../../../../core/src/generated/consoleWorkspace.ts";
import { cn } from "../../lib/cn.ts";
import { Button } from "../Button.tsx";
import { Input } from "../Input.tsx";
import { Select, SelectItem } from "../Select.tsx";
import { StatusMark } from "./StatusMark.tsx";

export type RevealControlProps = Omit<ComponentProps<"div">, "children"> & {
  /** The reveal form of the workspace model: its phase, a ready reason and the minutes. Render the control only where the generated `revealOffered(staff)` is true. */
  reveal: RevealForm;
  /** The generated `canStartReveal(w)`. */
  canStart: boolean;
  /** The generated `canSubmitReveal(w)`. */
  canSubmit: boolean;
  reason: string;
  onReasonChange: (reason: string) => void;
  /** Chooses the length: one of the generated `revealMinuteChoices`. */
  onMinutesChange: (minutes: number) => void;
  /** Opens the form: the generated `startReveal`. */
  onStart: () => void;
  /** Asks the server for the reveal: the generated `submitReveal`. The server logs the reason first. */
  onSubmit: () => void;
  /** Closes the form: the generated `cancelReveal`. */
  onCancel: () => void;
  /** Ends a granted reveal now: the generated `endReveal`. The server logs it. */
  onEnd: () => void;
  /** Whole minutes left of a granted reveal, from the wall clock; zero or less is expired. */
  minutesLeft?: number;
  /** The reason of the granted reveal, shown on hover. */
  grantedReason?: string;
};

/**
 * The reveal of one member's names and own words: a Reveal button, a form with a logged reason and a length, and the time left with End.
 * @model spec/consoleWorkspace.md
 */
export function RevealControl({
  reveal,
  canStart,
  canSubmit,
  reason,
  onReasonChange,
  onMinutesChange,
  onStart,
  onSubmit,
  onCancel,
  onEnd,
  minutesLeft,
  grantedReason,
  className,
  ...props
}: RevealControlProps) {
  if (reveal.phase === "RevealHidden")
    return (
      <div className={cn("flex items-center gap-2", className)} {...props}>
        <Button variant="outline" size="sm" disabled={!canStart} title={`Show names and this member's own words for up to ${maxRevealMinutes} minutes. Logged.`} onClick={onStart}>
          Reveal
        </Button>
      </div>
    );
  if (reveal.phase === "RevealGranted")
    return (
      <div className={cn("flex items-center gap-2 text-sm", className)} title={grantedReason ? `Revealed: ${grantedReason}` : undefined} {...props}>
        <StatusMark tone="warn" label="Revealed" showLabel />
        <span className="text-muted-foreground tabular-nums">{minutesLeft === undefined ? "" : minutesLeft <= 0 ? "expired" : `${minutesLeft}m left`}</span>
        <Button variant="outline" size="sm" title="End the reveal now (logged)" onClick={onEnd}>
          End
        </Button>
      </div>
    );
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} {...props}>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit();
        }}
      >
        <Input
          className="min-w-40 flex-1"
          autoFocus
          aria-label="Reason"
          placeholder={`Reason (logged, at least ${minReasonChars} characters)`}
          value={reason}
          disabled={reveal.phase === "RevealSending"}
          onChange={(event) => onReasonChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            onCancel();
          }}
        />
        <Select className="w-24" aria-label="Minutes" value={String(reveal.minutes)} onValueChange={(value) => onMinutesChange(Number(value))}>
          {revealMinuteChoices.map((minutes) => (
            <SelectItem key={minutes} value={String(minutes)}>
              {minutes} min
            </SelectItem>
          ))}
        </Select>
        <Button type="submit" size="sm" disabled={!canSubmit} loading={reveal.phase === "RevealSending"} title={`At least ${minReasonChars} characters`}>
          Reveal
        </Button>
        <Button variant="ghost" size="sm" disabled={reveal.phase === "RevealSending"} onClick={onCancel}>
          Cancel
        </Button>
      </form>
    </div>
  );
}
