// spec/consoleWorkspace.md, "A report decision needs a note and the Network service"
import type { ComponentProps, ReactNode } from "react";
import { type ReportRow, type ReportStep, minReasonChars } from "../../../../core/src/generated/consoleWorkspace.ts";
import { Button } from "../Button.tsx";
import { Input } from "../Input.tsx";
import { DisclosureCard } from "./DisclosureCard.tsx";
import { StatusMark, type StatusTone } from "./StatusMark.tsx";

const stepLabel: Record<ReportStep, string> = {
  HoldPersonStep: "Hold",
  BanPhoneStep: "Ban phone",
  BanPersonStep: "Ban person",
  DismissStep: "Dismiss",
  ClearMinorStep: "Clear minor signal (every app)",
};

const stepTitle: Partial<Record<ReportStep, string>> = {
  HoldPersonStep: "Hold the person on every app until a review",
  BanPhoneStep: "This phone number can never join again",
  BanPersonStep: "Every phone of this person, on every app",
  ClearMinorStep:
    "Only after the person's record says 18 or over. Clears the minor signal on every app you may act on and dismisses this person's minor reports. Refused while any age says under 18.",
};

/** One decision that the report offers. */
export type ReportStepChoice = {
  step: ReportStep;
  /** The generated `canActOnReport(w, step)`. */
  enabled: boolean;
};

export type ReportCardProps = Omit<ComponentProps<"div">, "children" | "dir"> & {
  /** The report row of the workspace model: its status, a minor report, the note and the decision on its way. */
  report: ReportRow;
  /** True while the row shows its body. */
  expanded: boolean;
  onToggle: () => void;
  /** The kind of report, such as harassment. */
  kind: { tone: StatusTone; label: string };
  /** The name of the reported person. */
  name: string;
  /** A report with a one-hour target. */
  urgent?: boolean;
  /** The status, when and the earlier reports. */
  meta?: ReactNode;
  /** The time left, as a `Countdown`. */
  due?: ReactNode;
  /** Who reported whom after which opportunity, with links. */
  detail?: ReactNode;
  /** The decisions to show: those the generated `reportStepAllowed(step, mode, minorReport)` allows while the report is open. */
  steps: ReportStepChoice[];
  note: string;
  onNoteChange: (note: string) => void;
  /** Sends one decision: the generated `actOnReport`. */
  onAct: (step: ReportStep) => void;
};

/**
 * One report after a date: hold the person, ban by phone or by person, dismiss, or clear a minor signal, each with a logged note.
 * @model spec/consoleWorkspace.md
 */
export function ReportCard({ report, expanded, onToggle, kind, name, urgent = false, meta, due, detail, steps, note, onNoteChange, onAct, ...props }: ReportCardProps) {
  return (
    <DisclosureCard
      open={expanded}
      onOpenChange={onToggle}
      summary={
        <>
          {urgent ? <StatusMark tone="destructive" label="urgent" title="Harassment, unsafe, scam or a minor: 1-hour target" /> : null}
          <StatusMark tone={kind.tone} label={kind.label} showLabel />
          <span className="font-medium">{name}</span>
          {meta ? <span className="text-muted-foreground">{meta}</span> : null}
          {due ? <span className="ml-auto">{due}</span> : null}
        </>
      }
      {...props}
    >
      {detail}
      {steps.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-40 flex-1"
            aria-label="Decision note"
            placeholder={`Decision note (logged, at least ${minReasonChars} characters)`}
            value={note}
            disabled={report.reportSending}
            onChange={(event) => onNoteChange(event.target.value)}
          />
          {steps.map(({ step, enabled }) => (
            <Button
              key={step}
              variant={step === "DismissStep" ? "ghost" : "outline"}
              disabled={!enabled}
              loading={report.reportSending && report.reportStep === step}
              title={stepTitle[step]}
              onClick={() => onAct(step)}
            >
              {stepLabel[step]}
            </Button>
          ))}
        </div>
      ) : null}
    </DisclosureCard>
  );
}
