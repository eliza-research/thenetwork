import { expect, screen, userEvent, waitFor } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import { Button } from "./Button.tsx";
import { Checkbox } from "./Checkbox.tsx";
import { Label } from "./Label.tsx";
import { PopoverContent, type PopoverProps, PopoverTrigger } from "./Popover.tsx";

const children = (
  <>
    <PopoverTrigger asChild>
      <Button variant="outline">Filters</Button>
    </PopoverTrigger>
    <PopoverContent aria-label="Filters">
      <Label>
        <Checkbox />
        In stock
      </Label>
    </PopoverContent>
  </>
);

export const meta: ComponentMeta<PopoverProps> = {
  args: { children },
  play: {
    Default: async () => {
      const trigger = screen.getByRole("button", { name: "Filters" });
      await userEvent.click(trigger);
      await expect(await screen.findByRole("dialog", { name: "Filters" })).toBeTruthy();
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect([screen.queryByRole("dialog"), document.activeElement]).toEqual([null, trigger]));
    },
  },
};
