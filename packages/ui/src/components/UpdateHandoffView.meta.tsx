import { expect, within } from "storybook/test";
import { ntwrkBrand } from "../../../core/src/generated/brandIdentity.ts";
import { buttonPageButtons, UPDATE_HANDOFF_ASSISTANTS } from "../../../notify/src/links.ts";
import { UPDATE_HANDOFF_TEMPLATE_REFERENCE } from "../../../notify/src/reference.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { UpdateHandoffViewProps } from "./UpdateHandoffView.tsx";

const assistantButtons = buttonPageButtons(UPDATE_HANDOFF_TEMPLATE_REFERENCE, UPDATE_HANDOFF_ASSISTANTS);
const withReply = buttonPageButtons(UPDATE_HANDOFF_TEMPLATE_REFERENCE, UPDATE_HANDOFF_ASSISTANTS, "+15555550100");

const showsButtons = async (canvasElement: HTMLElement, buttons: readonly { href: string; label: string }[]) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("heading", { level: 1, name: "Open your update" })).toBeTruthy();
  const links = canvas.getAllByRole("link").filter((link) => link.closest("main"));
  await expect(links.map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("rel")])).toEqual(
    buttons.map(({ label, href }) => [label, href, "noreferrer"]),
  );
  await expect(canvasElement.querySelector("script, form, input")).toBeNull();
};

export const meta: ComponentMeta<UpdateHandoffViewProps> = {
  args: { brand: ntwrkBrand, buttons: assistantButtons },
  examples: { ReplyByText: { buttons: withReply } },
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) => showsButtons(canvasElement, assistantButtons),
    ReplyByText: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await showsButtons(canvasElement, withReply);
      await expect(within(canvasElement).getByRole("link", { name: "Reply by text" }).getAttribute("href")).toBe("sms:+15555550100");
    },
  },
};
