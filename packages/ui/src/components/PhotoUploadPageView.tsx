// spec/photoUploadPage.md, "Photo upload page"
import { type ChangeEvent, type ComponentProps, type FormEvent, type ReactNode, useId } from "react";
import type { PhotoError, PhotoUploadPage } from "../../../core/src/generated/photoUploadPage.ts";
import { apiMessages } from "../api/client.ts";
import type { PhotoRefusalShown } from "../api/photoUpload.ts";
import type { PhotoUploadController } from "../hooks/usePhotoUploadPage.ts";
import { Button } from "./Button.tsx";
import { Checkbox } from "./Checkbox.tsx";
import { Field } from "./Field.tsx";
import { FieldError } from "./FieldError.tsx";
import { Input } from "./Input.tsx";
import { Label } from "./Label.tsx";
import { OneStepPage } from "./OneStepPage.tsx";
import { StepFrame } from "./StepFrame.tsx";

export type PhotoUploadPageViewProps = Omit<ComponentProps<"div">, "children"> & PhotoUploadController;

const errorTexts: Readonly<Record<PhotoError, string | undefined>> = {
  PhotoNoError: undefined,
  PhotoPickCount: "Choose 1 to 4 photos.",
  PhotoPickTooLarge: "Each photo must be 4 MB or less, and all the photos 8 MB or less.",
  PhotoPickType: "Use JPEG, PNG or WebP photos.",
  PhotoConsentNeeded: "Tick the box to agree, then upload again.",
  PhotoTooLarge: "These photos are too large. Choose smaller photos.",
  PhotoUnreachable: apiMessages.api_unreachable,
  PhotoRequestFailed: apiMessages.unknown,
};

const pickErrors: readonly PhotoError[] = ["PhotoPickCount", "PhotoPickTooLarge", "PhotoPickType", "PhotoTooLarge"];

const refusalTexts: Readonly<Record<PhotoRefusalShown, string>> = {
  bad_type: "Use a JPEG, PNG or WebP photo.",
  bad_image: "We could not read one photo.",
  too_large: "One photo is larger than 4 MB.",
  too_many: "You keep 6 photos already. Text DELETE PHOTOS to remove some.",
  adults_only: "Photos are for adults (18+) only.",
  other: "We could not keep one photo.",
};

const newLink = "Text ADD PHOTOS for a new link.";

function RefusalLines({ refused }: { refused: readonly PhotoRefusalShown[] }) {
  if (refused.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-foreground">
      {refused.map((reason) => (
        <li key={reason}>{refusalTexts[reason]}</li>
      ))}
    </ul>
  );
}

const savedTitle = (count: number): string => (count === 1 ? "1 photo saved" : `${count} photos saved`);

/**
 * The photo upload page of slop.date: the one step that the photo upload machine shows. Feed it `usePhotoUploadPage`.
 * It shows no preview and no score. The file input has no `capture` attribute.
 * @model spec/photoUploadPage.md
 */
export function PhotoUploadPageView({ page, fileNames, refused, consentText, onChoose, onConsentChange, onUpload, onRetry, ...props }: PhotoUploadPageViewProps) {
  const consentId = useId();
  const errorId = useId();
  const loading = page.pending === "PhotoUploading";
  const reading = page.pending === "PhotoReading";
  const error = errorTexts[page.error];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loading) onUpload();
  };
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    if (!loading) onChoose(Array.from(event.target.files ?? []));
  };

  const stepFor = (screen: PhotoUploadPage["screen"]): ReactNode => {
    switch (screen) {
      case "PhotoOpening":
        return null;
      case "PhotoChecking":
        return (
          <StepFrame title="Add your photos" loading={reading} data-photo-step={screen}>
            <p className="text-foreground">{reading ? "Checking your link…" : "We could not check your link."}</p>
            <FieldError id={errorId}>{error}</FieldError>
            {reading ? null : (
              <Button data-focus aria-describedby={error ? errorId : undefined} onClick={onRetry} className="self-start">
                Try again
              </Button>
            )}
          </StepFrame>
        );
      case "PhotoBadLink":
      case "PhotoLinkClosed":
        return (
          <StepFrame title="This link has expired" data-photo-step={screen}>
            <p className="text-foreground">It works once, for 15 minutes. {newLink}</p>
          </StepFrame>
        );
      case "PhotoPick":
        return (
          <StepFrame title="Add your photos" loading={loading} data-photo-step={screen}>
            <p className="text-foreground">Choose 1 to 4 photos, JPEG, PNG or WebP, up to 4 MB each.</p>
            <form noValidate onSubmit={submit} aria-busy={loading || undefined} aria-describedby={error ? errorId : undefined} className="flex flex-col gap-4">
              <Field label="Photos">
                <Input
                  type="file"
                  name="photo"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  data-focus
                  aria-disabled={loading || undefined}
                  invalid={pickErrors.includes(page.error)}
                  onChange={choose}
                  className="h-auto py-1.5"
                />
              </Field>
              {fileNames.length > 0 ? (
                <ul aria-label="Chosen photos" className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {fileNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              ) : null}
              {page.consentAsked ? (
              <div className="flex items-start gap-3">
                <Checkbox
                  id={consentId}
                  name="consent"
                  aria-disabled={loading || undefined}
                  invalid={page.error === "PhotoConsentNeeded"}
                  checked={page.consentTicked}
                  onCheckedChange={loading ? undefined : (checked) => onConsentChange(checked === true)}
                  className="mt-1 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                />
                <Label htmlFor={consentId} className="font-normal">
                  {consentText}
                </Label>
              </div>
              ) : null}
              <FieldError id={errorId}>{error}</FieldError>
              <Button type="submit" loading={loading} className="self-start">
                {loading ? "Uploading…" : "Upload"}
              </Button>
            </form>
          </StepFrame>
        );
      case "PhotoDone":
        return (
          <StepFrame title={savedTitle(page.savedCount)} data-photo-step={screen}>
            {page.someRefused ? <RefusalLines refused={refused} /> : null}
            <p className="text-foreground">Text DELETE PHOTOS to remove them.</p>
          </StepFrame>
        );
      case "PhotoAllRefused":
        return (
          <StepFrame title="No photos saved" data-photo-step={screen}>
            <RefusalLines refused={refused} />
            <p className="text-foreground">{newLink}</p>
          </StepFrame>
        );
      default: {
        const _exhaustive: never = screen;
        return _exhaustive;
      }
    }
  };

  return (
    <OneStepPage stepKey={page.screen} waiting={page.screen === "PhotoOpening"} {...props}>
      {stepFor(page.screen)}
    </OneStepPage>
  );
}
