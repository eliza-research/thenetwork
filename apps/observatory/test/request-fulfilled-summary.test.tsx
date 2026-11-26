import { act } from "react";
import { Window } from "happy-dom";
import { expect, test } from "vitest";
import type { ObsRequest } from "../src/types.ts";
import { byRole, installDom } from "./dom.ts";

const now = Date.UTC(2026, 10, 26, 17);
const row = (outcome: ObsRequest["outcome"], label: string): ObsRequest => ({
  id: outcome, memberId: "fixture-member", kind: "plans", category: "hobby",
  outcome, label, tries: 1, openedAt: now, ageHours: 0,
});

test("Requests counts booked and fulfilled together without counting waiting requests", async () => {
  const window = new Window({ url: "http://localhost/" });
  const restore = installDom(window, {
    window, document: window.document, navigator: window.navigator, location: window.location,
    history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const box = document.createElement("div");
  document.body.append(box);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(box);
  const { store } = await import("../web/store.ts");
  const { Requests } = await import("../web/admin.tsx");
  const originalRequests = store.requests;
  const originalFilters = store.ui.filters;
  try {
    store.requests = [
      row("booked", "Plan with a booking"),
      row("fulfilled", "People introduction complete"),
      row("open", "Waiting for a plan"),
      row("none", "No suitable plan"),
    ];
    store.setFilters({ range: "all", borough: "all", members: "all" });
    await act(async () => root.render(<Requests />));
    expect(box.textContent).toContain("Waiting for a plan");
    const fulfilled = byRole<HTMLButtonElement>(box, "radio", /fulfilled/i);
    expect(fulfilled).not.toBeNull();
    await act(async () => fulfilled!.click());
    const table = box.querySelector("table")!;
    expect(table.textContent).toContain("Plan with a booking");
    expect(table.textContent).toContain("People introduction complete");
    expect(table.textContent).not.toContain("Waiting for a plan");
    expect(table.textContent).not.toContain("No suitable plan");
    expect(box.textContent).toContain("hobby 1 open / 2 fulfilled");
  } finally {
    await act(async () => root.unmount());
    store.requests = originalRequests;
    store.setFilters(originalFilters);
    await window.happyDOM.close();
    restore();
  }
});
