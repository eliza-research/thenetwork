import { expect, test } from "vitest";
import { initial, pickRun, receiveDiff, receiveRuns, runsView, toggleCompare } from "../../../packages/core/src/generated/consolePanels.ts";
import { reconcileRunCompare } from "../web/run-compare.ts";

const rows = (...ids: string[]) => ids.map(id => ({ id }));

test("comparison drops hidden picks when a filter swaps runs at the same count", () => {
  let panels = toggleCompare(receiveRuns(initial, 3));
  panels = pickRun(pickRun(panels, false), false);
  panels = receiveDiff(panels, true);
  const before = { model: panels.runs, ids: ["old-a", "shared"] };

  const after = reconcileRunCompare(before, rows("new-a", "shared", "new-b"));
  expect(after.ids).toEqual(["shared"]);
  expect(after.model).toMatchObject({ comparing: true, picked: 1, runTotal: 3, diff: "NoDiff" });
  expect(runsView(after.model)).toBe("PickTwoView");
  expect(reconcileRunCompare(after, rows("old-a", "shared", "new-b")).ids).toEqual(["shared"]);
});

test("comparison preserves visible picks and closes when there are too few runs", () => {
  const panels = pickRun(pickRun(toggleCompare(receiveRuns(initial, 3)), false), false);
  const before = { model: panels.runs, ids: ["a", "b"] };
  expect(reconcileRunCompare(before, rows("new", "b", "a"))).toBe(before);
  const narrower = reconcileRunCompare(before, rows("b", "a"));
  expect(narrower.ids).toEqual(["a", "b"]);
  expect(narrower.model.diff).toBe("DiffLoading");

  const one = reconcileRunCompare(narrower, rows("b"));
  expect(one.ids).toEqual([]);
  expect(one.model).toMatchObject({ comparing: false, picked: 0, runTotal: 1, diff: "NoDiff" });
});
