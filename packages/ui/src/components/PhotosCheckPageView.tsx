// spec/photosCheckPage.md, "Photo check page"
import { type ComponentProps, type ReactNode, useId } from "react";
import { supportEmail } from "../../../core/src/generated/brandIdentity.ts";
import type { PhotoCheck, ProposalError } from "../../../core/src/generated/photosCheckPage.ts";
import { apiMessages } from "../api/client.ts";
import { holdingDayShown } from "../api/photosMine.ts";
import type { CheckPhotoShown, PhotosCheckController } from "../hooks/usePhotosCheckPage.ts";
import { cn } from "../lib/cn.ts";
import { Button } from "./Button.tsx";
import { FieldError } from "./FieldError.tsx";
import { Link } from "./Link.tsx";
import { OneStepPage } from "./OneStepPage.tsx";
import { Spinner } from "./Spinner.tsx";
import { StepFrame } from "./StepFrame.tsx";

export type PhotosCheckPageViewProps = Omit<ComponentProps<"div">, "children" | "onToggle"> & PhotosCheckController;

const errorTexts: Readonly<Record<ProposalError, string | undefined>> = {
  ProposalNoError: undefined,
  ProposalPickCount: "Choose 1 to 3 photos.",
  ProposalUnreachable: apiMessages.api_unreachable,
  ProposalRequestFailed: apiMessages.unknown,
};

const textAgain = "Text me which photo again.";

/**
 * The line under one photo: its number, its name, its day, and who has it.
 * @model spec/photosCheckPage.md
 */
export function checkPhotoLine(photo: Pick<CheckPhotoShown, "n" | "label" | "addedOn" | "shared">, toFirstName: string): string {
  const name = photo.label ? ` "${photo.label}"` : "";
  const day = photo.addedOn ? ` (${holdingDayShown(photo.addedOn)})` : "";
  const has = photo.shared && toFirstName ? `, ${toFirstName} has it` : "";
  return `${photo.n}${name}${day}${has}`;
}

function PhotoImage({ photo, onShown, onFailed }: { photo: CheckPhotoShown; onShown: (n: number) => void; onFailed: (n: number) => void }) {
  if (photo.state === "failed" || (photo.state !== "loading" && !photo.src))
    return <div className="flex aspect-square items-center justify-center rounded-md bg-muted p-2 text-center text-sm text-muted-foreground">Photo {photo.n} did not load.</div>;
  return (
    <div className="relative aspect-square overflow-hidden rounded-md bg-muted">
      {photo.src ? (
        <img
          src={photo.src}
          alt={`Photo ${photo.n}`}
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => onShown(photo.n)}
          onError={() => onFailed(photo.n)}
          className="size-full object-cover"
        />
      ) : null}
      {photo.state === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner size="md" className="text-muted-foreground" />
        </div>
      ) : null}
    </div>
  );
}

function Ended({ screen, title, children }: { screen: PhotoCheck["screen"]; title: string; children: ReactNode }) {
  return (
    <StepFrame title={title} data-check-step={screen}>
      <p className="text-foreground">{children}</p>
    </StepFrame>
  );
}

/**
 * The photo check page of slop.date: the one step that the photo check machine shows. Feed it `usePhotosCheckPage`.
 * The proposal step shows only the photos that the proposal names. It shows no score, no download and no link but the help address.
 * @model spec/photosCheckPage.md
 */
export function PhotosCheckPageView({
  page,
  toFirstName,
  notice,
  photos,
  proposed,
  marked,
  text,
  onPhotoShown,
  onPhotoFailed,
  onLoadAgain,
  onSend,
  onNotThis,
  onToggle,
  onChoose,
  onRetry,
  ...props
}: PhotosCheckPageViewProps) {
  const errorId = useId();
  const error = errorTexts[page.error];
  const name = toFirstName || "your match";

  const stepFor = (screen: PhotoCheck["screen"]): ReactNode => {
    switch (screen) {
      case "ProposalOpening":
        return null;
      case "ProposalBadLink":
        return <Ended screen={screen} title="This link does not work">{textAgain}</Ended>;
      case "ProposalOpenFailed":
        return (
          <StepFrame title="This link did not open" data-check-step={screen}>
            <FieldError id={errorId}>{error}</FieldError>
            <Button data-focus onClick={onRetry} className="self-start">
              Try again
            </Button>
          </StepFrame>
        );
      case "ProposalShown": {
        const sending = page.pending === "ProposalSending";
        const shown = photos.filter((photo) => proposed.includes(photo.n));
        const failed = shown.some((photo) => photo.state === "failed");
        return (
          <StepFrame title="Check before you send" loading={sending} data-check-step={screen}>
            <p className="text-foreground">{notice}</p>
            <ul aria-label={`Photos for ${name}`} className={cn("grid gap-3", shown.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
              {shown.map((photo) => (
                <li key={photo.n}>
                  <figure className="flex flex-col gap-1">
                    <PhotoImage photo={photo} onShown={onPhotoShown} onFailed={onPhotoFailed} />
                    <figcaption className="text-sm text-muted-foreground">{checkPhotoLine(photo, toFirstName)}</figcaption>
                  </figure>
                </li>
              ))}
            </ul>
            <FieldError id={errorId}>{error}</FieldError>
            <div className="flex flex-wrap items-center gap-3">
              {failed ? (
                <Button data-focus onClick={onLoadAgain}>
                  Load the photos again
                </Button>
              ) : (
                <Button
                  data-focus
                  loading={sending}
                  aria-disabled={!page.seen || sending || undefined}
                  aria-describedby={error ? errorId : undefined}
                  onClick={page.seen && !sending ? onSend : undefined}
                >
                  {sending ? "Sending…" : `Send to ${name}`}
                </Button>
              )}
              <Button variant="ghost" aria-disabled={sending || undefined} onClick={sending ? undefined : onNotThis}>
                Not this one
              </Button>
            </div>
          </StepFrame>
        );
      }
      case "ProposalPicking": {
        const choosing = page.pending === "ProposalChoosing";
        return (
          <StepFrame title="Choose photos" loading={choosing} data-check-step={screen}>
            <p className="text-foreground">Choose 1 to 3 photos for {name}.</p>
            <ul aria-label="Your photos" className="grid grid-cols-2 gap-3">
              {photos.map((photo) => {
                const off = photo.shared || photo.state !== "shown" || choosing;
                const on = marked.includes(photo.n);
                return (
                  <li key={photo.n}>
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-disabled={off || undefined}
                      aria-label={checkPhotoLine(photo, toFirstName)}
                      onClick={off ? undefined : () => onToggle(photo.n)}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-md p-1 text-left outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring",
                        on ? "ring-2 ring-primary" : "",
                        off ? "cursor-not-allowed opacity-50" : "",
                      )}
                    >
                      <PhotoImage photo={photo} onShown={onPhotoShown} onFailed={onPhotoFailed} />
                      <span className="text-sm text-muted-foreground">{checkPhotoLine(photo, toFirstName)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <FieldError id={errorId}>{error}</FieldError>
            <Button data-focus loading={choosing} aria-describedby={error ? errorId : undefined} onClick={choosing ? undefined : onChoose} className="self-start">
              {choosing ? "Checking…" : "Choose these"}
            </Button>
          </StepFrame>
        );
      }
      case "ProposalSent":
        return <Ended screen={screen} title="Done">{text || `I'll ask ${name} if they want it. An automatic check screens it first.`}</Ended>;
      case "ProposalClosed":
        return <Ended screen={screen} title="This photo choice is closed">It was sent or withdrawn. Text me if you want to send a photo.</Ended>;
      case "ProposalLapsed":
        return <Ended screen={screen} title="This link timed out">{textAgain}</Ended>;
      case "ProposalChanged":
        return <Ended screen={screen} title="Your photos changed">{textAgain}</Ended>;
      case "ProposalRefused":
        return <Ended screen={screen} title="Not sent">{text || "I can't send photos here."}</Ended>;
      case "ProposalOtherDevice":
        return (
          <Ended screen={screen} title="This link is in use">
            This link was opened on another phone. If that was not you, email <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link>.
          </Ended>
        );
      default: {
        const _exhaustive: never = screen;
        return _exhaustive;
      }
    }
  };

  return (
    <OneStepPage stepKey={page.screen} waiting={page.screen === "ProposalOpening"} {...props}>
      {stepFor(page.screen)}
    </OneStepPage>
  );
}
