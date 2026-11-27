import { setTimeout as sleep } from "node:timers/promises";
import { DAY, HOUR } from "@thenetwork/core";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { expect, test } from "vitest";
import { GameSource } from "../src/sources/game.ts";
import { installDom } from "./dom.ts";

test("Plan and Booked plan agree on a generated venue time even with another City selected", async () => {
  const fixture = new GameSource({
    seed: 4, personas: 80, days: 14, city: "all", network: "consent", pushMs: HOUR, tickMs: HOUR,
  });
  await fixture.init();
  const window = new Window({ url: "http://127.0.0.1/" });
  const restore = installDom(window, {
    window, document: window.document, navigator: window.navigator, location: window.location,
    history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    // The view can show the plan from the actual game snapshot; the detail read is unnecessary here.
    fetch: () => Promise.resolve(new Response(null, { status: 404 })),
  });
  let unmount: (() => void) | undefined;
  let disconnect: (() => void) | undefined;
  try {
    expect((await fixture.control({ type: "step", ms: 5 * DAY })).ok).toBe(true);
    const snapshot = fixture.state();
    const booking = snapshot.opportunities.find(o =>
      o.city === "nyc" && o.venue && o.booked && o.meetingAt === o.booked.at && o.state === "SCHEDULED");
    expect(booking).toBeDefined();
    const { store } = await import("../web/store.ts");
    const { Inspector } = await import("../web/panels.tsx");
    const { createRoot } = await import("react-dom/client");
    disconnect = () => store.disconnect();
    store.me = { id: "fixture", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" };
    store["applyFull"](snapshot);
    store.setCity("chicago");
    store.focus({ kind: "opportunity", id: booking!.id });

    const box = window.document.createElement("div");
    window.document.body.append(box);
    const root = createRoot(box as unknown as HTMLElement);
    unmount = () => root.unmount();
    await act(async () => { root.render(createElement(Inspector)); await sleep(0); });
    const text = box.textContent ?? "";
    const format = (timeZone: string) => new Intl.DateTimeFormat("en-US", {
      timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }).format(booking!.booked!.at);
    const ny = format("America/New_York");
    expect(text).toContain(booking!.venue!.name);
    expect(text).toContain(ny);
    expect(text).toContain(`Booked for ${ny}`);
    expect(text).not.toContain(`Booked for ${format("America/Chicago")}`);
  } finally {
    await act(async () => unmount?.());
    disconnect?.();
    await window.happyDOM.close();
    restore();
    await fixture.dispose();
  }
}, 120_000);
