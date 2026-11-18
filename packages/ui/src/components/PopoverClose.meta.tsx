import type { ComponentProps } from "react";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import { Button } from "./Button.tsx";
import { Popover, type PopoverClose, PopoverContent, PopoverTrigger } from "./Popover.tsx";

// The args do not set `asChild`: the generator then makes no story with `asChild: false`, which would put a Button in a button.
export const meta: ComponentMeta<ComponentProps<typeof PopoverClose>> = {
  args: { children: "Done" },
  // Without a word, the button gets its name from `aria-label`.
  examples: { Empty: { "aria-label": "Close", children: undefined } },
  // A `PopoverClose` works only inside an open `Popover`.
  decorator: (story) => (
    <Popover defaultOpen>
      <PopoverTrigger asChild>
        <Button variant="outline">Filters</Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Filters">{story()}</PopoverContent>
    </Popover>
  ),
  play: {
    // Done closes the panel, and focus goes back to the trigger.
    Default: async () => {
      await expect(await screen.findByRole("dialog", { name: "Filters" })).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() => expect([screen.queryByRole("dialog"), document.activeElement]).toEqual([null, screen.getByRole("button", { name: "Filters" })]));
    },
    Empty: async () => {
      await userEvent.click(await screen.findByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    },
  },
};
