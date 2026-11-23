import type { ComponentMeta } from "../lib/meta.ts";
import type { FlowNoticeProps } from "./FlowNotice.tsx";

export const meta: ComponentMeta<FlowNoticeProps> = {
  args: { notice: "ApiUnreachable" },
};
