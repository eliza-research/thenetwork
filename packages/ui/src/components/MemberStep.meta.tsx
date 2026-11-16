import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { MemberStepProps } from "./MemberStep.tsx";

export const meta: ComponentMeta<MemberStepProps> = {
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      canvas.getByRole("heading", { level: 1, name: "You're already in." });
      return expect(canvas.getByText("Return to your agent.")).toBeTruthy();
    },
  },
};
