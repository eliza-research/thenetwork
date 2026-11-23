import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import { friendsBrand, ntwrkBrand, peonBrand, slopBrand } from "../../../core/src/generated/brandIdentity.ts";
import {
  agentToastText,
  chooseAgent,
  chooseMessages,
  copyByHandText,
  copyLabel,
  initial,
  messagesEntryLabel,
  mount,
  pressCopy,
} from "../../../core/src/generated/landingEntry.ts";
import { landingLinks } from "../brand/landing.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { LandingViewProps } from "./LandingView.tsx";

type Context = { args: LandingViewProps; canvasElement: HTMLElement };

const input = { skillVersion: "1.0.0", textLine: "+15555550100" };
const links = landingLinks(slopBrand.app, input);
const onMac = mount(initial, "MacDesktop");
const onPc = mount(initial, "OtherDesktop");

const stayOnPage = (canvasElement: HTMLElement) => canvasElement.addEventListener("click", (event) => event.preventDefault());

const status = (canvasElement: HTMLElement) => within(canvasElement).getByRole("status").textContent ?? "";

const showsBrand = async ({ args, canvasElement }: Context) => {
  const view = within(canvasElement);
  await expect(view.getAllByRole("heading")).toHaveLength(1);
  await expect(view.getByRole("heading").textContent).toContain(args.brand.headlineMark);
  await expect(view.getByText(args.links.prompt)).toBeTruthy();
  await expect(view.getByRole("link", { name: messagesEntryLabel }).getAttribute("href")).toBe(args.links.messagesHref);
};

export const meta: ComponentMeta<LandingViewProps> = {
  args: {
    brand: slopBrand,
    links,
    state: initial,
    onCopy: fn(),
    onChooseAgent: fn(),
    onChooseMessages: fn(),
  },
  examples: {
    Mounted: { state: onMac },
    Copied: { state: pressCopy(onMac, true) },
    "Agent opening": { state: chooseAgent(onMac, "Claude", true) },
    "Copy by hand": { state: chooseAgent(onMac, "Grok", false) },
    "Messages opening": { state: chooseMessages(onMac, true) },
    "Message copied": { state: chooseMessages(onPc, true) },
    "Text the number": { state: chooseMessages(onPc, false) },
    Network: { brand: ntwrkBrand, links: landingLinks(ntwrkBrand.app, input), state: onMac },
    Peon: { brand: peonBrand, links: landingLinks(peonBrand.app, input), state: onMac },
    Friends: { brand: friendsBrand, links: landingLinks(friendsBrand.app, input), state: onMac },
  },
  play: {
    Default: async (context: Context) => {
      await showsBrand(context);
      await expect(within(context.canvasElement).queryByRole("button", { name: copyLabel("CopyReady") })).toBeNull();
      await expect(status(context.canvasElement)).toBe("");
    },
    Mounted: async (context: Context) => {
      clearAllMocks();
      const { args, canvasElement } = context;
      const view = within(canvasElement);
      stayOnPage(canvasElement);
      await showsBrand(context);
      await userEvent.click(view.getByRole("button", { name: copyLabel("CopyReady") }));
      await expect(args.onCopy).toHaveBeenCalledTimes(1);
      await expect(view.queryByRole("link", { name: "Open in ChatGPT" })).toBeNull();
      await userEvent.click(view.getByRole("link", { name: "Open in Claude" }));
      await expect(args.onChooseAgent).toHaveBeenCalledWith("Claude");
      await userEvent.click(view.getByRole("link", { name: messagesEntryLabel }));
      await expect(args.onChooseMessages).toHaveBeenCalledTimes(1);
    },
    Copied: async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).getByRole("button", { name: copyLabel("CopyCopied") })).toBeTruthy();
    },
    "Agent opening": async ({ canvasElement }: Context) => {
      await expect(status(canvasElement)).toBe(agentToastText("Claude"));
    },
    "Copy by hand": async ({ canvasElement }: Context) => {
      await expect(status(canvasElement)).toBe(copyByHandText);
    },
    "Messages opening": async ({ canvasElement }: Context) => {
      await expect(status(canvasElement)).toBe("");
    },
    "Message copied": async ({ args, canvasElement }: Context) => {
      const text = status(canvasElement);
      await expect(text).toContain(args.links.textLine);
      await expect(text).not.toMatch(/[{}]/);
    },
    "Text the number": async ({ args, canvasElement }: Context) => {
      const text = status(canvasElement);
      await expect(text).toContain(args.links.joinMessage);
      await expect(text).toContain(args.links.textLine);
      await expect(text).not.toMatch(/[{}]/);
    },
    Network: showsBrand,
    Peon: showsBrand,
    Friends: showsBrand,
  },
};
