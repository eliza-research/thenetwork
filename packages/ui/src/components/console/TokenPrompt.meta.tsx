import type { ComponentMeta } from "../../lib/meta.ts";
import type { TokenPromptProps } from "./TokenPrompt.tsx";

export const meta: ComponentMeta<TokenPromptProps> = {
  args: { value: "" },
  examples: { Filled: { value: "obs_3f9c", canSubmit: true } },
};
