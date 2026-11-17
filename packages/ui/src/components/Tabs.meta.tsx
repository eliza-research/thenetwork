import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import { TabsContent, TabsList, type TabsProps, TabsTrigger } from "./Tabs.tsx";

export const meta: ComponentMeta<TabsProps> = {
  args: {
    defaultValue: "orders",
    children: (
      <>
        <TabsList aria-label="History">
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="returns">Returns</TabsTrigger>
        </TabsList>
        <TabsContent value="orders">Order 1042</TabsContent>
        <TabsContent value="returns">Return 77</TabsContent>
      </>
    ),
  },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("tab", { name: "Returns" }));
      await expect(canvas.getByRole("tabpanel", { name: "Returns" }).textContent).toBe("Return 77");
    },
  },
};
