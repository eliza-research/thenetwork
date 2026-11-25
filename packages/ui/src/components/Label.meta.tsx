import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import { Checkbox } from "./Checkbox.tsx";
import type { LabelProps } from "./Label.tsx";

type Context = { args: LabelProps; canvasElement: HTMLElement };

export const meta: ComponentMeta<LabelProps> = {
  args: { children: "Gift wrap" },
  examples: {
    "Disabled control": {
      children: (
        <>
          <Checkbox disabled />
          Gift wrap
        </>
      ),
    },
  },
  play: {
    "Disabled control": async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      const checkbox = canvas.getByRole("checkbox", { name: "Gift wrap" });
      await userEvent.click(canvas.getByText("Gift wrap"), { pointerEventsCheck: 0 });
      await expect(checkbox.getAttribute("aria-checked")).toBe("false");
    },
  },
};
