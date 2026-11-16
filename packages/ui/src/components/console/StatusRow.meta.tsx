import type { ComponentMeta } from "../../lib/meta.ts";
import type { StatusRowProps } from "./StatusRow.tsx";

export const meta: ComponentMeta<StatusRowProps> = {
  args: { error: "The server did not answer.", empty: "Nothing held.", children: <p className="text-sm">3 rows</p> },
};
