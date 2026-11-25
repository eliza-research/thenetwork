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

test.each(["pointercancel", "lostpointercapture"])("GraphView stops panning on %s and ignores other pointers", async (canceledBy) => {
  const window = new Window({ url: "http://127.0.0.1/" });
  const restoreDom = installDom(window, {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  installCanvasShim(window);
  const canvasEl = window.document.createElement("canvas");
  window.document.body.append(canvasEl);
  const canvas = canvasEl as unknown as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ width: 600, height: 400, top: 0, left: 0, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
  canvas.setPointerCapture = vi.fn<(_pointerId: number) => void>();
  const { GraphView } = await import("../web/graph.ts");
  const graph = new GraphView(canvas);
  const internal = graph as unknown as { view: { x: number; y: number; k: number } };
  internal.view = { x: 0, y: 0, k: 1 };
  const fire = (type: string, pointerId: number, offsetX = 0, offsetY = 0) =>
    canvas.dispatchEvent(Object.assign(new window.Event(type), { pointerId, offsetX, offsetY }) as unknown as Event);
  try {
    fire("pointerdown", 1, 10, 20);
    fire("pointermove", 1, 25, 40);
    expect(internal.view).toEqual({ x: 15, y: 20, k: 1 });

    fire("pointermove", 2, 100, 100);
    expect(internal.view).toEqual({ x: 15, y: 20, k: 1 });

    fire(canceledBy, 2);
    fire("pointermove", 1, 30, 50);
    expect(internal.view).toEqual({ x: 20, y: 30, k: 1 });

    fire(canceledBy, 1);
    fire("pointermove", 1, 40, 60);
    expect(internal.view).toEqual({ x: 20, y: 30, k: 1 });

    fire("pointerdown", 3, 50, 60);
    fire("pointermove", 3, 60, 65);
    fire("pointerup", 3, 60, 65);
    fire("pointermove", 3, 95, 120);
    expect(internal.view).toEqual({ x: 30, y: 35, k: 1 });
  } finally {
    graph.destroy();
    await window.happyDOM.close();
    restoreDom();
  }
});
