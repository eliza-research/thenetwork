// spec/consolePanels.md, "Compare opens only with two runs, and a third pick drops the oldest"
import { initial, pickRun, receiveRuns, type RunCompare } from "../../../packages/core/src/generated/consolePanels.ts";

export interface RunCompareSelection {
  model: RunCompare;
  ids: string[];
}

/** The range and focus can replace runs without changing the number of rows. */
export function reconcileRunCompare(selection: RunCompareSelection, visible: readonly { id: string }[]): RunCompareSelection {
  const visibleIds = new Set(visible.map(run => run.id));
  const ids = visible.length >= 2 ? selection.ids.filter(id => visibleIds.has(id)) : [];
  if (selection.model.runTotal === visible.length && ids.length === selection.ids.length) return selection;

  let panels = receiveRuns({ ...initial, runs: selection.model }, visible.length);
  if (panels.runs.comparing) {
    for (let removed = ids.length; removed < selection.ids.length; removed++) panels = pickRun(panels, true);
  }
  return { model: panels.runs, ids };
}
