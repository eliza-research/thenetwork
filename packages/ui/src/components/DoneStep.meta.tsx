import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { DoneStepProps } from "./DoneStep.tsx";

export const meta: ComponentMeta<DoneStepProps> = {
  args: { firstName: "Ana" },
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).queryByText("Go back to the same chat to finish setting up your profile.")).toBeNull(),
    agentReturn: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByText("Go back to the same chat to finish setting up your profile.")).toBeTruthy(),
  },
};
