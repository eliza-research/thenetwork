import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import { initial, type PhotosViewPage } from "../../../core/src/generated/photosViewPage.ts";
import { apiMessages } from "../api/client.ts";
import type { ViewedPhoto } from "../hooks/usePhotosViewPage.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { PhotosViewPageViewProps } from "./PhotosViewPageView.tsx";

const swatch = (n: number, color: string): ViewedPhoto => ({
  n,
  url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="${color}"/></svg>`)}`,
});
const one = [swatch(1, "#d4a373")];
const three = [swatch(1, "#d4a373"), swatch(2, "#8ecae6"), swatch(3, "#b5e48c")];

const page = (fields: Partial<PhotosViewPage>): PhotosViewPage => ({ ...initial, linkHeld: true, ...fields });
const tap = (fields: Partial<PhotosViewPage> = {}): PhotosViewPage => page({ screen: "ViewTap", ...fields });
const showing = (count: number, loaded: number, fields: Partial<PhotosViewPage> = {}): PhotosViewPage =>
  page({ screen: "ViewShowing", opened: true, count, loaded, ...fields });
const closed = (screen: PhotosViewPage["screen"], fields: Partial<PhotosViewPage> = {}): PhotosViewPage =>
  ({ ...initial, screen, ...fields });

type Context = { args: PhotosViewPageViewProps; canvasElement: HTMLElement };
const view = ({ canvasElement }: Context) => within(canvasElement);
const heading = (context: Context, name: string) => expect(view(context).getByRole("heading", { level: 1, name })).toBeTruthy();
const alertText = (context: Context) => view(context).getByRole("alert").textContent;
const images = (context: Context) => view(context).queryAllByRole("img");
const noImages = (context: Context) => expect(images(context).length).toBe(0);
const helpLink = (context: Context) =>
  expect(view(context).getByRole("link", { name: "help@ntwrk.party" }).getAttribute("href")).toBe("mailto:help@ntwrk.party");
const onlyTheHelpLink = (context: Context) => {
  const links = view(context).queryAllByRole("link");
  expect(links.every((link) => link.getAttribute("href") === "mailto:help@ntwrk.party")).toBe(true);
};
const noWhy = (context: Context) => expect(view(context).queryByText(/took it back|taken back|withdrawn|expired|missing|reported by/i)).toBeNull();

const noSaveAffordance = (context: Context) => {
  const shown = view(context).getAllByRole("img", { name: "Photo from Ari" });
  for (const image of shown) {
    expect(image.getAttribute("draggable")).toBe("false");
    expect(image.closest("a")).toBeNull();
    expect(image.className).toContain("pointer-events-none");
    expect(image.className).toContain("select-none");
    expect(image.className).toContain("[-webkit-touch-callout:none]");
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    image.parentElement!.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  }
  expect(context.canvasElement.querySelector("[download]")).toBeNull();
  expect(view(context).queryAllByRole("link").length).toBe(0);
  expect(view(context).queryByRole("button", { name: /save|download|share/i })).toBeNull();
};

export const meta: ComponentMeta<PhotosViewPageViewProps> = {
  args: {
    page: tap(),
    photos: [],
    fromFirstName: "",
    until: undefined,
  },
  examples: {
    Opening: { page: closed("ViewOpening") },
    Tap: { page: tap() },
    "Tap opening": { page: tap({ pending: "ViewOpeningLink" }) },
    "Tap unreachable": { page: tap({ error: "ViewUnreachable" }) },
    "Tap failed": { page: tap({ error: "ViewRequestFailed" }) },
    "Tap again after a photo failed": { page: tap({ opened: true, count: 1, error: "ViewUnreachable" }), fromFirstName: "Ari" },
    "Showing one": { page: showing(1, 1), photos: one, fromFirstName: "Ari", until: Date.UTC(2026, 10, 23, 20, 0) },
    Loading: { page: showing(3, 1, { pending: "ViewLoadingPhotos" }), photos: one, fromFirstName: "Ari" },
    "Showing three": { page: showing(3, 3), photos: three, fromFirstName: "Ari" },
    "Showing part": { page: showing(3, 2, { missing: 1 }), photos: three.slice(0, 2), fromFirstName: "Ari" },
    "Confirm report": { page: showing(1, 1, { screen: "ViewConfirmReport" }), photos: one, fromFirstName: "Ari" },
    Reporting: { page: showing(1, 1, { screen: "ViewConfirmReport", pending: "ViewReporting" }), photos: one, fromFirstName: "Ari" },
    "Report unreachable": { page: showing(1, 1, { screen: "ViewConfirmReport", error: "ViewUnreachable" }), photos: one, fromFirstName: "Ari" },
    Reported: { page: closed("ViewReported", { opened: true }), fromFirstName: "Ari" },
    "Other device": { page: closed("ViewOtherDevice") },
    "Other device, report lost": { page: closed("ViewOtherDevice", { opened: true, reportLost: true }), fromFirstName: "Ari" },
    Gone: { page: closed("ViewGone") },
    "Window ended": { page: closed("ViewGone", { opened: true }), fromFirstName: "Ari" },
    "Report lost": { page: closed("ViewGone", { opened: true, reportLost: true }), fromFirstName: "Ari" },
  },
  play: {
    Opening: async (context: Context) => {
      await expect(view(context).getByRole("status", { name: "Loading" })).toBeTruthy();
      await expect(view(context).queryByRole("heading")).toBeNull();
    },
    Tap: async (context: Context) => {
      clearAllMocks();
      heading(context, "You have a photo");
      noImages(context);
      await expect(view(context).queryByText(/Ari/)).toBeNull();
      await expect(view(context).queryAllByRole("link").length).toBe(0);
      await expect(view(context).queryByRole("alert")).toBeNull();
      await userEvent.click(view(context).getByRole("button", { name: "See the photo" }));
      await expect(context.args.onTap).toHaveBeenCalledTimes(1);
    },
    "Tap opening": async (context: Context) => {
      const button = view(context).getByRole("button", { name: /Opening/ });
      await expect(button.getAttribute("aria-disabled")).toBe("true");
      await expect(button.getAttribute("aria-busy")).toBe("true");
    },
    "Tap unreachable": async (context: Context) => {
      await expect(alertText(context)).toBe(apiMessages.api_unreachable);
      await expect(view(context).getByRole("button", { name: "See the photo" }).getAttribute("aria-disabled")).toBeNull();
    },
    "Tap failed": (context: Context) => expect(alertText(context)).toBe(apiMessages.unknown),
    "Tap again after a photo failed": async (context: Context) => {
      heading(context, "You have a photo");
      noImages(context);
      await expect(alertText(context)).toBe(apiMessages.api_unreachable);
    },
    "Showing one": async (context: Context) => {
      clearAllMocks();
      heading(context, "Ari sent you this");
      await expect(view(context).getByText(/^Please don't share it\. It stays on this phone until /)).toBeTruthy();
      await expect(images(context).length).toBe(1);
      noSaveAffordance(context);
      await userEvent.click(view(context).getByRole("button", { name: "Report" }));
      await expect(context.args.onAskReport).toHaveBeenCalledTimes(1);
    },
    Loading: async (context: Context) => {
      await expect(images(context).length).toBe(1);
      await expect(view(context).getByRole("status", { name: "Loading" })).toBeTruthy();
      await expect(view(context).getByRole("button", { name: "Report" }).getAttribute("aria-disabled")).toBe("true");
    },
    "Showing three": async (context: Context) => {
      heading(context, "Ari sent you these");
      await expect(images(context).length).toBe(3);
      noSaveAffordance(context);
    },
    "Showing part": async (context: Context) => {
      await expect(images(context).length).toBe(2);
      noWhy(context);
    },
    "Confirm report": async (context: Context) => {
      clearAllMocks();
      heading(context, "Report this photo?");
      noImages(context);
      await userEvent.click(view(context).getByRole("button", { name: "Back" }));
      await expect(context.args.onKeepViewing).toHaveBeenCalledTimes(1);
      await userEvent.click(view(context).getByRole("button", { name: "Report" }));
      await expect(context.args.onReport).toHaveBeenCalledTimes(1);
    },
    Reporting: async (context: Context) => {
      const button = view(context).getByRole("button", { name: /Reporting/ });
      await expect(button.getAttribute("aria-disabled")).toBe("true");
      await expect(view(context).getByRole("button", { name: "Back" }).getAttribute("aria-disabled")).toBe("true");
    },
    "Report unreachable": async (context: Context) => {
      await expect(alertText(context)).toBe(apiMessages.api_unreachable);
      noImages(context);
    },
    Reported: async (context: Context) => {
      heading(context, "Thanks for telling us");
      await expect(view(context).getByText("The photo is closed, and the safety team will look at it.")).toBeTruthy();
      noImages(context);
      await expect(view(context).queryByRole("button")).toBeNull();
    },
    "Other device": async (context: Context) => {
      heading(context, "This link was opened on another phone");
      helpLink(context);
      onlyTheHelpLink(context);
      noImages(context);
      await expect(view(context).queryByRole("button")).toBeNull();
    },
    "Other device, report lost": async (context: Context) => {
      await expect(view(context).getByText(/^Your report did not go from here\./)).toBeTruthy();
      helpLink(context);
    },
    Gone: async (context: Context) => {
      heading(context, "This photo is no longer available");
      helpLink(context);
      onlyTheHelpLink(context);
      noImages(context);
      noWhy(context);
      await expect(view(context).queryByRole("button")).toBeNull();
    },
    "Window ended": async (context: Context) => {
      heading(context, "This photo is no longer available");
      await expect(view(context).getByText(/^If something was not okay, email/)).toBeTruthy();
      noWhy(context);
    },
    "Report lost": async (context: Context) => {
      heading(context, "This photo is no longer available");
      await expect(view(context).getByText(/^Your report did not go from here\./)).toBeTruthy();
      helpLink(context);
    },
  },
};
