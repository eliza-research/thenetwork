import assert from "node:assert/strict";
import { test } from "node:test";
import { type Note, type Tracker, create, debounce, handAddOwner, initial, notify, tick } from "../gen/tracker.ts";
import { messages, send } from "../src/notify.ts";

const handles = { ana: "@ana", ben: "@ben", cal: "@cal" };

// spec/tracker.md, "A person named twice in a cell is told once"
test("a name typed twice is told once", async () => {
  let s: Tracker = handAddOwner(handAddOwner(create(initial, "ben"), 1, "ana"), 1, "ana");
  assert.deepEqual(s.tasks[0]!.owners, ["ana", "ana"]);
  for (let i = 0; i < debounce; i++) s = tick(s);
  s = notify(s);

  const sent: [string, string][] = [];
  assert.equal(await send(s.sent, handles, async (h, t) => { sent.push([h, t]); }), 1);
  assert.deepEqual(sent, [["@ana", "✎ #1 changed"]]);
});

test("one message per person with a chat handle", () => {
  const notes: Note[] = [
    { kind: "Update", task: 1, to: "ana", version: 0, at: 3 },
    { kind: "Soon", task: 2, to: "ben", version: 4, at: 3 },
    { kind: "Today", task: 2, to: "ana", version: 1, at: 3 },
    { kind: "Update", task: 1, to: "ama", version: 0, at: 3 },
  ];
  assert.deepEqual(messages(notes, handles), [
    { to: "ana", handle: "@ana", text: "✎ #1 changed\n⚠ #2 due today" },
    { to: "ben", handle: "@ben", text: "⏳ #2 due day 4" },
  ]);
});
