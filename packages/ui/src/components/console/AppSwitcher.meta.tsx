import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { AppSwitcherProps } from "./AppSwitcher.tsx";

type Context = { args: AppSwitcherProps; canvasElement: HTMLElement };

const current = (canvasElement: HTMLElement) =>
  within(canvasElement)
    .getAllByRole("button")
    .filter((button) => button.getAttribute("aria-current") === "page")
    .map((button) => button.textContent);

const opensApps = async ({ args, canvasElement }: Context) => {
  clearAllMocks();
  const canvas = within(canvasElement);
  for (const choice of args.apps) {
    await userEvent.click(canvas.getByRole("button", { name: choice.id }));
    await expect(args.onSelectApp).toHaveBeenLastCalledWith(choice.id, choice.id === args.app);
  }
  await userEvent.click(canvas.getByRole("button", { name: "all" }));
  await expect(args.onOpenAllApps).toHaveBeenCalledTimes(1);
};

export const meta: ComponentMeta<AppSwitcherProps> = {
  args: {
    app: "slop",
    apps: [{ id: "ntwrk", title: "ntwrk.party" }, { id: "slop", title: "slop.date" }, { id: "peon", title: "peon.biz" }, { id: "friends", title: "friends.help" }],
  },
  examples: {
    "Friends app": { app: "friends" },
    "One app": { app: "peon", apps: [{ id: "peon", title: "peon.biz" }] },
  },
  play: {
    Default: async (context: Context) => {
      await expect(current(context.canvasElement)).toEqual(["slop"]);
      await opensApps(context);
    },
    "Friends app": async (context: Context) => {
      await expect(current(context.canvasElement)).toEqual(["friends"]);
      await opensApps(context);
    },
    "One app": async (context: Context) => {
      await expect(within(context.canvasElement).getAllByRole("button").map((button) => button.textContent)).toEqual(["peon", "all"]);
      await opensApps(context);
    },
    "page AllAppsPage": async (context: Context) => {
      await expect(current(context.canvasElement)).toEqual(["all"]);
      await opensApps(context);
    },
    "page PersonPage": async ({ canvasElement }: Context) => {
      await expect(current(canvasElement)).toEqual(["all"]);
    },
    Empty: async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).getAllByRole("button").map((button) => button.textContent)).toEqual(["all"]);
    },
  },
};
