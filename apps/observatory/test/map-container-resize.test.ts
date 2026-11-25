import { expect, test, vi } from "vitest";
import { observeMapSize } from "../web/map-size.ts";

test("map reacts to a resized container, not the window, while keeping hidden and detached stages quiet", () => {
  const observe = vi.fn(), disconnect = vi.fn(), invalidate = vi.fn();
  let notify = () => {};
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { notify = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  const container = { clientWidth: 960, clientHeight: 660 };
  try {
    const stop = observeMapSize(container as HTMLElement, invalidate);
    expect(observe).toHaveBeenCalledWith(container);

    container.clientHeight = 350;
    notify();
    expect(invalidate).toHaveBeenCalledOnce();

    container.clientHeight = 0;
    notify();
    expect(invalidate).toHaveBeenCalledOnce();

    container.clientHeight = 660;
    notify();
    expect(invalidate).toHaveBeenCalledTimes(2);

    stop();
    notify();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("without ResizeObserver the map keeps its existing window-resize behavior", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  try {
    const invalidate = vi.fn();
    const stop = observeMapSize({ clientWidth: 960, clientHeight: 660 } as HTMLElement, invalidate);
    expect(() => stop()).not.toThrow();
    expect(invalidate).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
