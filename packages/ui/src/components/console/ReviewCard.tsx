// spec/staffReview.md, "The visible card follows focus and queue order"
// spec/staffReview.md, "A mode change applies only to a bound card"
import type { ComponentProps, KeyboardEvent, ReactNode, Ref } from "react";
import { type ReviewCtl, type ReviewMode, canChangeReviewMode } from "../../../../core/src/generated/staffReview.ts";
import { cn } from "../../lib/cn.ts";
import { Alert } from "../Alert.tsx";
import { Button } from "../Button.tsx";
import { Input } from "../Input.tsx";
import { Textarea } from "../Textarea.tsx";
import { Icon } from "../Icon.tsx";
import { DisclosureCard } from "./DisclosureCard.tsx";
import { StatusMark, type StatusTone } from "./StatusMark.tsx";

export type ReviewCardProps = Omit<ComponentProps<"div">, "title" | "children" | "dir"> & {
  /** The draft controller of the queue: its mode marks a card that is being rejected. */
  ctl: ReviewCtl;
  /** The card that shows open: the generated `selectedReviewCard`. Only it shows its body. */
  selected: boolean;
  /** The opportunity name, such as "Maya + Jon". */
  title: ReactNode;
  /** The kind, the category and the origin. */
  meta?: ReactNode;
  /** The score, written out. */
  score?: string;
  /** The time left, as a `Countdown`. */
  due?: ReactNode;
  /** Selects the card. */
  onSelect: () => void;
  /** The people, the facts, the score parts and the `ReviewActions` of the open card. */
  children?: ReactNode;
};

/**
 * One opportunity in the review queue. The open card shows its people and the decision actions; a card being rejected has a red edge.
 * @model spec/staffReview.md
 */
export function ReviewCard({ ctl, selected, title, meta, score, due, onSelect, className, children, ...props }: ReviewCardProps) {
  const rejecting = selected && ctl.mode === "RejectReview";
  return (
    <DisclosureCard
      open={selected}
      onOpenChange={(open) => {
        if (open) onSelect();
      }}
      className={cn(selected && "border-primary shadow-sm", rejecting && "border-destructive", className)}
      summary={
        <>
          {due}
          <span className="font-medium">{title}</span>
          {meta ? <span className="text-muted-foreground">{meta}</span> : null}
          {score ? <span className="ml-auto text-muted-foreground tabular-nums">{score}</span> : null}
        </>
      }
      {...props}
    >
      {children}
    </DisclosureCard>
  );
}

/** A fact about a person that the reviewer must see, such as "Under 18" or "Hold". */
export type ReviewFlag = { tone: StatusTone; label: string; title?: string };

export type ReviewPersonProps = Omit<ComponentProps<"div">, "children"> & {
  /** The member name, as a `MemberLink`. */
  name: ReactNode;
  /** The neighborhood, as an `AreaLink`. */
  place?: ReactNode;
  flags?: ReviewFlag[];
  /** What a requester asked for, in their request. */
  wants?: string;
  /** What the Network tells this person. */
  told?: string;
};

/** One participant on an open review card. */
export function ReviewPerson({ name, place, flags = [], wants, told, className, ...props }: ReviewPersonProps) {
  return (
    <div className={cn("flex flex-col gap-1 text-sm", className)} {...props}>
      <div className="flex flex-wrap items-center gap-2">
        {name}
        {place ? <span className="text-muted-foreground">{place}</span> : null}
        {flags.map((flag) => (
          <StatusMark key={flag.label} tone={flag.tone} label={flag.label} title={flag.title} showLabel />
        ))}
      </div>
      {wants ? (
        <p>
          <span className="text-muted-foreground">wants:</span> “{wants}”
        </p>
      ) : null}
      {told ? (
        <p title="Shown to this member">
          <span className="text-muted-foreground">told:</span> “{told}”
        </p>
      ) : null}
    </div>
  );
}

/** One reject reason of the app. */
export type ReviewReasonChoice = { code: string; label: string };
/** One person that a re-roll can swap out. */
export type ReviewSwap = { id: string; name: string };
/** One text that an edit can change: what a person is told, or the plan. */
export type ReviewEditRow = { id: string; label: string; value: string };

export type ReviewActionsProps = Omit<ComponentProps<"div">, "children"> & {
  /** The draft controller: its mode opens the edit, re-roll or reject panel, and `noteNeeded` asks for a note. The mode buttons work only where the generated `canChangeReviewMode(ctl)` is true. */
  ctl: ReviewCtl;
  /** Why approval is blocked, when it is. */
  approveBlock?: string;
  /** True for an open item the judge has not held: staff may reject it, and Approve, Edit and Re-roll stay hidden. */
  rejectOnly?: boolean;
  /** True when an edit differs from the texts: Approve then sends the edits. */
  edited?: boolean;
  /** The app's reject reasons, in key order 1 to 8. */
  reasons: ReviewReasonChoice[];
  /** The reason code that needs a note. */
  noteReasonCode?: string;
  /** Everyone but the requester of a member request. */
  swaps: ReviewSwap[];
  /** How many alternates wait. */
  alternates: number;
  /** The texts that the edit panel changes: what each person is told. */
  edits: ReviewEditRow[];
  /** The plan that the edit panel changes. */
  plan: string;
  note: string;
  onNoteChange: (note: string) => void;
  /** The note field, for the "n" key. */
  noteRef?: Ref<HTMLInputElement>;
  onEditChange: (id: string, value: string) => void;
  onPlanChange: (plan: string) => void;
  onApprove: () => void;
  /** Opens or closes a mode panel: the generated `changeReviewMode` with `togglePanel`. */
  onToggleMode: (mode: ReviewMode) => void;
  /** Leaves the mode: the generated `changeReviewMode` to `IdleReview`. */
  onLeaveMode: () => void;
  onReject: (code: string) => void;
  onReroll: (id: string) => void;
  /** The last refusal of this card. */
  error?: { text: string; code?: string };
  /** True while a decision is on its way. */
  loading?: boolean;
};

/**
 * Approve, edit, re-roll and reject with a reason, for the open review card.
 * @model spec/staffReview.md
 */
export function ReviewActions({
  ctl,
  approveBlock,
  rejectOnly = false,
  edited = false,
  reasons,
  noteReasonCode = "other",
  swaps,
  alternates,
  edits,
  plan,
  note,
  onNoteChange,
  noteRef,
  onEditChange,
  onPlanChange,
  onApprove,
  onToggleMode,
  onLeaveMode,
  onReject,
  onReroll,
  error,
  loading = false,
  className,
  ...props
}: ReviewActionsProps) {
  const modes = canChangeReviewMode(ctl);
  const mode = ctl.mode;
  const onNoteKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (ctl.noteNeeded && note.trim()) onReject(noteReasonCode);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.blur();
      if (mode !== "IdleReview") onLeaveMode();
    }
  };
  return (
    <div className={cn("flex flex-col gap-3", className)} {...props}>
      {mode === "EditReview" ? (
        <div className="flex flex-col gap-2">
          {edits.map((row) => (
            <label key={row.id} className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{row.label}</span>
              <Textarea rows={2} value={row.value} onChange={(event) => onEditChange(row.id, event.target.value)} />
            </label>
          ))}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Plan</span>
            <Input value={plan} onChange={(event) => onPlanChange(event.target.value)} />
          </label>
        </div>
      ) : null}
      {mode === "RerollReview" ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Swap out</span>
          {swaps.map((swap, index) => (
            <Button key={swap.id} variant="outline" size="sm" disabled={loading} onClick={() => onReroll(swap.id)}>
              <kbd className="font-mono text-muted-foreground">{index + 1}</kbd> {swap.name}
            </Button>
          ))}
          <span className="text-muted-foreground">{alternates ? `${alternates} alternate${alternates > 1 ? "s" : ""}` : "No alternates: it closes and the engine composes again"}</span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {!rejectOnly && <>
        <Button disabled={!!approveBlock} loading={loading} title={approveBlock ?? "Approve (a)"} onClick={onApprove}>
          {edited ? "Approve with edits" : "Approve"}
        </Button>
        <Button variant="outline" aria-pressed={mode === "EditReview"} disabled={!modes} title="Edit what each person is told (e)" onClick={() => onToggleMode("EditReview")}>
          Edit
        </Button>
        <Button variant="outline" aria-pressed={mode === "RerollReview"} disabled={!modes || !swaps.length} title={swaps.length ? "Swap a participant for an alternate (s)" : "Nobody can be swapped"} onClick={() => onToggleMode("RerollReview")}>
          Re-roll
        </Button>
        </>}
        <Button variant="outline" aria-pressed={mode === "RejectReview"} aria-expanded={mode === "RejectReview"} disabled={!modes} title="Reject with a reason (r)" onClick={() => onToggleMode("RejectReview")}>
          Reject
          <Icon name="chevronDown" />
        </Button>
        <Input
          ref={noteRef}
          className="min-w-40 flex-1"
          aria-label="Note"
          placeholder={ctl.noteNeeded ? "Note (required for Other)" : "Note"}
          invalid={ctl.noteNeeded && !note.trim()}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          onKeyDown={onNoteKey}
        />
      </div>
      {mode === "RejectReview" ? (
        <div role="group" aria-label="Reject reasons" className="flex flex-wrap gap-2">
          {reasons.map((reason, index) => (
            <Button
              key={reason.code}
              variant={ctl.noteNeeded && reason.code === noteReasonCode ? "secondary" : "outline"}
              size="sm"
              disabled={loading}
              onClick={() => onReject(reason.code)}
            >
              <kbd className="font-mono text-muted-foreground">{index + 1}</kbd> {reason.label}
            </Button>
          ))}
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          {error.text}
          {error.code ? <span className="text-muted-foreground"> · {error.code}</span> : null}
        </Alert>
      ) : null}
    </div>
  );
}
