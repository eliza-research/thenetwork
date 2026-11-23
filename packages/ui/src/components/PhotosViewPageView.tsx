// spec/photosViewPage.md, "Photo view page"
import { type ComponentProps, type MouseEvent, type ReactNode, useId } from "react";
import { supportEmail } from "../../../core/src/generated/brandIdentity.ts";
import { type PhotosViewPage, type ViewError, viewPhotosShown } from "../../../core/src/generated/photosViewPage.ts";
import { apiMessages } from "../api/client.ts";
import { cn } from "../lib/cn.ts";
import type { PhotosViewController } from "../hooks/usePhotosViewPage.ts";
import { Button } from "./Button.tsx";
import { FieldError } from "./FieldError.tsx";
import { Link } from "./Link.tsx";
import { OneStepPage } from "./OneStepPage.tsx";
import { Spinner } from "./Spinner.tsx";
import { StepFrame } from "./StepFrame.tsx";

export type PhotosViewPageViewProps = Omit<ComponentProps<"div">, "children"> & PhotosViewController;

const errorTexts: Readonly<Record<ViewError, string | undefined>> = {
  ViewNoError: undefined,
  ViewUnreachable: apiMessages.api_unreachable,
  ViewRequestFailed: apiMessages.unknown,
};

const noSave = "select-none [-webkit-touch-callout:none]";

const refuseMenu = (event: MouseEvent) => event.preventDefault();

const help: ReactNode = (
  <>
    If something was not okay, email <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link>.
  </>
);

const otherPhoneHelp = "This link opens only on the phone that opened it first. Text PHOTO LINK for a new link.";

const replacedHelp = "Use the newest link I texted you.";

const reportLostHelp: ReactNode = (
  <>
    Your report did not go from here. Email <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link> to report it.
  </>
);

/**
 * The photo view page of slop.date: the one step that the photo view machine shows. Feed it `usePhotosViewPage`.
 * It has no download link, no share button and no link to an image. The photos take no pointer events, and the menu and the
 * long-press callout are off over them. A screenshot or another camera stays possible.
 * @model spec/photosViewPage.md
 */
export function PhotosViewPageView({ page, photos, fromFirstName, onTap, onAskReport, onKeepViewing, onReport, ...props }: PhotosViewPageViewProps) {
  const errorId = useId();
  const error = errorTexts[page.error];
  const opening = page.pending === "ViewOpeningLink";
  const loading = page.pending === "ViewLoadingPhotos";
  const reporting = page.pending === "ViewReporting";

  const stepFor = (screen: PhotosViewPage["screen"]): ReactNode => {
    switch (screen) {
      case "ViewOpening":
        return null;
      case "ViewTap":
        return (
          <StepFrame title="You have a photo" loading={opening} data-view-step={screen}>
            <p className="text-foreground">It opens on this phone only.</p>
            <FieldError id={errorId}>{error}</FieldError>
            <Button
              size="lg"
              data-focus
              loading={opening}
              aria-describedby={error ? errorId : undefined}
              aria-disabled={opening || undefined}
              onClick={opening ? undefined : onTap}
              className="self-start"
            >
              {opening ? "Opening…" : "See the photo"}
            </Button>
          </StepFrame>
        );
      case "ViewShowing":
        return (
          <StepFrame title={`${fromFirstName} sent you ${page.count > 1 ? "these" : "this"}`} data-view-step={screen}>
            <p className="text-foreground">
              Please don't share it. It stays here on this phone until {fromFirstName} takes it back. To open it on another phone, text PHOTO LINK.
            </p>
            {viewPhotosShown(page) ? (
              <ul aria-label="Photos" className={cn("flex flex-col gap-3", noSave)} onContextMenu={refuseMenu} onDragStart={refuseMenu}>
                {photos.map((photo) => (
                  <li key={photo.n} className={noSave} onContextMenu={refuseMenu}>
                    <img src={photo.url} alt={`Photo from ${fromFirstName}`} draggable={false} className={cn("pointer-events-none w-full rounded-md", noSave)} />
                  </li>
                ))}
              </ul>
            ) : null}
            {loading ? <Spinner size="md" className="text-muted-foreground" /> : null}
            <Button variant="outline" aria-disabled={loading || undefined} onClick={loading ? undefined : onAskReport} className="self-start">
              Report
            </Button>
          </StepFrame>
        );
      case "ViewConfirmReport":
        return (
          <StepFrame title="Report this photo?" loading={reporting} data-view-step={screen}>
            <p className="text-foreground">The photo closes for good, and the safety team looks at it.</p>
            <FieldError id={errorId}>{error}</FieldError>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="destructive"
                data-focus
                loading={reporting}
                aria-describedby={error ? errorId : undefined}
                aria-disabled={reporting || undefined}
                onClick={reporting ? undefined : onReport}
              >
                {reporting ? "Reporting…" : "Report"}
              </Button>
              <Button variant="ghost" aria-disabled={reporting || undefined} onClick={reporting ? undefined : onKeepViewing}>
                Back
              </Button>
            </div>
          </StepFrame>
        );
      case "ViewReported":
        return (
          <StepFrame title="Thanks for telling us" data-view-step={screen}>
            <p className="text-foreground">The photo is closed, and the safety team will look at it.</p>
          </StepFrame>
        );
      case "ViewOtherDevice":
        return (
          <StepFrame title="This link was opened on another phone" data-view-step={screen}>
            <p className="text-foreground">{page.reportLost ? reportLostHelp : otherPhoneHelp}</p>
          </StepFrame>
        );
      case "ViewReplaced":
        return (
          <StepFrame title="This link was replaced" data-view-step={screen}>
            <p className="text-foreground">{page.reportLost ? reportLostHelp : replacedHelp}</p>
          </StepFrame>
        );
      case "ViewGone":
        return (
          <StepFrame title="This photo is no longer available" data-view-step={screen}>
            <p className="text-foreground">{page.reportLost ? reportLostHelp : help}</p>
          </StepFrame>
        );
      default: {
        const _exhaustive: never = screen;
        return _exhaustive;
      }
    }
  };

  return (
    <OneStepPage stepKey={page.screen} waiting={page.screen === "ViewOpening"} {...props}>
      {stepFor(page.screen)}
    </OneStepPage>
  );
}
