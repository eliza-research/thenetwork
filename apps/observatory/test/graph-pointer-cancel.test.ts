import { expect, test, vi } from "vitest";
import { GraphView } from "../web/graph.ts";

class TestCanvas extends EventTarget {
  style = { cursor: "" };
  setPointerCapture = vi.fn();
}

const input = (canvas: TestCanvas, type: string, pointerId: number, offsetX = 0, offsetY = 0) =>
  canvas.dispatchEvent(Object.assign(new Event(type), { pointerId, offsetX, offsetY }));

test.each(["pointercancel", "lostpointercapture"])("a canceled graph drag stops panning (%s)", (canceledBy) => {
  const canvas = new TestCanvas();
  // Exercise the actual graph pointer bindings without Canvas2D, the d3 simulation, or a live store.
  const bindings = GraphView.prototype as unknown as { bind(): void };
  const graph = {
    bind: bindings.bind, canvas, view: { x: 0, y: 0, k: 1 },
    drag: null, pick: vi.fn(() => null), hover: null,
  };
  graph.bind();
  input(canvas, "pointerdown", 1, 10, 20);
  input(canvas, "pointermove", 1, 25, 40);
  expect(graph.view).toEqual({ x: 15, y: 20, k: 1 });

  input(canvas, canceledBy, 2);
  input(canvas, "pointermove", 1, 30, 50);
  expect(graph.view).toEqual({ x: 20, y: 30, k: 1 });

  input(canvas, canceledBy, 1);
  input(canvas, "pointermove", 1, 40, 60);
  expect(graph.view).toEqual({ x: 20, y: 30, k: 1 });
  expect(graph.pick).toHaveBeenCalledWith(40, 60);

  input(canvas, "pointerdown", 3, 50, 60);
  input(canvas, "pointermove", 3, 60, 65);
  input(canvas, "pointerup", 3, 60, 65);
  input(canvas, "pointermove", 3, 95, 120);
  expect(graph.view).toEqual({ x: 30, y: 35, k: 1 });
});
