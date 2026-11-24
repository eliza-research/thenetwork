import { expect, test, vi } from "vitest";
import { handleFeedRowKey } from "../web/feed-row-key.ts";

const row = new EventTarget() as HTMLDivElement;
const nested = new EventTarget();
const keyEvent = (key: string, type: string, target: EventTarget = row, repeat = false) =>
  ({ key, type, target, repeat, currentTarget: row, preventDefault: vi.fn(), stopPropagation: vi.fn() });

test("the activity row opens on Space release and Enter press without scrolling or repeating", () => {
  const open = vi.fn();
  const held = keyEvent(" ", "keydown");
  handleFeedRowKey(held, open);
  expect(held.preventDefault).toHaveBeenCalledOnce();
  expect(held.stopPropagation).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  handleFeedRowKey(keyEvent(" ", "keydown", row, true), open);
  handleFeedRowKey(keyEvent(" ", "keyup"), open);
  expect(open).toHaveBeenCalledOnce();
  handleFeedRowKey(keyEvent("Enter", "keydown"), open);
  handleFeedRowKey(keyEvent("Enter", "keydown", row, true), open);
  handleFeedRowKey(keyEvent("Enter", "keyup"), open);
  expect(open).toHaveBeenCalledTimes(2);
});

test("keyboard events from inner subject buttons leave the row untouched", () => {
  const open = vi.fn();
  for (const key of ["Enter", " "]) {
    for (const type of ["keydown", "keyup"]) {
      const event = keyEvent(key, type, nested);
      handleFeedRowKey(event, open);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
  }
  expect(open).not.toHaveBeenCalled();
});
