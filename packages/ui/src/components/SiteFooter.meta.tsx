import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { SiteFooterProps } from "./SiteFooter.tsx";

export const meta: ComponentMeta<SiteFooterProps> = {
  examples: { "Another site's pages": { origin: "https://slop.date" } },
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["Privacy", "/privacy"], ["Terms", "/terms"]]),
    // ntwrk.party renders connector pages for the other apps: their footers open the app's own legal pages.
    "Another site's pages": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["Privacy", "https://slop.date/privacy"], ["Terms", "https://slop.date/terms"]]),
    Empty: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).queryByRole("link")).toBeNull(),
  },
};
