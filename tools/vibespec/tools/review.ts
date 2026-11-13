import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { readSpecs, bareQuint as bare, type Import, type Spec, type Story, type Rule } from "./parse.ts";
import { short, readSrc, indent } from "./util.ts";

const lockFile = (root: string, spec: Spec) => path.join(root, spec.file.replace(/\.md$/, ".lock.json"));
/** Prose may be re-wrapped without becoming a different sentence. Code may not: a line break can end a comment. */
const proseFingerprint = (prose: string) => short(prose.replace(/\s+/g, " ").trim());
export const fingerprint = (r: Rule): [string, string] => [proseFingerprint(r.prose), short(r.code.split("\n").map((l) => l.trimEnd()).join("\n").trim())];
/** A story is recorded under its heading, which no rule's key can be. */
const storyKey = (s: Story) => `## ${s.title}`;
/** Story titles are unique (see parseSpec), so a story's rules are the ones filed under its title. */
const rulesOf = (spec: Spec, s: Story) => spec.rules.filter((r) => r.story === s.title);

/** The identifiers a piece of Quint mentions, outside comments and strings: `A::n` as a qualified pair, every other one bare. */
function mentions(code: string): { bare: Set<string>; qualified: [string, string][] } {
  const qualified: [string, string][] = [];
  const rest = bare(code).replace(/([A-Za-z_]\w*)\s*::\s*([A-Za-z_]\w*)/g, (_, q, n) => { qualified.push([q, n]); return " "; });
  return { bare: new Set(rest.match(/[A-Za-z_]\w*/g) ?? []), qualified };
}
/** The names a rule's Quint defines: its definitions and types, and the variants of its sum types. */
export function defines(rule: Rule): string[] {
  const variants: string[] = [];
  let inType = false;
  for (const line of bare(rule.code).split("\n")) {
    const declared = line.match(/^\s*(?:pure\s+)?(?:def|val|type|import|var|const)\b/);
    if (declared) inType = /^\s*type\s+\w+\s*=/.test(line);
    if (!inType) continue;
    const after = declared ? line.slice(line.indexOf("=") + 1) : line;
    for (const m of after.matchAll(/(?:^|\|)\s*([A-Z]\w*)\s*(?=\(|\||$)/g)) variants.push(m[1]);
  }
  return [...rule.defs, ...variants];
}
const definedIn = new WeakMap<Spec, Map<string, Rule[]>>();
function namesOf(spec: Spec): Map<string, Rule[]> {
  let names = definedIn.get(spec);
  if (!names) {
    names = new Map();
    for (const r of spec.rules) for (const n of defines(r)) names.set(n, [...(names.get(n) ?? []), r]);
    definedIn.set(spec, names);
  }
  return names;
}

/** A rule whose Quint another rule's Quint relies on, and the names it is relied on for. */
interface Dependency { spec: Spec; rule: Rule; names: Set<string> }

/**
 * The rules whose Quint `rule` relies on, directly or through others, in its own spec and in the specs it imports.
 * A bare name is looked up first in the spec that mentions it, then in the specs that one imports with `.*` or by that
 * name; `A::n` only in the spec imported as `A` (or, if no import is called `A`, as a bare name would be). The scan is
 * conservative: an identifier that happens to share a definition's name counts as a use of it.
 */
export function dependencies(spec: Spec, rule: Rule, specs: Spec[]): Dependency[] {
  const found = new Map<string, Dependency>();
  const homes = (from: Import[], n: string) => from.flatMap((u) => {
    const d = specs.find((x) => x.name === u.module);
    return d ? (namesOf(d).get(n) ?? []).map((x) => [d, x] as const) : [];
  });
  const visit = (s: Spec, r: Rule) => {
    const { bare: names, qualified } = mentions(r.code);
    const unqualified = (n: string) => {
      const own = namesOf(s).get(n);
      return own ? own.map((x) => [s, x] as const) : homes(s.uses.filter((u) => u.star || u.names.includes(n)), n);
    };
    const uses: [string, (readonly [Spec, Rule])[]][] = [...names].map((n) => [n, unqualified(n)]);
    for (const [q, n] of qualified) {
      const via = s.uses.filter((u) => (u.alias ?? u.module) === q);
      uses.push([`${q}::${n}`, via.length ? homes(via, n) : [...unqualified(n), ...homes(s.uses, n)]]);
    }
    for (const [n, at] of uses)
      for (const [ds, dr] of at) {
        if (dr === r || dr === rule) continue;
        const key = `${ds.file}\0${dr.key}`;
        const seen = found.get(key);
        if (seen) { seen.names.add(n); continue; }
        found.set(key, { spec: ds, rule: dr, names: new Set([n]) });
        visit(ds, dr);
      }
  };
  visit(spec, rule);
  return [...found.values()];
}
/** One fingerprint for the Quint of every rule a rule relies on; undefined if it relies on none. */
const dependencyFingerprint = (deps: Dependency[]) =>
  deps.length ? short(deps.map((d) => `${d.spec.name} / ${d.rule.key}: ${fingerprint(d.rule)[1]}`).sort().join("\n")) : undefined;

/** Something a person has to reconcile before the spec can be accepted. `lines` are a story's rules, or a contract's `//@` lines. */
export interface Pending { where: string; rule?: Rule; story?: Story; lines?: string[]; status: keyof typeof ASKS; note?: string }
const ASKS = {
  "story has no rules": "write one ### rule for each thing the story requires",
  "new story": "check that its rules say everything it asks for",
  "story changed": "check its rules still say everything it asks for",
  "not formalized": "add a quint block that says what the prose says",
  "new": "confirm the prose and the model say the same thing",
  "prose and model both changed": "confirm they still agree",
  "prose changed": "update the model to match, or confirm it already does",
  "model changed": "update the prose to match, or confirm it already does",
  "removed or renamed": "confirm the rule is meant to be gone",
  "new contract": "confirm its //@ annotations say what the code must guarantee",
  "contract changed": "confirm its //@ annotations still say what the code must guarantee",
  "contract removed": "confirm the file is no longer meant to be proved",
};
export const showPending = (p: Pending) => `${p.where}\n      ${p.status}${p.note ?? ""}: ${ASKS[p.status]}`;

type Lock = Record<string, string[]>;
/** A spec's ledger. `locks` remembers the ones read, for a caller that reads many in a row while none of them changes. */
const readLock = (root: string, spec: Spec, locks?: Map<string, Lock>): Lock => {
  const file = lockFile(root, spec);
  const known = locks?.get(file);
  if (known) return known;
  const lock: Lock = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  locks?.set(file, lock);
  return lock;
};

/**
 * Stories and rules to reconcile since `accept`. A rule's model is its own Quint and that of every rule it relies
 * on (see `dependencies`), so a change to a helper, a type or an imported definition flags every rule that uses it.
 */
export function pending(root: string, spec: Spec, specs: Spec[] = readSpecs(root), locks = new Map<string, Lock>()): Pending[] {
  const lock = readLock(root, spec, locks);
  const out: Pending[] = [];
  for (const s of spec.stories) {
    const was = lock[storyKey(s)];
    const status = !rulesOf(spec, s).length ? "story has no rules" : !was ? "new story" : was[0] !== proseFingerprint(s.prose) ? "story changed" : undefined;
    if (status) out.push({ where: `${spec.file}:${s.line}  ${s.title}`, story: s, status, lines: rulesOf(spec, s).map((r) => r.key.slice(s.title.length + 3)) });
  }
  for (const rule of spec.rules) {
    const [prose, code] = fingerprint(rule);
    const deps = dependencies(spec, rule, specs);
    const was = lock[rule.key];
    const prosed = was && was[0] !== prose;
    const relied = was && was[2] !== dependencyFingerprint(deps);
    const modelled = was && (was[1] !== code || relied);
    const status = !rule.code.trim() ? "not formalized" : !was ? "new"
      : prosed && modelled ? "prose and model both changed" : prosed ? "prose changed" : modelled ? "model changed" : undefined;
    let note: string | undefined;
    if (status && relied) {
      // Name the rules it relies on whose own Quint is not what was recorded for them.
      const changed = deps.filter((d) => readLock(root, d.spec, locks)[d.rule.key]?.[1] !== fingerprint(d.rule)[1]);
      note = changed.length ? ` through ${changed.map((d) => `${[...d.names].join(", ")} (${d.spec === spec ? "" : `${d.spec.file}: `}${d.rule.key})`).join("; ")}`
        : was[1] === code ? (was.length < 3 ? " (what it relies on was not recorded before)" : " through a definition it relies on") : undefined;
    }
    if (status) out.push({ where: `${spec.file}:${rule.line}  ${rule.key}`, rule, status, note });
  }
  for (const key of Object.keys(lock))
    if (!spec.rules.some((r) => r.key === key) && !spec.stories.some((s) => storyKey(s) === key)) out.push({ where: `${spec.file}  ${key}`, status: "removed or renamed" });
  return out;
}

/** Record every story and rule of a spec as reconciled. */
export function acceptReviews(root: string, spec: Spec, specs: Spec[] = readSpecs(root)) {
  // One story or rule per line, in the order of the spec, so a diff of the ledger shows exactly what was re-reviewed.
  const entries = [
    ...spec.stories.map((s) => ({ line: s.line, key: storyKey(s), value: [proseFingerprint(s.prose)] })),
    ...spec.rules.map((r) => {
      const deps = dependencyFingerprint(dependencies(spec, r, specs));
      return { line: r.line, key: r.key, value: deps ? [...fingerprint(r), deps] : fingerprint(r) };
    }),
  ].sort((a, b) => a.line - b.line);
  fs.writeFileSync(lockFile(root, spec), `{\n${entries.map((e) => `  ${JSON.stringify(e.key)}: ${JSON.stringify(e.value)}`).join(",\n")}\n}\n`);
}

// --- the contracts of hand-written verified code ------------------------------------

const contractsFile = (root: string) => path.join(root, "spec/src.lock.json");
/**
 * The contract of a file: every `//@` comment line, under the declarations it sits in (`f: //@ requires …`), so that
 * moving an annotation from one function to another changes it. Keep every line containing `//@`, including an
 * annotation after code on the same line; source validation rejects occurrences in strings or block comments.
 */
function contractOf(file: string, code: string): string[] {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const named = (n: ts.Node): string | undefined =>
    // A local variable is not a declaration a contract is about; a constant of the file is.
    ts.isVariableStatement(n) ? (ts.isSourceFile(n.parent) ? n.declarationList.declarations.map((d) => d.name.getText(sf)).join(", ") : undefined)
    : (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)
      || ts.isPropertyDeclaration(n) || ts.isPropertySignature(n)) && n.name ? n.name.getText(sf) : undefined;
  /** The names of the declarations around a position, outermost first; a comment belongs to the declaration it leads. */
  const owners = (at: number): string[] => {
    const chain: string[] = [];
    for (let n: ts.Node | undefined = sf; n; ) {
      const inner: ts.Node | undefined = n.getChildren(sf).find((c) => c.getFullStart() <= at && at < c.getEnd());
      const name = inner && named(inner);
      if (name) chain.push(name);
      n = inner;
    }
    return chain;
  };
  const out: string[] = [];
  let at = 0;
  for (const line of code.split("\n")) {
    const text = line.trim();
    if (line.includes("//@")) {
      const owner = owners(at + line.indexOf("//@")).join(".");
      out.push(owner ? `${owner}: ${text}` : text);
    }
    at += line.length + 1;
  }
  return out;
}
/** The contract of every proved src file, under its path. */
export const contracts = (root: string, src = readSrc(root)) => new Map(src.filter((u) => u.ts).map((u) => [`src/${u.file.split(path.sep).join("/")}`, contractOf(u.file, u.code)]));

/** The `//@` contracts in src/ that are new, changed or gone since `accept`. A file that loses every `//@` is gone. */
export function pendingContracts(root: string, src = readSrc(root)): Pending[] {
  const lock: Record<string, string> = fs.existsSync(contractsFile(root)) ? JSON.parse(fs.readFileSync(contractsFile(root), "utf8")) : {};
  const now = contracts(root, src);
  const out: Pending[] = [];
  for (const [file, lines] of now) {
    const status = !(file in lock) ? "new contract" : lock[file] !== short(lines.join("\n")) ? "contract changed" : undefined;
    if (status) out.push({ where: file, status, lines });
  }
  for (const file of Object.keys(lock)) if (!now.has(file)) out.push({ where: file, status: "contract removed" });
  return out;
}

/** Record the `//@` contract of every proved src file as reconciled. */
export function acceptContracts(root: string, src = readSrc(root)) {
  const lines = [...contracts(root, src)].map(([file, c]) => `  ${JSON.stringify(file)}: ${JSON.stringify(short(c.join("\n")))}`);
  if (lines.length) fs.writeFileSync(contractsFile(root), `{\n${lines.join(",\n")}\n}\n`);
  else fs.rmSync(contractsFile(root), { force: true });
}

/**
 * Both halves of every rule that has moved, the text and rules of every story that has, and the lines of every new or
 * changed contract, so that whoever reconciles them compares rather than guesses.
 */
export const moved = (todo: Pending[]): string[] => todo.flatMap(({ where, rule, story, lines, status, note }) =>
  rule && (status === "new" || status.includes("changed")) ? [`    "${rule.key}" (${status}${note ?? ""})\n      its prose:\n${indent(rule.prose.trim() || "(only the heading)", 8)}\n      its Quint:\n${indent(rule.code.trim(), 8)}`]
  : story && status !== "story has no rules" ? [`    "${story.title}" (${status})\n      its text:\n${indent(story.prose.trim() || "(only the heading)", 8)}\n      its rules:\n${indent((lines ?? []).join("\n"), 8)}`]
  : !story && lines ? [`    ${where} (${status})\n      its //@ lines:\n${indent(lines.join("\n"), 8)}`]
  : []);



export interface Accepted { text: string; unproved: string[] }
export const ledgerFile = (root: string) => path.join(root, "spec/unproved.lock.json");
export function readLedger(root: string): Record<string, Accepted | undefined> {
  if (!fs.existsSync(ledgerFile(root))) return {};
  const raw: Record<string, unknown> = JSON.parse(fs.readFileSync(ledgerFile(root), "utf8"));
  // An entry without a fingerprint was accepted before acceptance named what it was for.
  return Object.fromEntries(Object.entries(raw).map(([unit, v]) => [unit, Array.isArray(v) ? { text: "", unproved: v } : (v as Accepted)]));
}
export function writeLedger(root: string, ledger: Record<string, Accepted>) {
  // One obligation per line, so a diff of the ledger shows exactly what was accepted.
  const lines = Object.entries(ledger).map(([unit, { text, unproved }]) =>
    `  ${JSON.stringify(unit)}: {\n    "text": ${JSON.stringify(text)},\n    "unproved": [\n${unproved.map((u) => `      ${JSON.stringify(u)}`).join(",\n")}\n    ]\n  }`);
  if (lines.length) fs.writeFileSync(ledgerFile(root), `{\n${lines.join(",\n")}\n}\n`);
  else fs.rmSync(ledgerFile(root), { force: true });
}
