import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import { initial, type PhotoCheck } from "../../../core/src/generated/photosCheckPage.ts";
import { apiMessages } from "../api/client.ts";
import type { CheckPhotoShown } from "../hooks/usePhotosCheckPage.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { PhotosCheckPageViewProps } from "./PhotosCheckPageView.tsx";

const pixel = (fill: string) => `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 4'><rect width='4' height='4' fill='${fill}'/></svg>`;
const photo = (n: number, fields: Partial<CheckPhotoShown> = {}): CheckPhotoShown => ({ n, label: null, addedOn: "2026-11-21", shared: false, src: pixel("%238a8a8a"), state: "shown", ...fields });
const photos: CheckPhotoShown[] = [
  photo(1, { label: "beach", addedOn: "2026-11-02" }),
  photo(2, { addedOn: "2026-11-14", shared: true }),
  photo(3, { label: "dog", addedOn: "2026-11-18" }),
  photo(4, { label: "beach sunset" }),
];
const notice = "An automatic check screens it first. Maya can view it until you take it back, and could take a screenshot. Taking it back stops more views but can't undo one.";

const page = (fields: Partial<PhotoCheck>): PhotoCheck => ({ ...initial, ...fields });
const shown = (fields: Partial<PhotoCheck> = {}): PhotoCheck => page({ screen: "ProposalShown", linkOpen: true, photoCount: 4, proposedCount: 1, seen: true, ...fields });
const picking = (fields: Partial<PhotoCheck> = {}): PhotoCheck => page({ screen: "ProposalPicking", linkOpen: true, photoCount: 4, ...fields });

type Context = { args: PhotosCheckPageViewProps; canvasElement: HTMLElement };
const view = ({ canvasElement }: Context) => within(canvasElement);
const heading = (context: Context, name: string) => expect(view(context).getByRole("heading", { name })).toBeTruthy();
const alertText = (context: Context) => view(context).getByRole("alert").textContent;
const ended = async (context: Context, title: string, line: string) => {
  await heading(context, title);
  await expect(view(context).getByText(line)).toBeTruthy();
  await expect(view(context).queryByRole("button")).toBeNull();
  await expect(view(context).queryByRole("img")).toBeNull();
};

export const meta: ComponentMeta<PhotosCheckPageViewProps> = {
  args: {
    page: shown(),
    toFirstName: "Maya",
    notice,
    photos,
    proposed: [1],
    marked: [],
    text: "",
    onPhotoShown: fn(),
    onPhotoFailed: fn(),
    onLoadAgain: fn(),
    onSend: fn(),
    onNotThis: fn(),
    onToggle: fn(),
    onChoose: fn(),
    onRetry: fn(),
  },
  examples: {
    Opening: { page: page({ screen: "ProposalOpening", pending: "ProposalLoading", linkOpen: true }), photos: [], proposed: [] },
    "Bad link": { page: page({ screen: "ProposalBadLink" }), photos: [], proposed: [] },
    "Open unreachable": { page: page({ screen: "ProposalOpenFailed", linkOpen: true, error: "ProposalUnreachable" }), photos: [], proposed: [] },
    "Open failed": { page: page({ screen: "ProposalOpenFailed", linkOpen: true, error: "ProposalRequestFailed" }), photos: [], proposed: [] },
    "Waiting for photos": { page: shown({ seen: false }), photos: [photo(1, { label: "beach", addedOn: "2026-11-02", state: "loading" }), ...photos.slice(1)] },
    Ready: { page: shown() },
    "Ready, two photos": { page: shown({ proposedCount: 2 }), proposed: [1, 4] },
    "Photo did not load": { page: shown({ seen: false }), photos: [photo(1, { label: "beach", src: undefined, state: "failed" }), ...photos.slice(1)] },
    Sending: { page: shown({ pending: "ProposalSending" }) },
    "Send unreachable": { page: shown({ error: "ProposalUnreachable" }) },
    "Send failed": { page: shown({ error: "ProposalRequestFailed" }) },
  },
  play: {
    Opening: (context: Context) => expect(view(context).queryByRole("heading")).toBeNull(),
    "Bad link": (context: Context) => ended(context, "This link does not work", "Text me which photo again."),
    "Open unreachable": async (context: Context) => {
      await heading(context, "This link did not open");
      await expect(alertText(context)).toBe(apiMessages.api_unreachable);
      await userEvent.click(view(context).getByRole("button", { name: "Try again" }));
      await expect(context.args.onRetry).toHaveBeenCalledTimes(1);
    },
    "Open failed": (context: Context) => expect(alertText(context)).toBe(apiMessages.unknown),
    "Waiting for photos": async (context: Context) => {
      const send = view(context).getByRole("button", { name: "Send to Maya" });
      await expect(send.getAttribute("aria-disabled")).toBe("true");
      await userEvent.click(send, { pointerEventsCheck: 0 });
      await expect(context.args.onSend).not.toHaveBeenCalled();
    },
    Ready: async (context: Context) => {
      await heading(context, "Check before you send");
      await expect(view(context).getByText(notice)).toBeTruthy();
      const list = within(view(context).getByRole("list", { name: "Photos for Maya" }));
      await expect(list.getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual(["Photo 1"]);
      await expect(list.getByText('1 "beach" (Mon 2 Nov)')).toBeTruthy();
      await expect(view(context).queryByText(/score|rating/i)).toBeNull();
      await expect(view(context).queryAllByRole("link")).toEqual([]);
      await userEvent.click(view(context).getByRole("button", { name: "Send to Maya" }));
      await expect(context.args.onSend).toHaveBeenCalledTimes(1);
      await userEvent.click(view(context).getByRole("button", { name: "Not this one" }));
      await expect(context.args.onNotThis).toHaveBeenCalledTimes(1);
    },
    "Ready, two photos": async (context: Context) => {
      const list = within(view(context).getByRole("list", { name: "Photos for Maya" }));
      await expect(list.getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual(["Photo 1", "Photo 4"]);
      await expect(list.queryByText(/Photo 2|Photo 3/)).toBeNull();
    },
    "Photo did not load": async (context: Context) => {
      await expect(view(context).getByText("Photo 1 did not load.")).toBeTruthy();
      await expect(view(context).queryByRole("button", { name: "Send to Maya" })).toBeNull();
      await userEvent.click(view(context).getByRole("button", { name: "Load the photos again" }));
      await expect(context.args.onLoadAgain).toHaveBeenCalledTimes(1);
    },
    Sending: async (context: Context) => {
      clearAllMocks();
      await expect(view(context).getByText("Sending…")).toBeTruthy();
      await expect(view(context).getByRole("button", { name: "Not this one" }).getAttribute("aria-disabled")).toBe("true");
      await userEvent.click(view(context).getByRole("button", { name: "Not this one" }), { pointerEventsCheck: 0 });
      await expect(context.args.onNotThis).not.toHaveBeenCalled();
    },
    "Send unreachable": async (context: Context) => {
      await expect(alertText(context)).toBe(apiMessages.api_unreachable);
      await expect(view(context).getByRole("button", { name: "Send to Maya" }).getAttribute("aria-disabled")).toBeNull();
    },
    "Send failed": (context: Context) => expect(alertText(context)).toBe(apiMessages.unknown),
  },
};

export const moreExamples: Readonly<Record<string, Partial<PhotosCheckPageViewProps>>> = {
  Picking: { page: picking() },
  "Picking, marked": { page: picking({ picked: 2 }), marked: [1, 3] },
  "Pick count": { page: picking({ picked: 4, error: "ProposalPickCount" }), marked: [1, 3, 4, 5] },
  Choosing: { page: picking({ picked: 1, pending: "ProposalChoosing" }), marked: [3] },
  Sent: { page: page({ screen: "ProposalSent" }), photos: [], proposed: [], text: "Okay. I'll ask Maya if they want it. An automatic check screens it first. I'll tell you if it doesn't go." },
  "Sent, no text": { page: page({ screen: "ProposalSent" }), photos: [], proposed: [] },
  Closed: { page: page({ screen: "ProposalClosed" }), photos: [], proposed: [] },
  Lapsed: { page: page({ screen: "ProposalLapsed" }), photos: [], proposed: [] },
  Changed: { page: page({ screen: "ProposalChanged" }), photos: [], proposed: [] },
  Refused: { page: page({ screen: "ProposalRefused" }), photos: [], proposed: [], text: "Maya hasn't answered your last photo yet. You can offer another after that." },
  "Refused, no text": { page: page({ screen: "ProposalRefused" }), photos: [], proposed: [] },
  "Other device": { page: page({ screen: "ProposalOtherDevice" }), photos: [], proposed: [] },
};

export const morePlay = {
  Picking: async (context: Context) => {
    await heading(context, "Choose photos");
    await expect(view(context).getByText("Choose 1 to 3 photos for Maya.")).toBeTruthy();
    await expect(within(view(context).getByRole("list", { name: "Your photos" })).getAllByRole("img").length).toBe(4);
    const shared = view(context).getByRole("button", { name: "2 (Sat 14 Nov), Maya has it" });
    await expect(shared.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(shared, { pointerEventsCheck: 0 });
    await expect(context.args.onToggle).not.toHaveBeenCalled();
    await userEvent.click(view(context).getByRole("button", { name: '3 "dog" (Wed 18 Nov)' }));
    await expect(context.args.onToggle).toHaveBeenCalledWith(3);
  },
  "Picking, marked": async (context: Context) => {
    await expect(view(context).getByRole("button", { name: '1 "beach" (Mon 2 Nov)' }).getAttribute("aria-pressed")).toBe("true");
    await expect(view(context).getByRole("button", { name: '4 "beach sunset" (Sat 21 Nov)' }).getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(view(context).getByRole("button", { name: "Choose these" }));
    await expect(context.args.onChoose).toHaveBeenCalledTimes(1);
  },
  "Pick count": (context: Context) => expect(alertText(context)).toBe("Choose 1 to 3 photos."),
  Choosing: (context: Context) => expect(view(context).getByText("Checking…")).toBeTruthy(),
  Sent: (context: Context) => ended(context, "Done", "Okay. I'll ask Maya if they want it. An automatic check screens it first. I'll tell you if it doesn't go."),
  "Sent, no text": (context: Context) => ended(context, "Done", "I'll ask Maya if they want it. An automatic check screens it first."),
  Closed: (context: Context) => ended(context, "This photo choice is closed", "It was sent or withdrawn. Text me if you want to send a photo."),
  Lapsed: (context: Context) => ended(context, "This link timed out", "Text me which photo again."),
  Changed: (context: Context) => ended(context, "Your photos changed", "Text me which photo again."),
  Refused: (context: Context) => ended(context, "Not sent", "Maya hasn't answered your last photo yet. You can offer another after that."),
  "Refused, no text": (context: Context) => ended(context, "Not sent", "I can't send photos here."),
  "Other device": async (context: Context) => {
    await heading(context, "This link is in use");
    const links = view(context).getAllByRole("link");
    await expect(links.map((link) => link.getAttribute("href"))).toEqual(["mailto:help@ntwrk.party"]);
    await expect(view(context).queryByRole("button")).toBeNull();
  },
};
