import { expect, within } from "storybook/test";
import { initial, type PhotoUploadPage } from "../../../core/src/generated/photoUploadPage.ts";
import { apiMessages } from "../api/client.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { PhotoUploadPageViewProps } from "./PhotoUploadPageView.tsx";

const consentText =
  "I agree that slop.date may store these photos privately. The matchmaker may use them, privately, to learn who I might like and who might like me. No other member sees them, no score from them is ever shown to anyone, and a person on the safety team looks at them only after a report. Photos are for adults (18+) only. I can delete them and their rating by texting DELETE PHOTOS, except after a ban, when the safety team keeps them.";

const page = (fields: Partial<PhotoUploadPage>): PhotoUploadPage => ({ ...initial, ...fields });
const pick = (fields: Partial<PhotoUploadPage> = {}): PhotoUploadPage => page({ screen: "PhotoPick", linkOpen: true, ...fields });

type Context = { canvasElement: HTMLElement };
const view = ({ canvasElement }: Context) => within(canvasElement);
const alertText = (context: Context) => view(context).getByRole("alert").textContent;
const heading = (context: Context, name: string) => expect(view(context).getByRole("heading", { name })).toBeTruthy();
const newLinkLine = "It works once, for 15 minutes. Text ADD PHOTOS for a new link.";

export const meta: ComponentMeta<PhotoUploadPageViewProps> = {
  args: {
    page: pick(),
    fileNames: [],
    refused: [],
    consentText,
  },
  examples: {
    Opening: { page: page({ screen: "PhotoOpening" }) },
    "Bad link": { page: page({ screen: "PhotoBadLink" }) },
    Pick: { page: pick() },
    Chosen: { page: pick({ chosen: 2 }), fileNames: ["beach.jpg", "park.png"] },
    "Too many files": { page: pick({ chosen: 5, error: "PhotoPickCount" }), fileNames: ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"] },
    "File too large": { page: pick({ chosen: 1, error: "PhotoPickTooLarge" }), fileNames: ["large.jpg"] },
    "Wrong type": { page: pick({ chosen: 1, error: "PhotoPickType" }), fileNames: ["photo.heic"] },
    "Consent needed": { page: pick({ chosen: 1, error: "PhotoConsentNeeded" }), fileNames: ["beach.jpg"] },
    Uploading: { page: pick({ chosen: 2, pending: "PhotoUploading", consentTicked: true }), fileNames: ["beach.jpg", "park.png"] },
    "Too large": { page: pick({ chosen: 2, error: "PhotoTooLarge" }), fileNames: ["beach.jpg", "park.png"] },
    Unreachable: { page: pick({ chosen: 1, error: "PhotoUnreachable" }), fileNames: ["beach.jpg"] },
    "Request failed": { page: pick({ chosen: 1, error: "PhotoRequestFailed" }), fileNames: ["beach.jpg"] },
    Done: { page: page({ screen: "PhotoDone", chosen: 2, savedCount: 2 }) },
    "Done partly": { page: page({ screen: "PhotoDone", chosen: 2, savedCount: 1, someRefused: true }), refused: ["too_large"] },
    "All refused": { page: page({ screen: "PhotoAllRefused", chosen: 2, someRefused: true }), refused: ["bad_image", "too_many"] },
    "Adults only": { page: page({ screen: "PhotoAllRefused", chosen: 1, someRefused: true }), refused: ["adults_only"] },
    "Link closed": { page: page({ screen: "PhotoLinkClosed", chosen: 1 }) },
  },
  play: {
    Opening: (context: Context) => expect(view(context).queryByRole("heading")).toBeNull(),
    "Bad link": (context: Context) => {
      heading(context, "This link has expired");
      expect(view(context).getByText(newLinkLine)).toBeTruthy();
    },
    Pick: (context: Context) => {
      heading(context, "Add your photos");
      const input = view(context).getByLabelText("Photos");
      expect(input.getAttribute("accept")).toBe("image/jpeg,image/png,image/webp");
      expect(input.hasAttribute("capture")).toBe(false);
      expect(view(context).getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
      expect(view(context).getByText(consentText)).toBeTruthy();
      expect(view(context).queryByRole("alert")).toBeNull();
    },
    Chosen: (context: Context) => expect(within(view(context).getByRole("list", { name: "Chosen photos" })).getAllByRole("listitem").length).toBe(2),
    "Too many files": (context: Context) => expect(alertText(context)).toBe("Choose 1 to 4 photos."),
    "File too large": (context: Context) => {
      expect(alertText(context)).toBe("Each photo must be 4 MB or less, and all the photos 8 MB or less.");
      expect(view(context).getByLabelText("Photos").getAttribute("aria-invalid")).toBe("true");
    },
    "Wrong type": (context: Context) => expect(alertText(context)).toBe("Use JPEG, PNG or WebP photos."),
    "Consent needed": (context: Context) => {
      expect(view(context).getByRole("checkbox").getAttribute("aria-invalid")).toBe("true");
      expect(alertText(context)).toBe("Tick the box to agree, then upload again.");
    },
    Uploading: (context: Context) => {
      expect(view(context).getByText("Uploading…")).toBeTruthy();
      expect(view(context).getByRole("checkbox").getAttribute("aria-disabled")).toBe("true");
    },
    "Too large": (context: Context) => {
      expect(alertText(context)).toBe("These photos are too large. Choose smaller photos.");
      expect(view(context).getAllByRole("listitem").length).toBe(2);
    },
    Unreachable: (context: Context) => expect(alertText(context)).toBe(apiMessages.api_unreachable),
    "Request failed": (context: Context) => expect(alertText(context)).toBe(apiMessages.unknown),
    Done: (context: Context) => {
      heading(context, "2 photos saved");
      expect(view(context).getByText("Text DELETE PHOTOS to remove them.")).toBeTruthy();
      expect(view(context).queryByRole("button")).toBeNull();
    },
    "Done partly": (context: Context) => {
      heading(context, "1 photo saved");
      expect(view(context).getByText("One photo is larger than 4 MB.")).toBeTruthy();
    },
    "All refused": (context: Context) => {
      heading(context, "No photos saved");
      expect(view(context).getByText("We could not read one photo.")).toBeTruthy();
      expect(view(context).getByText("Text ADD PHOTOS for a new link.")).toBeTruthy();
    },
    "Adults only": (context: Context) => {
      heading(context, "No photos saved");
      expect(view(context).getByText("Photos are for adults (18+) only.")).toBeTruthy();
      expect(view(context).queryByText(/score/i)).toBeNull();
    },
    "Link closed": (context: Context) => {
      heading(context, "This link has expired");
      expect(view(context).getByText(newLinkLine)).toBeTruthy();
      expect(view(context).queryByRole("button")).toBeNull();
    },
  },
};
