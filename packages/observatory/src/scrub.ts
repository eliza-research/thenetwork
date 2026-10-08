// PII scrubbing for real-world mode (PRD 35.1: PII-scrubbed views by default, explicit reveal).
// Names become "First L.", contact details in free text are masked, and agent-private or sensitive
// facets are withheld. OBSERVATORY_REVEAL_PII=1 turns scrubbing off (local, dev databases only).
// The masks are the leak guard's contact patterns (core guard.ts) plus what a staff screen must not
// show although the guard does not stop it in a member's own words: card numbers, US social security
// numbers, phone numbers spelled out in words, and handles named with their app ("insta: maya.r").
import { CONTACT_PATTERNS, type Facet } from "@thenetwork/core";

const MASK_LABEL: Record<string, string> = { email_spelled: "email", street_address: "address", url: "link" };

const NUM_WORD = "(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|\\d{1,4})";
/** A run of number words and digit groups is a phone when it holds 7 or more digits and at least one word. */
const spelledPhone = (run: string) => {
  const parts = run.split(/[\s,.\-]+/).filter(Boolean);
  const digits = parts.reduce((n, p) => n + (/^\d+$/.test(p) ? p.length : 1), 0);
  return digits >= 7 && parts.some(p => !/^\d+$/.test(p));
};
const APPS = "(?:ig|insta|instagram|snap|snapchat|tiktok|twitter|telegram|whatsapp|discord|venmo|cashapp|kik|signal)";
/** Console-only masks, run before the guard's (a card number would otherwise be cut into a phone and a digit). */
const EXTRA: { re: RegExp; label: string; keep?: boolean; when?: (match: string) => boolean }[] = [
  // 13-19 digits in groups: card numbers.
  { re: /\b(?:\d[ -]?){12,18}\d\b/g, label: "[card]" },
  // 123-45-6789 (or with spaces): a US social security number.
  { re: /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g, label: "[ssn]" },
  // Number words and digit groups in a row that hold 7 or more digits: "five five five, oh one two three", "212 five five five 0114".
  { re: new RegExp(`\\b${NUM_WORD}(?:[\\s,.\\-]+${NUM_WORD}){2,}\\b`, "gi"), label: "[phone]", when: spelledPhone },
  // "insta: maya.rose", "snap = mayaxo": the app, a colon, the handle.
  { re: new RegExp(`(\\b${APPS}\\s*[:=]\\s*)[@$]?[a-z0-9_.]{3,}`, "gi"), label: "[handle]", keep: true },
  // "my insta is maya.rose", "add me on snap mayaxo".
  { re: new RegExp(`(\\b(?:my|on)\\s+${APPS}\\s+(?:is\\s+|at\\s+|as\\s+)?)@?(?!\\[)[a-z0-9_.]{3,}`, "gi"), label: "[handle]", keep: true },
];
/** The leak guard's contact patterns (core guard.ts), made global and case-blind for masking. */
const MASKS = CONTACT_PATTERNS.map(({ name, re }) => ({ re: new RegExp(re.source, "gi"), label: `[${MASK_LABEL[name] ?? name}]` }));
const CANARY_REF = /\(ref [^)]+\)/g;

/** "Maya Rose Chen" -> "Maya C.". No name (a declined member, a missing row): "Unnamed member" (audit observatory-23). */
export function displayName(name: string | null | undefined, reveal: boolean): string {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return "Unnamed member";
  if (reveal) return n;
  const [first, ...rest] = n.split(/\s+/);
  const last = rest[rest.length - 1];
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first!;
}

export function scrubText(text: string, reveal: boolean): string {
  if (reveal) return text;
  // Canary refs first: their ids can look like handles or phone numbers.
  let t = (text ?? "").replace(CANARY_REF, "(ref [private])");
  for (const m of EXTRA) t = t.replace(m.re, (x: string, keep?: unknown) => (m.when && !m.when(x) ? x : m.keep && typeof keep === "string" ? keep + m.label : m.label));
  return MASKS.reduce((s, m) => s.replace(m.re, x => (/^[\s(]/.test(x) ? x[0] + m.label : m.label)), t);
}

export function scrubFacet(f: Facet, reveal: boolean): Facet {
  if (reveal) return f;
  if (f.scope === "agent_private" || f.sensitive) return { ...f, value: "[private · agent only]", tags: [] };
  return { ...f, value: scrubText(f.value, false) };
}
