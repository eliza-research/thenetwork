import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { ConnectedAssistantsViewProps, GrantSummary } from "./ConnectedAssistantsView.tsx";

const grants: GrantSummary[] = [
  { id: "grant_a1", clientName: "Claude", allowedOn: "2026-11-02", scopes: ["apps:read", "membership:read", "profile:write"] },
  { id: "grant_b2", clientName: null, allowedOn: "2026-11-14", scopes: ["apps:read"] },
];

export const meta: ComponentMeta<ConnectedAssistantsViewProps> = {
  args: { app: "Friends", view: "ListView", grants },
  examples: {
    Confirming: { view: "ConfirmingRemoval", confirmingGrantId: "grant_a1" },
    "Access removed": { view: "ListView", grants: grants.slice(1), notice: true },
    Empty: { view: "EmptyView", grants: [] },
  },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      const remove = page.getAllByRole("button", { name: "Remove access" });
      await expect(remove).toHaveLength(2);
      await expect(remove[0].closest("form")?.getAttribute("method")).toBe("get");
      await expect(page.getByText("An unnamed assistant")).toBeTruthy();
    },
    Confirming: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      const confirm = page.getAllByRole("button", { name: "Remove access" });
      await expect(confirm).toHaveLength(1);
      await expect(confirm[0].closest("form")?.getAttribute("action")).toBe("/oauth/consents/revoke");
      await expect(page.getByRole("link", { name: "Keep access" }).getAttribute("href")).toBe("/oauth/consents");
    },
    "Access removed": ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("status").textContent).toBe("Access removed."),
    ViewSignInFirstView: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).queryByRole("button")).toBeNull(),
  },
};
