// spec/photosMinePage.md, "My photos page"
import type { ComponentProps, ReactNode } from "react";
import { supportEmail } from "../../../core/src/generated/brandIdentity.ts";
import {
  type GrantAccess,
  type GrantMark,
  grantOffersTakeBack,
  type HoldingsNotice,
  type PhotoHoldingsPage,
} from "../../../core/src/generated/photosMinePage.ts";
import { apiMessages } from "../api/client.ts";
import { type HoldingPhoto, type HoldingShare, holdingDayShown } from "../api/photosMine.ts";
import type { HoldingImage, PhotosMineController } from "../hooks/usePhotosMinePage.ts";
import { Alert } from "./Alert.tsx";
import { Button } from "./Button.tsx";
import { Link } from "./Link.tsx";
import { OneStepPage } from "./OneStepPage.tsx";
import { Spinner } from "./Spinner.tsx";
import { StepFrame } from "./StepFrame.tsx";

export type PhotosMinePageViewProps = Omit<ComponentProps<"div">, "children"> & PhotosMineController;

const accessWords: Readonly<Record<GrantAccess, string>> = {
  GrantAsked: "asked",
  GrantChecking: "checking",
  GrantReady: "ready",
  GrantShared: "shared",
  GrantWasTakenBack: "taken back",
};

const listNotices: Readonly<Record<Exclude<HoldingsNotice, "HoldingsNoNotice">, string>> = {
  HoldingsUnreachable: apiMessages.api_unreachable,
  HoldingsFailed: "We could not take it back. Please try again.",
};

const openNotices: Readonly<Record<Exclude<HoldingsNotice, "HoldingsNoNotice">, string>> = {
  HoldingsUnreachable: apiMessages.api_unreachable,
  HoldingsFailed: apiMessages.unknown,
};

const newLink = "Text MY PHOTOS for a new one.";
const title = "Your photos";
const agentLine = "Agents only see this list if you allow it, never the photos.";

const captionOf = (photo: HoldingPhoto): string =>
  `${photo.n}${photo.label === null ? "" : ` "${photo.label}"`} · ${holdingDayShown(photo.addedOn)}`;

function Tile({ photo, image }: { photo: HoldingPhoto; image: HoldingImage | undefined }) {
  const frame = "flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted";
  if (image?.tile === "TileShown" && image.url)
    return (
      <div className={frame}>
        <img src={image.url} alt={`Photo ${photo.n}`} draggable={false} className="size-full object-cover" />
      </div>
    );
  if (image?.tile === "TileMissing")
    return (
      <div className={`${frame} p-2 text-center text-xs text-muted-foreground`} role="img" aria-label={`Photo ${photo.n} could not load`}>
        Could not load
      </div>
    );
  return (
    <div className={frame}>
      <Spinner size="sm" label={`Photo ${photo.n} is loading`} className="text-muted-foreground" />
    </div>
  );
}

function ShareLine({ share, mark, offered, onTakeBack }: { share: HoldingShare; mark: GrantMark; offered: boolean; onTakeBack: () => void }) {
  const word = mark === "GrantTakenBack" ? "taken back" : mark === "GrantClosed" ? "nothing to take back" : accessWords[share.access];
  return (
    <li className="flex items-center justify-between gap-3" data-share-mark={mark}>
      <span className="text-foreground">
        {share.firstName}: {word}
      </span>
      {mark === "GrantTakingBack" ? (
        <Button size="sm" variant="outline" loading>
          Taking back…
        </Button>
      ) : mark === "GrantOpen" ? (
        <Button size="sm" variant="outline" disabled={!offered} onClick={offered ? onTakeBack : undefined}>
          Take back
        </Button>
      ) : null}
    </li>
  );
}

/**
 * The my photos page of slop.date: each photo, who has it, and "Take back" for each share. Feed it `usePhotosMinePage`.
 * It shows no score, no photo id and no download. It links only help@ntwrk.party.
 * @model spec/photosMinePage.md
 */
export function PhotosMinePageView({ page, photos, marks, images, onTakeBack, onRetry, ...props }: PhotosMinePageViewProps) {
  const reading = page.pending === "HoldingsReading";

  const stepFor = (screen: PhotoHoldingsPage["screen"]): ReactNode => {
    switch (screen) {
      case "HoldingsOpening":
        return null;
      case "HoldingsList":
        return (
          <StepFrame title={title} data-photo-step={screen}>
            <p className="text-foreground">{agentLine}</p>
            {page.notice !== "HoldingsNoNotice" ? <Alert variant="warn">{listNotices[page.notice]}</Alert> : null}
            <ul aria-label="Photos" className="flex flex-col gap-4">
              {photos.map((photo) => (
                <li key={photo.n} className="flex gap-4" data-photo={photo.n}>
                  <Tile photo={photo} image={images[photo.n]} />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <p className="font-medium text-foreground">{captionOf(photo)}</p>
                    {photo.shares.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nobody has it.</p>
                    ) : (
                      <ul aria-label={`Who has photo ${photo.n}`} className="flex flex-col gap-2 text-sm">
                        {photo.shares.map((share) => {
                          const key = share.shareRef;
                          const mark = marks[key] ?? "GrantOpen";
                          return (
                            <ShareLine
                              key={key}
                              share={share}
                              mark={mark}
                              offered={grantOffersTakeBack(page, mark)}
                              onTakeBack={() => onTakeBack(key)}
                            />
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </StepFrame>
        );
      case "HoldingsEmpty":
        return (
          <StepFrame title={title} data-photo-step={screen}>
            <p className="text-foreground">You have no photos here. Text ADD PHOTOS to add some.</p>
          </StepFrame>
        );
      case "HoldingsTimedOut":
        return (
          <StepFrame title="This link timed out" data-photo-step={screen}>
            <p className="text-foreground">{newLink}</p>
          </StepFrame>
        );
      case "HoldingsOtherPhone":
        return (
          <StepFrame title="This link was opened on another phone" data-photo-step={screen}>
            <p className="text-foreground">{newLink}</p>
          </StepFrame>
        );
      case "HoldingsUnavailable":
        return (
          <StepFrame title="This link doesn't work" data-photo-step={screen}>
            <p className="text-foreground">
              {newLink} For help, email <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link>.
            </p>
          </StepFrame>
        );
      case "HoldingsOpenFailed":
        return (
          <StepFrame title={title} data-photo-step={screen}>
            {page.notice !== "HoldingsNoNotice" ? <Alert variant="warn">{openNotices[page.notice]}</Alert> : null}
            <Button data-focus className="self-start" onClick={onRetry}>
              Try again
            </Button>
          </StepFrame>
        );
      default: {
        const _exhaustive: never = screen;
        return _exhaustive;
      }
    }
  };

  return (
    <OneStepPage stepKey={page.screen} waiting={page.screen === "HoldingsOpening" || reading} {...props}>
      {stepFor(page.screen)}
    </OneStepPage>
  );
}
