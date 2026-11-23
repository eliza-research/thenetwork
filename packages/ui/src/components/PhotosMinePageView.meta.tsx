import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import { initial, type PhotoHoldingsPage } from "../../../core/src/generated/photosMinePage.ts";
import { apiMessages } from "../api/client.ts";
import type { HoldingPhoto } from "../api/photosMine.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { PhotosMinePageViewProps } from "./PhotosMinePageView.tsx";

const pixel = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' fill='%23c8b8a8'/></svg>";

const photos: HoldingPhoto[] = [
  { n: 1, label: "beach", addedOn: "2026-11-02", shares: [{ firstName: "Maya", access: "GrantReady" }, { firstName: "Jordan", access: "GrantAsked" }] },
  { n: 2, label: null, addedOn: "2026-11-14", shares: [{ firstName: "Sam", access: "GrantChecking" }] },
  { n: 3, label: "dog", addedOn: "2026-11-18", shares: [] },
];
const images = { 1: { tile: "TileShown" as const, url: pixel }, 2: { tile: "TileShown" as const, url: pixel }, 3: { tile: "TileShown" as const, url: pixel } };
const open = { "1:0": "GrantOpen", "1:1": "GrantOpen", "2:0": "GrantOpen" } as const;

const page = (fields: Partial<PhotoHoldingsPage>): PhotoHoldingsPage => ({ ...initial, ...fields });
const list = (fields: Partial<PhotoHoldingsPage> = {}): PhotoHoldingsPage => page({ screen: "HoldingsList", linkHeld: true, photos: 3, grants: 3, ...fields });
const closed = (screen: PhotoHoldingsPage["screen"]) => ({ page: page({ screen }), photos: [], marks: {}, images: {} });

type Context = { canvasElement: HTMLElement; args: PhotosMinePageViewProps };
const view = ({ canvasElement }: Context) => within(canvasElement);
const heading = (context: Context, name: string) => expect(view(context).getByRole("heading", { level: 1, name })).toBeTruthy();
const takeBackButtons = (context: Context) => view(context).queryAllByRole("button", { name: "Take back" });
const noActions = (context: Context) => expect(view(context).queryByRole("button")).toBeNull();
const newLinkLine = "Text MY PHOTOS for a new one.";

export const meta: ComponentMeta<PhotosMinePageViewProps> = {
  args: { page: list(), photos, marks: open, images },
  examples: {
    Opening: { page: page({}), photos: [], marks: {}, images: {} },
    Reading: { page: page({ pending: "HoldingsReading", linkHeld: true }), photos: [], marks: {}, images: {} },
    List: {},
    "Images loading": { images: { 1: { tile: "TileLoading" }, 2: { tile: "TileMissing" }, 3: { tile: "TileShown", url: pixel } } },
    "Nobody has them": {
      page: list({ photos: 1, grants: 0 }),
      photos: [{ n: 1, label: null, addedOn: "2026-11-22", shares: [] }],
      marks: {},
      images: { 1: { tile: "TileShown", url: pixel } },
    },
    "Shared state": {
      page: list({ photos: 1, grants: 1 }),
      photos: [{ n: 1, label: "hiking", addedOn: "2026-11-22", shares: [{ firstName: "Maya", access: "GrantShared" }] }],
      marks: { "1:0": "GrantOpen" },
      images: { 1: { tile: "TileShown", url: pixel } },
    },
    "Taking back": { page: list({ pending: "HoldingsTakingBack" }), marks: { ...open, "1:0": "GrantTakingBack" } },
    "Taken back": { page: list({ grants: 2, takenBack: 1 }), marks: { ...open, "1:0": "GrantTakenBack" } },
    "Nothing open": { page: list({ grants: 2 }), marks: { ...open, "2:0": "GrantClosed" } },
    "All taken back": {
      page: list({ grants: 0, takenBack: 3 }),
      marks: { "1:0": "GrantTakenBack", "1:1": "GrantTakenBack", "2:0": "GrantTakenBack" },
    },
    "Take back failed": { page: list({ notice: "HoldingsFailed" }) },
    "Take back unreachable": { page: list({ notice: "HoldingsUnreachable" }) },
    Empty: closed("HoldingsEmpty"),
    "Timed out": closed("HoldingsTimedOut"),
    "Other phone": closed("HoldingsOtherPhone"),
    Unavailable: closed("HoldingsUnavailable"),
    "Open unreachable": { page: page({ screen: "HoldingsOpenFailed", notice: "HoldingsUnreachable", linkHeld: true }), photos: [], marks: {}, images: {} },
    "Open failed": { page: page({ screen: "HoldingsOpenFailed", notice: "HoldingsFailed", linkHeld: true }), photos: [], marks: {}, images: {} },
  },
  play: {
    Opening: async (context: Context) => {
      await expect(view(context).getByRole("status", { name: "Loading" })).toBeTruthy();
      await expect(view(context).queryByRole("heading")).toBeNull();
    },
    Reading: async (context: Context) => {
      await expect(view(context).getByRole("status", { name: "Loading" })).toBeTruthy();
      await expect(view(context).queryByRole("heading")).toBeNull();
    },
    List: async (context: Context) => {
      clearAllMocks();
      heading(context, "Your photos");
      await expect(view(context).getByText("Agents only see this list if you allow it, never the photos.")).toBeTruthy();
      await expect(view(context).getByText('1 "beach" · Mon 2 Nov')).toBeTruthy();
      await expect(view(context).getByText("2 · Sat 14 Nov")).toBeTruthy();
      await expect(view(context).getByText("Maya: ready")).toBeTruthy();
      await expect(view(context).getByText("Jordan: asked")).toBeTruthy();
      await expect(view(context).getByText("Sam: checking")).toBeTruthy();
      await expect(view(context).getByText("Nobody has it.")).toBeTruthy();
      await expect(view(context).queryByText(/opened|score|rating/i)).toBeNull();
      await expect(view(context).getByRole("img", { name: "Photo 1" }).getAttribute("src")).toBe(pixel);
      await expect(view(context).queryByRole("link", { name: /download/i })).toBeNull();
      const links = view(context).queryAllByRole("link");
      await expect(links.length).toBe(0);
      await expect(view(context).queryByRole("alert")).toBeNull();
      const buttons = takeBackButtons(context);
      await expect(buttons.length).toBe(3);
      await userEvent.click(buttons[1]!);
      await expect(context.args.onTakeBack).toHaveBeenCalledWith("1:1");
    },
    "Images loading": async (context: Context) => {
      await expect(view(context).getByRole("status", { name: "Photo 1 is loading" })).toBeTruthy();
      await expect(view(context).getByRole("img", { name: "Photo 2 could not load" })).toBeTruthy();
      await expect(view(context).getByRole("img", { name: "Photo 3" })).toBeTruthy();
    },
    "Nobody has them": async (context: Context) => {
      await expect(view(context).getByText("Nobody has it.")).toBeTruthy();
      noActions(context);
    },
    "Shared state": (context: Context) => expect(view(context).getByText("Maya: shared")).toBeTruthy(),
    "Taking back": async (context: Context) => {
      clearAllMocks();
      const pending = view(context).getByRole("button", { name: "Taking back…" });
      await expect(pending.getAttribute("aria-busy")).toBe("true");
      const others = takeBackButtons(context);
      await expect(others.length).toBe(2);
      for (const button of others) await expect(button.hasAttribute("disabled")).toBe(true);
      await userEvent.click(pending);
      await expect(context.args.onTakeBack).not.toHaveBeenCalled();
    },
    "Taken back": async (context: Context) => {
      await expect(view(context).getByText("Maya: taken back")).toBeTruthy();
      await expect(takeBackButtons(context).length).toBe(2);
    },
    "Nothing open": async (context: Context) => {
      await expect(view(context).getByText("Sam: nothing to take back")).toBeTruthy();
      await expect(takeBackButtons(context).length).toBe(2);
    },
    "All taken back": async (context: Context) => {
      await expect(view(context).getAllByText(/: taken back$/).length).toBe(3);
      noActions(context);
    },
    "Take back failed": async (context: Context) => {
      await expect(view(context).getByRole("alert").textContent).toBe("We could not take it back. Please try again.");
      for (const button of takeBackButtons(context)) await expect(button.hasAttribute("disabled")).toBe(false);
    },
    "Take back unreachable": (context: Context) => expect(view(context).getByRole("alert").textContent).toBe(apiMessages.api_unreachable),
    Empty: async (context: Context) => {
      heading(context, "Your photos");
      await expect(view(context).getByText("You have no photos here. Text ADD PHOTOS to add some.")).toBeTruthy();
      noActions(context);
    },
    "Timed out": async (context: Context) => {
      heading(context, "This link timed out");
      await expect(view(context).getByText(newLinkLine)).toBeTruthy();
      noActions(context);
    },
    "Other phone": async (context: Context) => {
      heading(context, "This link was opened on another phone");
      await expect(view(context).getByText(newLinkLine)).toBeTruthy();
      noActions(context);
    },
    Unavailable: async (context: Context) => {
      heading(context, "This link doesn't work");
      await expect(view(context).getByRole("link", { name: "help@ntwrk.party" }).getAttribute("href")).toBe("mailto:help@ntwrk.party");
      await expect(view(context).queryAllByRole("link").length).toBe(1);
      noActions(context);
    },
    "Open unreachable": async (context: Context) => {
      clearAllMocks();
      heading(context, "Your photos");
      await expect(view(context).getByRole("alert").textContent).toBe(apiMessages.api_unreachable);
      await userEvent.click(view(context).getByRole("button", { name: "Try again" }));
      await expect(context.args.onRetry).toHaveBeenCalled();
    },
    "Open failed": (context: Context) => expect(view(context).getByRole("alert").textContent).toBe(apiMessages.unknown),
  },
};
