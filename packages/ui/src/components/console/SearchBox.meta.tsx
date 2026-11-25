import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { SearchBoxProps } from "./SearchBox.tsx";

type Context = { args: SearchBoxProps; canvasElement: HTMLElement };

const box = (canvasElement: HTMLElement) => within(canvasElement).getByRole("combobox");

const conversationHit = { key: "c1", label: "Maya Chen", meta: "Nov 3, 4:12 PM · Network", snippet: "Are you free Thursday evening?" };

export const meta: ComponentMeta<SearchBoxProps> = {
  args: {
    value: "ma",
    groups: "NamesAndPlaces",
    hits: [
      { key: "m1", label: "Maya Chen", meta: "Astoria" },
      { key: "n1", label: "Manhattan Valley", meta: "Manhattan" },
    ],
  },
  examples: {
    "Conversation search": { conversationSearch: true },
    "Conversation results": { conversation: { query: "ma", hits: [conversationHit] } },
    "Conversation loading": { conversation: { query: "ma" } },
    "Conversation error": { conversation: { query: "ma", error: "Search failed. Try again." } },
    Closed: { value: "m", groups: "NoHits" },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const input = box(canvasElement);
      await expect(input.getAttribute("aria-expanded")).toBe("true");
      await userEvent.type(input, "y");
      await expect(args.onValueChange).toHaveBeenLastCalledWith("may");
      await userEvent.keyboard("{ArrowDown}{ArrowDown}");
      await expect(input.getAttribute("aria-activedescendant")).toBe("obs-search-option-1");
      await userEvent.keyboard("{Enter}");
      await expect(args.onPick).toHaveBeenCalledWith(args.hits[1]);
      await userEvent.keyboard("{Escape}");
      await expect(input.getAttribute("aria-expanded")).toBe("false");
    },
    "Conversation search": async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const input = box(canvasElement);
      input.focus();
      await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
      await expect(args.onSearchConversations).toHaveBeenCalledTimes(1);
      await expect(args.onPick).not.toHaveBeenCalled();
    },
    "Conversation results": async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const page = within(canvasElement.ownerDocument.body);
      await expect(page.getByRole("listbox", { name: "Conversation results" })).toBeTruthy();
      box(canvasElement).focus();
      await userEvent.keyboard("{Enter}");
      await expect(args.onPickConversation).toHaveBeenCalledWith(conversationHit);
      await userEvent.click(page.getByRole("button", { name: "back" }));
      await expect(args.onCloseConversation).toHaveBeenCalledTimes(1);
    },
    "Conversation loading": async ({ canvasElement }: Context) => {
      await expect(within(canvasElement.ownerDocument.body).getByText("Searching…")).toBeTruthy();
    },
    "Conversation error": async ({ canvasElement }: Context) => {
      await expect(within(canvasElement.ownerDocument.body).getByRole("alert").textContent).toBe("Search failed. Try again.");
    },
    Closed: async ({ canvasElement }: Context) => {
      await expect(box(canvasElement).getAttribute("aria-expanded")).toBe("false");
    },
  },
};
