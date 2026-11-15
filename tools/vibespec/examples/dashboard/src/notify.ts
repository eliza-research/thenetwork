// spec/tracker.md, "One pass of the notifier sends everything that is due and records that it was sent"
// The shell around `notify`: one chat message per person. It touches the outside world, so test/notify.test.ts
// tests it; no proof. Duplicates are already ruled out by "Nothing is sent twice".
import type { Note } from "../gen/tracker.ts";

export interface Message { to: string; handle: string; text: string }

const LINE: Record<Note["kind"], (n: Note) => string> = {
  Update: (n) => `✎ #${n.task} changed`,
  Soon: (n) => `⏳ #${n.task} due day ${n.version}`,
  Today: (n) => `⚠ #${n.task} due today`,
};

/** One message per person with a chat handle, in the order people first appear. */
export function messages(notes: Note[], handles: Record<string, string>): Message[] {
  const byPerson = new Map<string, string[]>();
  for (const n of notes) if (handles[n.to]) byPerson.set(n.to, [...(byPerson.get(n.to) ?? []), LINE[n.kind](n)]);
  return [...byPerson].map(([to, lines]) => ({ to, handle: handles[to]!, text: lines.join("\n") }));
}

/** Sends one pass's notes; returns how many messages went out. */
export async function send(notes: Note[], handles: Record<string, string>, post: (handle: string, text: string) => Promise<void>): Promise<number> {
  const out = messages(notes, handles);
  for (const m of out) await post(m.handle, m.text);
  return out.length;
}
