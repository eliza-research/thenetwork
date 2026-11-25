import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import { initial } from "../../../../core/src/generated/consoleWorkspace.ts";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { HeldItemCardProps } from "./HeldItemCard.tsx";

type Context = { args: HeldItemCardProps; canvasElement: HTMLElement };

const held = { ...initial.held, status: "HeldWaiting" as const };
const photo = { ...held, photo: true, reasonReady: true };
const pixel = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'/%3E";

export const meta: ComponentMeta<HeldItemCardProps> = {
  args: {
    held,
    kind: "leak",
    who: "Maya Chen",
    reasons: "names a workplace",
    at: "Nov 14, 3:20 PM",
    text: "Jon works at the bakery on 5th Ave.",
    actionsShown: true,
    reason: "",
  },
  examples: {
    "Reason ready": { held: { ...held, reasonReady: true }, reason: "Checked: no private fact", canRelease: true, canReject: true },
    "Hidden minor text": { held: { ...held, minorHidden: true }, text: undefined },
    Photo: { kind: "photo", held: photo, reason: "Check the photo", canLoadPhoto: true, text: undefined },
    "Photo shown": { kind: "photo", held: { ...photo, photoLoaded: true }, reason: "Check the photo", canLoadPhoto: true, canMarkPhotoReviewed: true, photoSrc: pixel, text: undefined },
    "Photo failed": { kind: "photo", held: photo, reason: "Check the photo", canLoadPhoto: true, photoError: "The photo did not load.", text: undefined },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.getByText("Jon works at the bakery on 5th Ave.")).toBeTruthy();
      await userEvent.type(canvas.getByRole("textbox", { name: "Reason" }), "C");
      await expect(args.onReasonChange).toHaveBeenCalledWith("C");
      await userEvent.click(canvas.getByRole("button", { name: "Release" }), { pointerEventsCheck: 0 });
      await userEvent.click(canvas.getByRole("button", { name: "Reject" }), { pointerEventsCheck: 0 });
      await expect(args.onRelease).not.toHaveBeenCalled();
      await expect(args.onReject).not.toHaveBeenCalled();
    },
    "Reason ready": async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button", { name: "Release" }));
      await expect(args.onRelease).toHaveBeenCalledTimes(1);
      await userEvent.click(canvas.getByRole("button", { name: "Reject" }));
      await expect(args.onReject).toHaveBeenCalledTimes(1);
    },
    "Hidden minor text": async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).queryByText("Jon works at the bakery on 5th Ave.")).toBeNull();
    },
    Photo: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("img", { name: /Photo selected/ })).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Load selected photo" }));
      await expect(args.onLoadPhoto).toHaveBeenCalledTimes(1);
    },
    "Photo shown": async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("img", { name: "Photo selected by the sender for this matched recipient" })).toBeTruthy();
      await expect(canvas.getByRole("button", { name: "Reload selected photo" })).toBeTruthy();
      await userEvent.click(canvas.getByRole("checkbox", { name: /I reviewed this selected item/ }));
      await expect(args.onPhotoReviewedChange).toHaveBeenCalledWith(true);
    },
    "Photo failed": async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).getByRole("alert").textContent).toBe("The photo did not load.");
    },
  },
};
