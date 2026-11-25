import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { StatusRowProps } from "./StatusRow.tsx";

type Context = { args: StatusRowProps; canvasElement: HTMLElement };

const only = (text: string) => async ({ canvasElement }: Context) => {
  await expect(canvasElement.textContent).toBe(text);
};

const fails = (text: string) => async ({ canvasElement }: Context) => {
  await expect(within(canvasElement).getByRole("alert").textContent).toBe(text);
};

export const meta: ComponentMeta<StatusRowProps> = {
  args: { error: "The server did not answer.", empty: "Nothing held.", children: <p className="text-sm">3 rows</p> },
  examples: { "Failed without reason": { view: "PanelFailed", error: undefined } },
  play: {
    Default: async ({ canvasElement }: Context) => {
      await expect(canvasElement.textContent).toContain("Loading…");
      await expect(canvasElement.textContent).not.toContain("3 rows");
    },
    "Failed without reason": fails("The read failed."),
    "view PanelForbidden": only("Your role cannot see this."),
    "view PanelUnavailable": only("Not available here."),
    "view PanelFailed": fails("The server did not answer."),
    "view PanelEmpty": only("Nothing held."),
    "view PanelRows": only("3 rows"),
  },
};
