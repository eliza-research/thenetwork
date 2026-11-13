// The proof stage for one unit: LemmaScript turns the unit's TypeScript into
// Dafny, the tools add what they generate and what the unit's proof file
// supplies, LemmaScript checks that nothing generated was changed and runs
// Dafny, and `dafny audit` checks that nothing added is trusted rather than
// proved.
//
// Counting is per obligation. Dafny runs with every assertion isolated and no
// error limit, and because a postcondition that fails is still assumed while
// the ones after it are checked, every postcondition of a lemma that has a
// failure is checked again on its own. A lemma that calls a lemma with a
// failing postcondition assumes it, so every obligation of such a lemma is
// counted as not proved too.

import fs from "node:fs";
import path from "node:path";
import { SENDER } from "./gen/classify.ts";
import { run } from "./run.ts";
export { exec, run } from "./run.ts";

/** The library of general lemmas that proof files call as ProofLib.<Name>. */
export const LIB_FILE = path.join(import.meta.dirname, "proof", "lib.dfy");
/** The one name the library adds to a unit. */
const LIB_MODULE = "ProofLib";
/**
 * How Dafny is run. Isolation and no error limit: no failure hides another. A
 * resource limit, not a time limit: the same answer on any machine. The time
 * limit only stops a run that would never end. Source lines are not echoed: a
 * proof file's text must never be read back as one of Dafny's own messages.
 */
const RESOURCE_LIMIT = 30_000_000;
const DAFNY_FLAGS = ["--isolate-assertions", "--error-limit", "0", "--resource-limit", String(RESOURCE_LIMIT), "--show-snippets:false"];
const TIME_LIMIT = 600;
/** Flags for every Dafny command on a unit's file. */
const dafnyFlags = (dfy: string) => [...(dfy.includes("Std.") ? ["--standard-libraries"] : []), "--unicode-char:true"];
/** The last lines of a tool's output, on one line. */
const lastLines = (out: string) => out.trim().split("\n").slice(-3).join(" / ");

// --- proof files ---------------------------------------------------------------

/**
 * Words a proof file may not use. Each declares something other than a lemma,
 * asks Dafny to trust or skip something, or reaches outside the unit.
 */
const FORBIDDEN = new Set(`
  assume expect include import module abstract refines extern function predicate method constructor datatype
  codatatype type newtype const class trait iterator opaque ghost twostate least greatest static export provides
  reveals print modify modifies reads axiom verify colemma inductive
`.split(/\s+/).filter(Boolean));
const ATTRIBUTES = new Set(["trigger", "induction"]);

const STRING = /"(?:[^"\\\n]|\\.)*"/y;
const ATTR = /\{\s*:\s*([A-Za-z_]\w*)?/y;
const WORD = /[A-Za-z_][\w'?]*/y;
const BREAK = /[\r\v\f\u0085\u2028\u2029]/;
const sticky = (re: RegExp, text: string, at: number) => { re.lastIndex = at; return re.exec(text); };

interface Token { t: string; kind: "word" | "open" | "attr" | "close" | "other"; at: number; end: number; line: number }

/**
 * Dafny's tokens, as far as they matter here: comments and whitespace dropped,
 * strings kept whole, `{:` attributes told apart from braces. With `refuse`,
 * anything a proof file may not contain is refused where it appears.
 */
function tokenize(text: string, refuse?: (line: number, why: string) => never): Token[] {
  const out: Token[] = [];
  let line = 1;
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (refuse && BREAK.test(ch)) refuse(line, "line breaks other than \\n are not allowed");
    if (ch === "\n") { line++; i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    if (text.startsWith("//", i)) {
      const e = text.indexOf("\n", i);
      const stop = e < 0 ? text.length : e;
      if (refuse && BREAK.test(text.slice(i, stop))) refuse(line, "line breaks other than \\n are not allowed");
      i = stop;
      continue;
    }
    let kind: Token["kind"] = "other";
    let t = ch;
    if (ch === '"') {
      const m = sticky(STRING, text, i);
      if (m) t = m[0];
      else if (refuse) refuse(line, "a string is not closed on its line");
    } else {
      if (refuse) {
        if (text.startsWith("/*", i)) refuse(line, "block comments are not allowed; use //");
        if (ch === "@") refuse(line, "`@` is not allowed: attributes and verbatim strings could change what is checked");
        if (ch === "'") refuse(line, "character literals are not allowed");
        if (/[^\x20-\x7e]/.test(ch)) refuse(line, "outside comments and strings only ASCII is allowed");
      }
      const attr = ch === "{" && sticky(ATTR, text, i);
      const word = !attr && sticky(WORD, text, i);
      if (attr) {
        if (refuse && !ATTRIBUTES.has(attr[1] ?? "")) refuse(line, `the attribute {:${attr[1] ?? ""}} is not allowed; only ${[...ATTRIBUTES].map((a) => `{:${a}}`).join(" and ")}`);
        [kind, t] = ["attr", attr[0]];
      } else if (ch === "{") kind = "open";
      else if (ch === "}") kind = "close";
      else if (word) {
        if (refuse && FORBIDDEN.has(word[0])) refuse(line, `\`${word[0]}\` is not allowed in a proof file`);
        [kind, t] = ["word", word[0]];
      }
    }
    out.push({ t, kind, at: i, end: i + t.length, line });
    i += t.length;
  }
  return out;
}

/** One lemma of a proof file. */
interface Lemma { name: string; line: number; header: string; headerText: string; body: string; text: string }

/**
 * Words after which a brace starts an operand, such as the set display in `decreases {0}` or `x in {1}`, never a
 * body. A brace starts a lemma's body only after a token that can end a header: `)`, `]`, `}`, the `|` that closes
 * `|xs|`, a number, a string or any other word. Where that still reads an operand as a body (`| {x}` in a
 * comprehension), the lemma really has none, and Dafny's warning about it fails the unit.
 */
const OPERAND_AFTER = new Set("in requires ensures decreases then else returns by set iset multiset seq map imap calc assert var if match case forall exists old fresh reveal lemma".split(" "));
const endsHeader = (t: Token | undefined) => !!t && (t.kind === "close" || /^[)\]|0-9"]/.test(t.t) || (t.kind === "word" && !OPERAND_AFTER.has(t.t)));

/**
 * A proof file holds only `lemma` declarations, each with a body, and `//`
 * comments. Anything else is refused with the file and line. A lemma runs to
 * the next `lemma`; its body is the brace group it ends with, which must follow
 * a complete header.
 */
export function parseProofFile(source: string, file: string): Lemma[] {
  const text = source.replace(/\r\n/g, "\n");
  const refuse = (line: number, why: string): never => { throw new Error(`${file}:${line}: ${why}`); };
  if (text.includes("\0")) refuse(text.slice(0, text.indexOf("\0")).split("\n").length, "NUL characters are not allowed");
  const toks = tokenize(text, refuse);
  const lemmas: Lemma[] = [];
  for (let p = 0; p < toks.length; ) {
    const start = toks[p];
    if (start.kind === "close") refuse(start.line, "unbalanced braces: this } closes nothing");
    if (start.t !== "lemma") refuse(start.line, `only \`lemma\` declarations and // comments may appear at the top level, not \`${start.t}\``);
    let q = p + 1;
    // Attributes may come before the name.
    for (let depth = 0; toks[q] && (toks[q].kind === "attr" || depth > 0); q++) {
      if (toks[q].kind === "attr" || toks[q].kind === "open") depth++;
      else if (toks[q].kind === "close") depth--;
    }
    const name = toks[q]?.kind === "word" ? toks[q].t : refuse(start.line, "a lemma needs a name");
    // Where the last brace group at the top level of the lemma opens; any other token at the top level resets it.
    let open = -1;
    let end = q + 1;
    let depth = 0;
    for (; end < toks.length && toks[end].t !== "lemma"; end++) {
      const k = toks[end];
      if (k.kind === "open" || k.kind === "attr") { if (depth++ === 0) open = k.kind === "open" ? end : -1; }
      else if (k.kind === "close") { if (--depth < 0) refuse(k.line, "unbalanced braces: this } closes nothing"); }
      else if (depth === 0) open = -1;
    }
    if (depth > 0) refuse(start.line, `lemma ${name}: unbalanced braces, its body is never closed`);
    if (open < 0 || !endsHeader(toks[open - 1])) refuse(start.line, `lemma ${name} has no body; every lemma must be proved, and end with its body`);
    if (lemmas.some((l) => l.name === name)) refuse(start.line, `lemma ${name} is declared twice`);
    const close = end - 1;
    lemmas.push({
      name, line: start.line,
      header: toks.slice(p, open).map((t) => t.t).join(" "),
      headerText: text.slice(start.at, toks[open].at).replace(/\s+/g, " ").trim(),
      body: text.slice(toks[open].end, toks[close].at),
      text: text.slice(start.at, toks[close].end),
    });
    p = end;
  }
  return lemmas;
}

/** Each dotted name a Dafny text uses, such as `Std.Collections.Seq.All`, from its first word; comments and strings are not names. */
function dottedNames(toks: Token[]): { name: string; first: Token; inner: boolean }[] {
  const out: { name: string; first: Token; inner: boolean }[] = [];
  for (let i = 0; i < toks.length; i++) {
    const inner = toks[i - 1]?.t === ".";
    if (toks[i].kind !== "word" || (inner && toks[i - 2]?.kind === "word")) continue;
    const parts = [toks[i].t];
    for (let j = i; toks[j + 1]?.t === "." && toks[j + 2]?.kind === "word"; j += 2) parts.push(toks[j + 2].t);
    out.push({ name: parts.join("."), first: toks[i], inner });
  }
  return out;
}

/**
 * A proof file may reach Dafny's standard library only by a name the generated
 * code itself uses, since the library holds axioms, and the library of the
 * tools only by the lemmas and functions it declares.
 */
function checkNames(proof: { file: string; text: string }, gen: string, lib: string | undefined) {
  const used = new Set(dottedNames(tokenize(gen)).map((d) => d.name));
  const std = [...used].filter((n) => n.startsWith("Std."));
  const own = new Set([...(lib ?? "").matchAll(/^\s*(?:ghost\s+)?(?:lemma|function|predicate)\s+(\w+)/gm)].map((m) => m[1]));
  for (const d of dottedNames(tokenize(proof.text.replace(/\r\n/g, "\n")))) {
    const parts = d.name.split(".");
    const at = `${proof.file}:${d.first.line}`;
    const misplaced = parts.find((p, i) => (i > 0 || d.inner) && (p === "Std" || p === LIB_MODULE));
    if (misplaced) throw new Error(`${at}: \`${misplaced}\` may only begin a name`);
    if (parts[0] === "Std" && !used.has(d.name))
      throw new Error(`${at}: \`${d.name}\` is not allowed: Dafny's standard library holds axioms, so a proof file may use only the names of it that the generated code uses${std.length ? ` (${std.join(", ")})` : ", and it uses none"}`);
    if (parts[0] === LIB_MODULE && !(parts.length === 2 && own.has(parts[1])))
      throw new Error(`${at}: \`${d.name}\` is not a lemma or function of tools/proof/lib.dfy; call those as ${LIB_MODULE}.<Name>`);
  }
}

const DECLARATION = /^\s*(?:ghost\s+)?(?:function|predicate|lemma|method|datatype|codatatype|type|newtype|const|class|trait|module)\s+(?:\{:[^}]*\}\s*)*([A-Za-z_][\w']*)/;

/** Every name a Dafny text declares at the top level, constructors of its datatypes included. */
function declaredNames(dfy: string): Set<string> {
  const names = new Set<string>();
  for (const line of dfy.split("\n")) {
    if (/^\s/.test(line)) continue; // inside a declaration or a module
    const m = line.match(DECLARATION);
    if (m) names.add(m[1]);
    const data = line.match(/^(?:co)?datatype\s+\w+(?:<[^>]*>)?\s*=(.*)$/);
    if (data) for (const c of data[1].matchAll(/(?:^|\|)\s*([A-Za-z_][\w']*)/g)) names.add(c[1]);
  }
  return names;
}

/** The generated `<fn>_ensures` lemmas with an empty body: where each one's header ends, and its tokens. */
function emptyLemmas(gen: string): Map<string, { bodyAt: number; header: string; headerText: string }> {
  const found = new Map<string, { bodyAt: number; header: string; headerText: string }>();
  for (const m of gen.matchAll(/^lemma (\w+_ensures)\([^\n]*\n(?:(?!\{\n)[^\n]*\n)*?(?=\{\n\}\n)/gm))
    found.set(m[1], { bodyAt: m.index + m[0].length, header: tokenize(m[0]).map((t) => t.t).join(" "), headerText: m[0].replace(/\s+/g, " ").trim() });
  return found;
}

interface Additions {
  /** The unit's proof file, if it has one: where it is, and its text. */
  proof?: { file: string; text: string };
  /** The body the tools give `step_ensures` when the proof file does not. */
  stepBody?: string;
  /** Lemmas the tools add: laws of dependencies proved in their own units. */
  axioms: string[];
  /** The library, added when there is a proof file. */
  lib?: string;
}

/**
 * A definition of the final Dafny, as the tools placed it: one generated by
 * LemmaScript (with any body the proof file supplied), or one added after the
 * generated text (a law of a dependency, a helper, the library).
 */
export interface Region { def: string; generated: boolean }
/** The final Dafny, and for each of its lines (line n at index n - 1) the definition it belongs to. */
export interface Spliced { dfy: string; regions: Region[] }

/** A line of generated Dafny that starts a definition, and its name. */
const DEFINITION = /^\s*(?:ghost\s+)?(?:lemma|method|function|predicate)\s+(?:\{:[^}]*\}\s*)*(\w+)/;

/**
 * The final Dafny for a unit: what LemmaScript generated, with the bodies the
 * proof file supplies inside the empty generated lemmas, and after it the
 * tools' lemmas, the proof file's helpers and the library. Only lines are
 * added; nothing generated changes. Each line is recorded with the definition
 * it belongs to, so that a failure is charged to where it really is.
 */
export function splice(gen: string, { proof, stepBody, axioms, lib }: Additions, where = "gen/proof/<unit>/<unit>.dfy"): Spliced {
  const lemmas = proof ? parseProofFile(proof.text, proof.file) : [];
  const empty = emptyLemmas(gen);
  const bodies = new Map<string, string>();
  const helpers: Lemma[] = [];
  const taken = declaredNames([gen, ...axioms].join("\n"));
  taken.add(LIB_MODULE);
  for (const l of lemmas) {
    const generated = empty.get(l.name);
    if (generated) {
      if (generated.header !== l.header)
        throw new Error(`${proof!.file}:${l.line}: lemma ${l.name} does not repeat its generated header, so it is refused as stale; copy the header again from ${where}\n  generated: ${generated.headerText}\n  yours:     ${l.headerText}`);
      bodies.set(l.name, l.body.replace(/^[ \t]*\n/, "").trimEnd());
    } else if (taken.has(l.name)) {
      throw new Error(`${proof!.file}:${l.line}: lemma ${l.name}: the name is already declared in ${where}; a helper needs a name of its own`);
    } else helpers.push(l);
  }
  if (proof) checkNames(proof, gen, lib);
  if (stepBody && empty.has("step_ensures") && !bodies.has("step_ensures")) bodies.set("step_ensures", stepBody);
  const lines: string[] = [];
  const regions: Region[] = [];
  const add = (text: string, region: Region) => { for (const l of text.split("\n")) { lines.push(l); regions.push(region); } };
  // The line of each empty generated lemma's `{`, after which its body goes.
  const opens = new Map([...empty].map(([name, { bodyAt }]) => [gen.slice(0, bodyAt).split("\n").length - 1, name]));
  let region: Region = { def: "?", generated: false };
  gen.split("\n").forEach((line, i) => {
    const m = line.match(DEFINITION);
    if (m) region = { def: m[1], generated: true };
    add(line, region);
    const body = bodies.get(opens.get(i) ?? "");
    if (body) add(body, region);
  });
  const tail: [string, Region][] = [
    ...axioms.map((a, i): [string, Region] => [`${i ? "" : "// ---- laws of the units this one imports, each proved in its own unit (added by the tools) ----\n\n"}${a}`, { def: a.match(/^lemma \{:axiom\} (\w+)/)![1], generated: false }]),
    ...helpers.map((h, i): [string, Region] => [`${i ? "" : `// ---- helpers from ${proof!.file} ----\n\n`}${h.text}`, { def: h.name, generated: false }]),
    ...(lib ? [[`// ---- tools/proof/lib.dfy ----\n\n${lib.trimEnd()}`, { def: LIB_MODULE, generated: false }] as [string, Region]] : []),
  ];
  if (tail.length) {
    while (lines.length && !lines.at(-1)!.trim()) { lines.pop(); regions.pop(); }
    lines[lines.length - 1] = lines.at(-1)!.trimEnd();
    for (const [text, r] of tail) add(`\n${text}`, r);
    add("", region);
  }
  return { dfy: lines.join("\n"), regions };
}

/** The lemma that makes a dependency's law usable here: `<fn>` is how this unit spells the law. */
function lawAxiom(gen: string, fn: string): string | undefined {
  const m = gen.match(new RegExp(`^function ${fn}\\(([^\\n]*)\\): bool\\n\\{`, "m"));
  if (!m) return undefined;
  const args = [...m[1].matchAll(/(?:^|,\s*)(\w+)\s*:/g)].map((a) => a[1]);
  return `lemma {:axiom} ${fn}_ensures(${m[1]})\n  ensures ${fn}(${args.join(", ")}) == true`;
}

// --- reading what Dafny said -----------------------------------------------------

interface Verdict { unproved: Map<string, string>; exhausted: Set<string>; errors: Set<string>; failing: Map<string, Set<number>> }

/** Dafny's closing line: how many it verified, and how many failures of each kind it reported. */
const SUMMARY = /^Dafny program verifier finished with \d+ verified, (\d+) errors?((?:, \d+ [a-z ]+)*)$/gm;
const FINISHED = new RegExp(SUMMARY.source, "m");
const finished = (out: string) => FINISHED.test(out);

/**
 * Sort Dafny's messages about `file` into obligations not proved (keyed by
 * definition and clause), obligations it ran out of resources on, and errors.
 * A message counts only at the start of a line and with the bare file name
 * (Dafny runs in the unit's directory, without echoing source lines); a
 * postcondition is taken only from the error's own block and definition. A
 * failure anywhere but in a generated definition (a helper, the library, a
 * lemma the tools add) is an error: the proof itself is broken. So is a count
 * of failures that differs from the one Dafny reports.
 */
export function readVerdict(out: string, dfy: string, file: string, regions: Region[], rename = (n: string) => n): Verdict {
  const lines = out.split("\n");
  const source = dfy.split("\n");
  const own = `${file}(`;
  const pattern = /^\((\d+),\d+\): (Error|Warning|Related location): (.*)$/;
  const messages = lines.map((l) => {
    const m = l.startsWith(own) ? l.slice(file.length).match(pattern) : null;
    return m ? { line: Number(m[1]), kind: m[2], what: m[3] } : undefined;
  });
  const defAt = (line: number) => regions[line - 1]?.def ?? "?";
  const clause = (line: number) => (source[line - 1] ?? "").trim().replace(/^ensures\s+/, "");
  const v: Verdict = { unproved: new Map(), exhausted: new Set(), errors: new Set(), failing: new Map() };
  const fail = (line: number, text: string, exhausted: boolean) => {
    const r = regions[line - 1];
    if (!r?.generated) { v.errors.add(`${r?.def ?? "?"} (${file}:${line}) does not verify: ${text}; a lemma that is not generated must prove`); return; }
    const def = rename(r.def);
    const k = `${def.replace(/_ensures$/, "")}: ${text}`;
    v.unproved.set(k, def);
    if (exhausted) v.exhausted.add(k);
    if (!v.failing.has(def)) v.failing.set(def, new Set());
    v.failing.get(def)!.add(line);
  };
  let read = 0;
  lines.forEach((l, i) => {
    const m = messages[i];
    if (!m) {
      if (!l.startsWith(own) && /^Error:|: Error:/.test(l)) v.errors.add(l.trim());
      return;
    }
    if (m.kind === "Error") read++;
    if (m.kind === "Error" && m.what.startsWith("a postcondition could not be proved")) {
      const block: { line: number; what: string }[] = [];
      for (let j = i + 1; messages[j]?.kind === "Related location"; j++) block.push(messages[j]!);
      const related = block.find((r) => r.what.includes("postcondition") && regions[r.line - 1] && regions[r.line - 1] === regions[m.line - 1]);
      if (related) fail(related.line, clause(related.line), false);
      else v.errors.add(`${defAt(m.line)}: ${m.what}, and Dafny named no postcondition of it: ${clause(m.line)}`);
    } else if (m.kind === "Error" && /out of resource|timed out/.test(m.what)) {
      const text = source[m.line - 1]?.trim() ?? "";
      fail(m.line, text.startsWith("ensures") ? clause(m.line) : "the prover ran out of resources", true);
    } else if (m.kind === "Error") v.errors.add(`${defAt(m.line)}: ${m.what}: ${clause(m.line)}`);
    else if (m.kind === "Warning") v.errors.add(`${defAt(m.line)}: ${m.what}`);
  });
  const reported = [...out.matchAll(SUMMARY)].reduce((n, s) => n + Number(s[1]) + [...s[2].matchAll(/\d+/g)].reduce((a, x) => a + Number(x[0]), 0), 0);
  if (finished(out) && reported !== read) v.errors.add(`Dafny reported ${reported} failures, but ${read} were read from its output`);
  return v;
}

const verifyArgs = (dfy: string) => ["verify", ...dafnyFlags(dfy), ...DAFNY_FLAGS, "--verification-time-limit", String(TIME_LIMIT)];

/**
 * A postcondition that fails is assumed while the later ones of the same
 * definition are checked, so those may pass only because of it. Check each of
 * them again in a copy of the definition that has it as its only postcondition.
 */
async function recheck(dir: string, { dfy, regions }: Spliced, file: string, failing: Map<string, Set<number>>): Promise<{ verdict: Verdict; log: string } | undefined> {
  const lines = dfy.split("\n");
  let prefix = "isolated";
  while (dfy.includes(prefix)) prefix = `x${prefix}`;
  const copies: [string, Region][] = [];
  const copyOf = new Map<string, string>();
  for (const [def, failed] of failing) {
    const declares = new RegExp(`^(lemma|method) ${def}\\b`);
    const start = lines.findIndex((l, i) => regions[i].generated && declares.test(l));
    const open = lines.findIndex((l, i) => i > start && l === "{");
    if (start < 0 || open < 0) continue;
    const ensures = lines.slice(start + 1, open).map((l, i) => [l, start + 2 + i] as const).filter(([l]) => /^\s*ensures\b/.test(l));
    if (ensures.length < 2) continue;
    const body = tokenize(lines.slice(open).join("\n"));
    let depth = 0;
    const close = body.find((t) => (t.kind === "open" || t.kind === "attr" ? (depth++, false) : t.kind === "close" ? --depth === 0 : false));
    if (!close) continue;
    const bodyText = lines.slice(open).join("\n").slice(0, close.end);
    for (const [, line] of ensures) {
      if (failed.has(line)) continue;
      const name = `${prefix}${copies.length}_${def}`;
      copyOf.set(name, def);
      const header = lines.slice(start, open).filter((l, i) => !/^\s*ensures\b/.test(l) || start + 1 + i === line);
      copies.push([[header[0].replace(new RegExp(`\\b${def}\\b`), name), ...header.slice(1), bodyText].join("\n"), { def: name, generated: true }]);
    }
  }
  if (!copies.length) return undefined;
  const derived: string[] = dfy.trimEnd().split("\n");
  const derivedRegions = regions.slice(0, derived.length);
  for (const [text, r] of copies) for (const l of `\n${text}`.split("\n")) { derived.push(l); derivedRegions.push(r); }
  const name = file.replace(/\.dfy$/, ".isolated.dfy");
  const text = `${derived.join("\n")}\n`;
  fs.writeFileSync(path.join(dir, name), text);
  const { out } = await run("dafny", [...verifyArgs(text), "--filter-symbol", prefix, name], dir);
  const verdict = readVerdict(out, text, name, derivedRegions, (n) => copyOf.get(n) ?? n);
  if (!finished(out)) verdict.errors.add(`the postconditions checked one by one gave no verdict: ${lastLines(out)}`);
  return { verdict, log: out };
}

/**
 * The definitions that rest on an obligation not proved: a lemma assumes every
 * postcondition of each lemma it calls, so one that calls a lemma with a failing
 * postcondition, or a lemma that does, proves nothing more than that one does.
 * Calls are read conservatively, as any mention of the name. Returns, for each
 * such definition, one obligation it rests on.
 */
function restingOn({ dfy, regions }: Spliced, unproved: Map<string, string>): Map<string, string> {
  const texts = new Map<Region, string[]>();
  dfy.split("\n").forEach((l, i) => { const t = texts.get(regions[i]); if (t) t.push(l); else texts.set(regions[i], [l]); });
  // What each definition mentions besides its own declaration; a second mention of its own name is a call to itself.
  const mentions = new Map<string, string[]>();
  for (const [r, t] of texts) {
    const words = tokenize(t.join("\n")).filter((k) => k.kind === "word").map((k) => k.t);
    if (words.includes(r.def)) words.splice(words.indexOf(r.def), 1);
    mentions.set(r.def, [...(mentions.get(r.def) ?? []), ...words]);
  }
  const failing = new Map<string, string>();
  for (const [k, def] of unproved) if (!failing.has(def)) failing.set(def, k);
  const rests = new Map<string, string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [def, words] of mentions) {
      if (rests.has(def)) continue;
      const callee = words.find((w) => failing.has(w) || rests.has(w));
      if (callee) { rests.set(def, failing.get(callee) ?? rests.get(callee)!); changed = true; }
    }
  }
  return rests;
}

/** Findings of `dafny audit` in the unit's own file, other than the lemmas the tools add on purpose. */
async function audit(dir: string, dfy: string, file: string, allowed: Set<string>): Promise<{ findings: string[]; log: string }> {
  // LemmaScript may regenerate the original while checking it, so audit a copy of the exact proof we supplied.
  const copy = file.replace(/\.dfy$/, ".audit.dfy");
  fs.writeFileSync(path.join(dir, copy), dfy);
  const result = await run("dafny", ["audit", ...dafnyFlags(dfy), copy], dir);
  const out = result.out.split(copy).join(file);
  const findings = out.split("\n").filter((l) => l.startsWith(`${file}(`) && /: (Warning|Error): /.test(l))
    .filter((l) => !/: Warning: (\w+): Declaration has explicit `\{:axiom\}` attribute/.test(l) || !allowed.has(l.match(/: Warning: (\w+):/)![1]));
  if (!/Dafny auditor completed/.test(out)) findings.push(`dafny audit gave no verdict: ${lastLines(out)}`);
  else if (!result.ok && !findings.length) findings.push(`dafny audit failed: ${lastLines(out)}`);
  return { findings: findings.map((f) => `dafny audit: ${f}`), log: out };
}

// --- one unit --------------------------------------------------------------------

export interface Proof {
  /** The unit's obligations: the `ensures` of its generated Dafny. */
  total: number;
  /** Obligations not proved, as `<definition>: <clause>`. */
  unproved: string[];
  /** Of those, the ones the prover ran out of resources on. */
  exhausted: string[];
  /** Of those, the ones whose proof calls, directly or not, a lemma with an obligation not proved: each with one such obligation. */
  resting: Record<string, string>;
  errors: string[];
  log: string;
  /** The final Dafny, as it was verified. */
  dfy: string;
}

export interface Unit {
  unit: string;
  text: string;
  /** Hand-written code under src/, whose obligations must be proved: nothing simulates them. */
  src: boolean;
  /** spec/<name>.proof.dfy or src/<path>.proof.dfy, relative to the project. */
  proofFile: string;
  /** Laws of the units this one imports, as this unit spells them, and the unit that proves each. */
  laws: { fn: string; law: string; from: string }[];
  /** The units whose assurance this one's rests on. */
  rests: string[];
  /** The generated code without comments naming the source rules. */
  meaning: string;
  /** The caller preconditions of hand-written code. */
  requires?: number;
  /** For a state machine: its transitions and the names of the parameters each takes after the state. */
  transitions?: { name: string; params: string[] }[];
}

/**
 * The body the tools give step_ensures: each event is covered by its
 * transition's own lemma. Constructors are read from the generated Event type,
 * which spells a name that is a Dafny keyword differently; undefined if the
 * generated text is not as expected.
 */
function stepBody(gen: string, transitions: { name: string; params: string[] }[]): string | undefined {
  const event = gen.match(/^datatype Event = (.*)$/m);
  const constructors = event ? event[1].split("|").map((c) => c.trim().match(/^(\w+)/)?.[1] ?? "") : [];
  if (constructors.length !== transitions.length) return undefined;
  // `by` is a Dafny keyword, so LemmaScript renames it; take its spelling from step_ensures itself.
  const sender = gen.match(/^lemma step_ensures\(current: \w+, event: Event, (\w+):/m)?.[1];
  const cases = transitions.map(({ name, params }, i) => {
    if (!new RegExp(`^lemma ${name}_ensures\\(`, "m").test(gen)) return undefined;
    // The event carries every parameter but `by` (who sent it), which step_ensures takes beside it (gen/typescript.ts).
    if (params.includes(SENDER) && !sender) return undefined;
    const bound = params.filter((p) => p !== SENDER).map((p) => `i_${p}`);
    const args = params.map((p) => (p === SENDER ? sender : `i_${p}`));
    return `    case ${constructors[i]}${bound.length ? `(${bound.join(", ")})` : ""} => ${name}_ensures(${["current", ...args].join(", ")});`;
  });
  return cases.every(Boolean) ? ["  match event {", ...cases, "  }"].join("\n") : undefined;
}

/** Prove one unit in a directory of its own, so that nothing left over from another run or project can vouch for it. */
export async function prove(root: string, u: Unit, offered: { proof?: { file: string; text: string }; lib?: string; laws: string[] }): Promise<Proof> {
  const dir = path.join(root, "gen/proof", u.unit.replace(/\.ts$/, ""));
  const base = u.unit.replace(/\.ts$/, "");
  const file = `${base}.dfy`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, u.unit), u.text);
  // A configuration of our own, so that one further up cannot redirect the proof or relax it, and a TypeScript
  // project of our own, so that the project's tsconfig.json cannot add files, globals or options to it.
  fs.writeFileSync(path.join(dir, "lemmascript.json"), JSON.stringify({ "unread-annotations": "error", "run-log": false }));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2023", lib: ["es2023"], module: "nodenext", strict: true, noEmit: true, allowImportingTsExtensions: true, types: [] },
    files: [u.unit],
  }));
  let total = 0;
  const result = (errors: string[], log: string, dfy = ""): Proof => ({ total, unproved: [], exhausted: [], resting: {}, errors, log, dfy });
  const generated = await run("lsc", ["gen", "--backend=dafny", u.unit], dir);
  const genFile = path.join(dir, `${file}.gen`);
  if (!generated.ok || !fs.existsSync(genFile)) return result([lastLines(generated.out) || "lsc generated nothing"], generated.out);
  const gen = fs.readFileSync(genFile, "utf8");
  // Every obligation is an `ensures` of what LemmaScript generated; the imported modules come without theirs.
  total = (gen.match(/^\s*ensures\b/gm) ?? []).length;
  // Laws proved elsewhere, and the library, are only of use to a proof file.
  const axioms = offered.proof ? offered.laws.flatMap((fn) => lawAxiom(gen, fn) ?? []) : [];
  const axiomNames = new Set(axioms.map((a) => a.match(/^lemma \{:axiom\} (\w+)/)![1]));
  let spliced: Spliced;
  try {
    spliced = splice(gen, { proof: offered.proof, lib: offered.proof && offered.lib, axioms, stepBody: u.transitions && stepBody(gen, u.transitions) }, `gen/proof/${base}/${file}`);
  } catch (e) {
    return result([(e as Error).message], generated.out);
  }
  const { dfy } = spliced;
  fs.writeFileSync(path.join(dir, file), dfy);
  // LemmaScript keeps this .dfy, refuses it unless it is its own fresh output plus added lines, and runs Dafny.
  const [audited, checked] = await Promise.all([
    audit(dir, dfy, file, axiomNames),
    run("lsc", ["check", "--backend=dafny", `--time-limit=${TIME_LIMIT}`, `--extra-flags=${DAFNY_FLAGS.join(" ")}`, u.unit], dir),
  ]);
  let log = `${generated.out}${checked.out}`;
  const v = readVerdict(checked.out, dfy, file, spliced.regions);
  // The verdict is Dafny's own summary; without it, or with anything left unexplained, the unit was not checked.
  if (!v.errors.size && (!finished(checked.out) || (!checked.ok && !v.unproved.size))) v.errors.add(lastLines(checked.out) || "lsc produced no verdict");
  if (!v.errors.size && v.failing.size) {
    const again = await recheck(dir, spliced, file, v.failing);
    if (again) {
      log += `\n---- each postcondition of a definition with a failure, checked on its own ----\n${again.log}`;
      for (const [k, def] of again.verdict.unproved) v.unproved.set(k, def);
      for (const k of again.verdict.exhausted) v.exhausted.add(k);
      for (const e of again.verdict.errors) v.errors.add(e);
    }
  }
  // Every obligation of a generated definition that rests on one not proved is not proved either.
  const resting: Record<string, string> = {};
  const lines = dfy.split("\n");
  for (const [def, on] of restingOn(spliced, v.unproved)) {
    const start = lines.findIndex((l, i) => spliced.regions[i].def === def && spliced.regions[i].generated);
    if (start < 0) continue;
    for (let i = start + 1; i < lines.length && lines[i] !== "{" && spliced.regions[i].def === def; i++) {
      const m = lines[i].match(/^\s*ensures\s+(.*)$/);
      const k = m && `${def.replace(/_ensures$/, "")}: ${m[1].trim()}`;
      if (k && !v.unproved.has(k)) { v.unproved.set(k, def); resting[k] = on; }
    }
  }
  const { findings, log: auditLog } = audited;
  log += `\n---- dafny audit ----\n${auditLog}`;
  for (const f of findings) v.errors.add(f);
  return { total, unproved: [...v.unproved.keys()], exhausted: [...v.exhausted], resting, errors: [...v.errors], log, dfy };
}
