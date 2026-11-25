import { expect, test, vi } from "vitest";
import { Window } from "happy-dom";
import { installDom } from "./dom.ts";

function installCanvasShim(window: Window) {
  const makeCtx = () => new Proxy(function () {}, {
    get: (_t, p) => {
      if (p === "canvas") return window.document.createElement("canvas");
      if (p === "measureText") return () => ({ width: 0 });
      if (p === "getImageData") return () => ({ data: [] });
      if (p === "createLinearGradient" || p === "createRadialGradient" || p === "createPattern") return () => ({ addColorStop() {} });
      return (..._a: unknown[]) => undefined;
    },
    set: () => true,
    apply: () => undefined,
  });
  window.HTMLCanvasElement.prototype.getContext = (function () {
    return makeCtx() as unknown as CanvasRenderingContext2D;
  }) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;
}

test("MapView invalidates Leaflet size when its container resizes and stops after destroy", async () => {
  const observe = vi.fn(), disconnect = vi.fn();
  let notify = () => {};
  const window = new Window({ url: "http://127.0.0.1/" });
  const restoreDom = installDom(window, {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    ResizeObserver: class {
      constructor(callback: () => void) { notify = callback; }
      observe = observe;
      disconnect = disconnect;
    },
  });
  installCanvasShim(window);
  const el = window.document.createElement("div");
  let height = 660;
  Object.defineProperty(el, "clientWidth", { get: () => 960, configurable: true });
  Object.defineProperty(el, "clientHeight", { get: () => height, configurable: true });
  window.document.body.append(el);
  const L = (await import("leaflet")).default;
  const invalidateSpy = vi.spyOn(L.Map.prototype, "invalidateSize");
  const { MapView } = await import("../web/map.ts");
  const mapView = new MapView(el as unknown as HTMLElement);
  try {
    expect(observe).toHaveBeenCalledWith(el);
    invalidateSpy.mockClear();

    height = 350;
    notify();
    expect(invalidateSpy).toHaveBeenCalledOnce();
    expect(invalidateSpy).toHaveBeenCalledWith({ animate: false, debounceMoveend: true });

    height = 0;
    notify();
    expect(invalidateSpy).toHaveBeenCalledOnce();

    height = 660;
    notify();
    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    mapView.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
    notify();
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  } finally {
    invalidateSpy.mockRestore();
    await window.happyDOM.close();
    restoreDom();
  }
});
