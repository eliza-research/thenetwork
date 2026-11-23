import { expect, within } from "storybook/test";
import { apiMessages } from "../api/client.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { FlowNoticeProps } from "./FlowNotice.tsx";

type Context = { args: FlowNoticeProps; canvasElement: HTMLElement };

const says = (message: string) => async ({ canvasElement }: Context) => {
  await expect(within(canvasElement).getByText(message)).toBeTruthy();
};

export const meta: ComponentMeta<FlowNoticeProps> = {
  args: { notice: "ApiUnreachable" },
  play: {
    Default: says(apiMessages.api_unreachable),
    "notice SessionEnded": says(apiMessages.unauthorized),
    "notice AccountChanged": says(apiMessages.account_changed),
    "notice NoNotice": async ({ canvasElement }: Context) => {
      await expect(canvasElement.textContent).toBe("");
    },
  },
};
