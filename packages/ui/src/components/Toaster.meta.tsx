import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import { Toast, type ToasterProps } from "./Toast.tsx";

type Context = { args: ToasterProps; canvasElement: HTMLElement };

const region = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body).getByRole("status");

export const meta: ComponentMeta<ToasterProps> = {
  args: {
    className: "static",
    children: (
      <>
        <Toast variant="ok">Copied</Toast>
        <Toast variant="warn">Saved, but the text line is slow.</Toast>
      </>
    ),
  },
  play: {
    Default: async ({ canvasElement }: Context) => {
      await expect(region(canvasElement).textContent).toBe("CopiedSaved, but the text line is slow.");
    },
    Empty: async ({ canvasElement }: Context) => {
      await expect(region(canvasElement).textContent).toBe("");
    },
  },
};
