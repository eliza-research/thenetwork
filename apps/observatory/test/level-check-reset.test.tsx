import { act, createElement } from "react";
import { Window } from "happy-dom";
import { expect, test, vi } from "vitest";
import { installDom } from "./dom.ts";

const { getJSON, control, simulated } = vi.hoisted(() => ({
  getJSON: vi.fn(),
  control: vi.fn(),
  simulated: {
    game: { over: false },
    network: { scenario: { id: "test-level", title: "Test level", description: "Simulation fixture" } },
  },
}));

vi.mock("../web/store.ts", () => ({ store: { getJSON, control }, useStore: () => simulated }));
vi.mock("../web/ops.tsx", async () => {
  const { initial, receiveViewer } = await import("../../../packages/core/src/generated/consolePanels.ts");
  return { panelStaffOf: () => receiveViewer(initial, "SimulatedPanels", false, true, true, false).staff };
});

type CheckResult = { ok: true; data: { pass: boolean; checks: { name: string; pass: boolean; detail: string }[] } };
const checkResult = (name: string): CheckResult => ({ ok: true, data: { pass: true, checks: [{ name, pass: true, detail: "" }] } });

test("a pending level check cannot repopulate the result after resetting the same level", async () => {
  const oldCheck = Promise.withResolvers<CheckResult>();
  const newCheck = Promise.withResolvers<CheckResult>();
  getJSON.mockResolvedValue([{ ...simulated.network.scenario, days: 1 }]);
  control.mockImplementation((cmd: { type: string }) => cmd.type === "reset"
    ? Promise.resolve({ ok: true })
    : control.mock.calls.filter(([call]) => call.type === "check_scenario").length === 1 ? oldCheck.promise : newCheck.promise);
  const window = new Window({ url: "http://localhost/" });
  const restore = installDom(window, { window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const { Levels } = await import("../web/network.tsx");
  const box = window.document.createElement("div");
  window.document.body.appendChild(box);
  const root = createRoot(box as unknown as HTMLElement);
  const button = (label: string) => {
    const found = [...box.querySelectorAll("button")].find(node => node.textContent?.startsWith(label));
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  };
  try {
    await act(async () => { root.render(createElement(Levels)); });
    await act(async () => { button("Check level").click(); });
    await act(async () => { button("Test level").click(); });
    expect(control).toHaveBeenNthCalledWith(2, { type: "reset", scenario: "test-level", network: "consent" });
    await act(async () => { oldCheck.resolve(checkResult("Old world result")); });
    expect(box.textContent).not.toContain("Old world result");

    await act(async () => { button("Check level").click(); });
    await act(async () => { newCheck.resolve(checkResult("Fresh world result")); });
    expect(box.textContent).toContain("Fresh world result");
  } finally {
    await act(async () => { root.unmount(); });
    await window.happyDOM.close();
    restore();
    vi.clearAllMocks();
  }
});
