import type { ComponentMeta } from "../../lib/meta.ts";
import type { AppSwitcherProps } from "./AppSwitcher.tsx";

export const meta: ComponentMeta<AppSwitcherProps> = {
  args: {
    app: "slop",
    apps: [{ id: "ntwrk", title: "ntwrk.party" }, { id: "slop", title: "slop.date" }, { id: "peon", title: "peon.biz" }, { id: "friends", title: "friends.help" }],
  },
};
