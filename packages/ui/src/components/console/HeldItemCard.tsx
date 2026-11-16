// spec/consoleWorkspace.md, "A held text waits for a reason of five characters or more"
// spec/consoleWorkspace.md, "A held photo is released only after staff load it and confirm the review"
// spec/consoleWorkspace.md, "Release needs a releasable text, and reject needs only a reason"
import type { ComponentProps, ReactNode } from "react";
import { type HeldRow, minReasonChars } from "../../../../core/src/generated/consoleWorkspace.ts";
import { cn } from "../../lib/cn.ts";
import { Button } from "../Button.tsx";
import { Checkbox } from "../Checkbox.tsx";
import { Input } from "../Input.tsx";
import { Label } from "../Label.tsx";
import { StatusMark } from "./StatusMark.tsx";

export type HeldItemCardProps = Omit<ComponentProps<"article">, "children"> & {
  /** The held row of the workspace model: its status, its choice, and whether it is a photo, a hidden minor text, loaded and reviewed. */
  held: HeldRow;
  /** What was held, such as "leak" or "photo". */
  kind: string;
  /** The member, as a `MemberLink`, or who the text goes to. */
  who?: ReactNode;
  /** Why the guard held it. */
  reasons: string;
  /** When it was held. */
  at?: string;
  /** The held text. It never shows when `held.minorHidden` is true. */
  text?: string;
  /** Shows the reason field and the decisions to a viewer with the safety role. */
  actionsShown: boolean;
  /** The logged reason. */
  reason: string;
  onReasonChange: (reason: string) => void;
  /** The generated `canDecideHeld(w, "ReleaseHeld")`. */
  canRelease: boolean;
  /** The generated `canDecideHeld(w, "RejectHeld")`. */
  canReject: boolean;
  onRelease: () => void;
  onReject: () => void;
  /** The generated `canLoadHeldPhoto(w)`. */
  canLoadPhoto?: boolean;
  /** The generated `canMarkPhotoReviewed(w)`. */
  canMarkPhotoReviewed?: boolean;
  /** The object URL of the loaded photo. */
  photoSrc?: string;
  /** Why the photo did not load or show. */
  photoError?: string;
  /** True while the photo loads. */
  photoLoading?: boolean;
  onLoadPhoto?: () => void;
  /** Tells the owner that the photo shows: the generated `loadHeldPhoto` with `loaded: true`. */
  onPhotoShown?: () => void;
  /** Tells the owner that the photo did not show. */
  onPhotoFailed?: () => void;
  /** Confirms or clears the photo review: the generated `markPhotoReviewed`. */
  onPhotoReviewedChange?: (reviewed: boolean) => void;
};

/**
 * One text or photo that waits for safety staff: release it after every other send check runs again, or reject it, with a logged reason.
 * @model spec/consoleWorkspace.md
 */
export function HeldItemCard({
  held,
  kind,
  who,
  reasons,
  at,
  text,
  actionsShown,
  reason,
  onReasonChange,
  canRelease,
  canReject,
  onRelease,
  onReject,
  canLoadPhoto = false,
  canMarkPhotoReviewed = false,
  photoSrc,
  photoError,
  photoLoading = false,
  onLoadPhoto,
  onPhotoShown,
  onPhotoFailed,
  onPhotoReviewedChange,
  className,
  ...props
}: HeldItemCardProps) {
  const sending = held.status === "HeldSending";
  return (
    <article className={cn("flex flex-col gap-3 rounded-md border border-border bg-card p-3 text-sm text-card-foreground", className)} {...props}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusMark tone="warn" label={kind} showLabel />
        {who}
        <span className="text-muted-foreground">
          {reasons || "no reason given"}
          {at ? ` · ${at}` : ""}
        </span>
      </div>
      {held.photo ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground">Review only this voluntarily selected photo. Gallery access and private appearance scores are not part of this review.</p>
          {actionsShown ? (
            <Button variant="outline" className="self-start" disabled={!canLoadPhoto} loading={photoLoading} onClick={onLoadPhoto}>
              {photoLoading ? "Loading selected photo…" : photoSrc ? "Reload selected photo" : "Load selected photo"}
            </Button>
          ) : null}
          {photoSrc ? <img src={photoSrc} alt="Photo selected by the sender for this matched recipient" className="max-h-64 self-start rounded-md border border-border" onLoad={onPhotoShown} onError={onPhotoFailed} /> : null}
          {photoError ? (
            <p role="alert" className="text-destructive">
              {photoError}
            </p>
          ) : null}
          {photoSrc ? (
            <Label className="font-normal">
              <Checkbox checked={held.photoReviewed} disabled={!canMarkPhotoReviewed || sending} onCheckedChange={(checked) => onPhotoReviewedChange?.(checked === true)} />I reviewed this selected item under its consent and safety policy.
            </Label>
          ) : null}
        </div>
      ) : held.minorHidden ? (
        <p className="text-muted-foreground">Text not shown: a member under 18 (or with an unknown age) is involved. Reject it.</p>
      ) : text !== undefined ? (
        <p className="font-mono whitespace-pre-wrap">{text}</p>
      ) : (
        <p className="text-muted-foreground">No text.</p>
      )}
      {actionsShown ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-40 flex-1"
            aria-label="Reason"
            placeholder={`Reason (logged, at least ${minReasonChars} characters)`}
            value={reason}
            disabled={sending}
            onChange={(event) => onReasonChange(event.target.value)}
          />
          <Button variant="outline" disabled={!canRelease} loading={sending && held.choice === "ReleaseHeld"} title="Send it after every other send check runs again" onClick={onRelease}>
            Release
          </Button>
          <Button variant="ghost" disabled={!canReject} loading={sending && held.choice === "RejectHeld"} onClick={onReject}>
            Reject
          </Button>
        </div>
      ) : null}
    </article>
  );
}
