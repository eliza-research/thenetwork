import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { SiteFooterProps } from "./SiteFooter.tsx";

export const meta: ComponentMeta<SiteFooterProps> = {
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["Privacy", "/privacy"], ["Terms", "/terms"]]),
    Empty: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).queryByRole("link")).toBeNull(),
  },
};
