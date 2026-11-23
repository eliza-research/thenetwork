import type { MemberId } from "@thenetwork/core";

const word = "[\\p{L}\\p{M}\\p{N}_]";
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalize = (text: string) => text.normalize("NFC").trim().replace(/\s+/g, " ");

/** Text fallback for simulated identities only. Do not guess an owner for an ambiguous display form. */
export function simulatedNameMatcher(personas: Iterable<{ id: MemberId; name: string }>) {
  const aliases = new Map<string, MemberId | null>();
  const order = new Map<MemberId, number>();
  const add = (alias: string, id: MemberId) => {
    const previous = aliases.get(alias);
    aliases.set(alias, previous === undefined || previous === id ? id : null);
  };
  for (const { id, name } of personas) {
    const full = normalize(name);
    const [first, surname] = full.split(" ");
    if (!first) continue;
    order.set(id, order.size);
    add(full, id);
    add(first, id);
    if (surname) add(`${first} ${Array.from(surname)[0]}.`, id);
  }
  if (!aliases.size) return (_text: string): MemberId[] => [];

  // Match longer forms first, including ambiguous ones. A shared "Rae V." cannot fall through to
  // a shorter name. The Unicode boundaries apply even after the period in a display initial.
  const forms = [...aliases.keys()].sort((a, b) => b.length - a.length).map(escape).join("|");
  const mentions = new RegExp(`(?<!${word})(?:${forms})(?!${word})`, "gu");
  return (text: string): MemberId[] => {
    const found = new Set<MemberId>();
    for (const match of normalize(text).matchAll(mentions)) {
      const id = aliases.get(match[0]);
      if (id) found.add(id);
    }
    return [...found].sort((a, b) => order.get(a)! - order.get(b)!);
  };
}
