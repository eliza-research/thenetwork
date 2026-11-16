// spec/consoleWorkspace.md, "A case row opens, and a safety viewer lifts its hold or closes it"
import type { ComponentProps, ReactNode } from "react";
import type { CaseRow } from "../../../../core/src/generated/consoleWorkspace.ts";
import { Button } from "../Button.tsx";
import { Input } from "../Input.tsx";
import { DisclosureCard } from "./DisclosureCard.tsx";
import { StatusMark, type StatusTone } from "./StatusMark.tsx";

export type CaseCardProps = Omit<ComponentProps<"div">, "children" | "dir"> & {
  /** The case row of the workspace model: open or closed, on hold, expanded, and the action on its way. */
  row: CaseRow;
  /** The member name. */
  name: string;
  /** The trust level, such as hold or watch. */
  level: { tone: StatusTone; label: string };
  /** A case with a one-hour target. */
  urgent?: boolean;
  /** The status, when it opened and how many events. */
  meta?: ReactNode;
  /** The time left, as a `Countdown`, or when it closed. */
  due?: ReactNode;
  /** The evidence events, one per line. */
  events?: ReactNode;
  /** The way to the member timeline, as a `MemberLink`. */
  timeline?: ReactNode;
  /** Shows the note and the actions to a safety viewer in a mode that acts, while the case is open. */
  actionsShown: boolean;
  note: string;
  onNoteChange: (note: string) => void;
  /** The generated `canActOnCase(w, "LiftStep")`. */
  canLift: boolean;
  /** The generated `canActOnCase(w, "CloseStep")`. */
  canClose: boolean;
  onLift: () => void;
  onClose: () => void;
  /** Opens or closes the row: the generated `toggleCaseRow`. */
  onToggle: () => void;
};

/**
 * One safety case: its head opens the evidence, and a safety viewer lifts the hold or closes the case with a note.
 * @model spec/consoleWorkspace.md
 */
export function CaseCard({ row, name, level, urgent = false, meta, due, events, timeline, actionsShown, note, onNoteChange, canLift, canClose, onLift, onClose, onToggle, ...props }: CaseCardProps) {
  const closed = row.status === "CaseRowClosed";
  return (
    <DisclosureCard
      open={row.expanded}
      onOpenChange={onToggle}
      summary={
        <>
          {urgent && !closed ? <StatusMark tone="destructive" label="urgent" title="Harassment, scams, contact extraction or a hold: 1-hour target" /> : null}
          <span className="font-medium">{name}</span>
          <StatusMark tone={level.tone} label={level.label} showLabel />
          {meta ? <span className="text-muted-foreground">{meta}</span> : null}
          {due ? <span className="ml-auto">{due}</span> : null}
        </>
      }
      {...props}
    >
      {events}
      <div className="flex flex-wrap items-center gap-2">
        {timeline}
        {actionsShown && !closed ? (
          <>
            <Input className="min-w-40 flex-1" aria-label="Decision note" placeholder="Decision note" value={note} disabled={row.caseSending} onChange={(event) => onNoteChange(event.target.value)} />
            {row.onHold ? (
              <Button variant="outline" disabled={!canLift} loading={row.caseSending && row.caseStep === "LiftStep"} onClick={onLift}>
                Lift hold
              </Button>
            ) : null}
            <Button variant="outline" disabled={!canClose} loading={row.caseSending && row.caseStep === "CloseStep"} onClick={onClose}>
              Close case
            </Button>
          </>
        ) : null}
      </div>
    </DisclosureCard>
  );
}
