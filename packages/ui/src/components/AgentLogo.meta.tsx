import type { ComponentMeta } from "../lib/meta.ts";
import type { AgentLogoProps } from "./AgentLogo.tsx";

export const meta: ComponentMeta<AgentLogoProps> = {
  args: { agent: "ChatGpt", className: "size-8" },
};
