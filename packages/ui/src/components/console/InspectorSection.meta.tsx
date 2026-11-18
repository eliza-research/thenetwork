import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import { Button } from "../Button.tsx";
import type { InspectorSectionProps } from "./InspectorSection.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<InspectorSectionProps> = {
  args: { title: "Profile", children: "Astoria · 29 · climbing, film photography" },
  examples: {
    "With action": {
      action: (
        <Button size="sm" variant="outline">
          Edit
        </Button>
      ),
    },
  },
  play: {
    // The title names the section, so a screen reader can move from one section of the inspector to the next.
    Default: async ({ canvasElement }: Context) => {
      const section = within(canvasElement).getByRole("region", { name: "Profile" });
      await expect(within(section).getByRole("heading", { name: "Profile" })).toBeTruthy();
      await expect(within(section).getByText("Astoria · 29 · climbing, film photography")).toBeTruthy();
    },
    "With action": async ({ canvasElement }: Context) => {
      const section = within(canvasElement).getByRole("region", { name: "Profile" });
      await expect(within(section).getByRole("button", { name: "Edit" })).toBeTruthy();
    },
  },
};
