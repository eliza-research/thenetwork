import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import { Button } from "../Button.tsx";
import { ModeIndicator } from "./ModeIndicator.tsx";
import type { TopBarProps } from "./TopBar.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<TopBarProps> = {
  args: {
    brand: "Observatory",
    children: <ModeIndicator mode="SimulatedMode" label="SLOP · SIM · seed 1" />,
    end: (
      <Button size="sm" variant="ghost">
        Help
      </Button>
    ),
  },
  play: {
    // The children sit between the brand and the end controls, in reading order as well as on screen.
    Default: async ({ canvasElement }: Context) => {
      const bar = within(canvasElement).getByRole("banner");
      const brand = within(bar).getByText("Observatory");
      const mode = within(bar).getByRole("img", { name: "Simulated world" });
      const help = within(bar).getByRole("button", { name: "Help" });
      await expect(brand.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      await expect(mode.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  },
};
