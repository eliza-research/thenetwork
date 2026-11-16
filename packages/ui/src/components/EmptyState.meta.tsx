import type { ComponentMeta } from "../lib/meta.ts";
import { Button } from "./Button.tsx";
import type { EmptyStateProps } from "./EmptyState.tsx";

export const meta: ComponentMeta<EmptyStateProps> = {
  args: { title: "No orders", children: <Button>New order</Button> },
};
