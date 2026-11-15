import fs from "node:fs";
import path from "node:path";
import { LIST_HELPERS } from "./gen.ts";
import { plainText } from "./util.ts";

/** `defs` are the rule's top-level definitions and types; `locals` the names it binds inside a definition (`val x = …` in a body). */
export interface Rule { key: string; story: string; line: number; prose: string; code: string; defs: string[]; locals: string[] }
/** A `##` heading: a story or another group of rules. Its prose is the text between the heading and its first rule. */
export interface Story { title: string; line: number; prose: string }
/**
 * One `import` of another spec: `import m.*` (star), `import m.x` (names), `import m as A` (alias), or `import m`,
 * whose names are reached only as `m::x`.
 */
export interface Import { module: string; alias?: string; star: boolean; names: string[] }
/**
 * `meaning` is the Quint as written, with every line of prose blank and every comment in the Quint reduced to a space:
 * what a cache key may depend on. `tangled` is `qnt` before the list helpers were expanded, to map Quint's columns back.
 */
export interface Spec { name: string; file: string; rules: Rule[]; stories: Story[]; imports: string[]; uses: Import[]; qnt: string; tangled: string; meaning: string }

/** Why a name cannot name a spec, or undefined if it can. */
export function badSpecName(name: string): string | undefined {
  if (!/^[a-z][A-Za-z0-9]*$/.test(name)) return `a spec's file name becomes a module name, so it must look like \`order.md\` or \`orderBook.md\``;
  // Their lock files would be the ledgers the tools keep beside the specs.
  if (name === "src" || name === "unproved") return `\`${name}\` cannot name a spec: spec/${name}.lock.json is a ledger the tools keep`;
}

/**
 * A spec is Markdown. `##` starts a story (or any grouping), `###` starts a
 * rule, and the ```quint blocks under a rule are its formal half. Tangling
 * keeps every line on its own line number, so Quint errors point into the
 * Markdown file. A fence of any other kind (``` or ~~~, of any length) is
 * prose, and closes only with a fence of the same character at least as long.
 */
export function parseSpec(root: string, file: string, text = fs.readFileSync(path.join(root, file), "utf8")): Spec {
  const name = path.basename(file, ".md");
  const bad = badSpecName(name);
  if (bad) throw new Error(`${file}: ${bad}`);
  const rules: Rule[] = [];
  const stories: Story[] = [];
  const qnt: string[] = [];
  const meaning: string[] = [];
  const imports: string[] = [];
  const uses: Import[] = [];
  let story: Story | undefined;
  let rule: Rule | undefined;
  let fence: { mark: string; quint: boolean } | undefined;
  // The Quint of the block in progress, to check that no comment or string runs on past its end.
  let block = "";
  // How deeply the Quint so far nests in brackets of any kind, carried from block to block.
  let depth = 0;
  /**
   * Record the definitions of a finished block. Quint lets a body open with `val x = …` and no brace, so a definition
   * at depth 0 counts as a local of the one above it when it is indented further than that one. A misread the other
   * way would hide a dependency from review; `gen` refuses one by comparing with the names Quint declares.
   */
  const declare = (text: string, r: Rule) => {
    const { code } = scan(text);
    let at = 0;
    let top: number | undefined;
    for (const line of text.split("\n")) {
      const indent = line.length - line.trimStart().length;
      const def = line.match(/^\s*(?:pure\s+)?(def|val|type)\s+(\w+)/);
      if (def && code[at + indent]) {
        // A type is never local.
        if (def[1] === "type" || (depth === 0 && (top === undefined || indent <= top))) { r.defs.push(def[2]); if (depth === 0) top = indent; }
        else r.locals.push(def[2]);
      }
      const dep = line.match(/^\s*import\s+(\w+)(?:\s*(\([^)]*\)))?(?:\s*\.\s*(\*|\w+)|\s+as\s+(\w+))?/);
      if (dep && code[at + indent]) {
        imports.push(dep[1]);
        // A form this does not recognise is read as `.*`, which can only add dependencies.
        const plain = /^\s*(?:from\b|$)/.test(line.slice(dep[0].length));
        uses.push({ module: dep[1], alias: dep[4], star: !plain || dep[3] === "*", names: dep[3] && dep[3] !== "*" ? [dep[3]] : [] });
      }
      for (let i = 0; i < line.length; i++) if (code[at + i]) depth += "([{".includes(line[i]) ? 1 : ")]}".includes(line[i]) ? -1 : 0;
      depth = Math.max(depth, 0);
      at += line.length + 1;
    }
  };
  // Quint and Markdown may not agree on where a line ends at an odd line break, and prose could then end a comment early.
  const source = plainText(file, text);
  source.split("\n").forEach((text, i) => {
    const marker = text.match(/^\s*(`{3,}|~{3,})(.*)$/);
    const closes = fence && marker && marker[1][0] === fence.mark[0] && marker[1].length >= fence.mark.length && !marker[2].trim();
    if (closes) {
      // Prose is tangled as `//` comments, which is only safe if no comment or string runs on into it from the code.
      const open = fence!.quint ? scan(block).mode : "";
      if (open) throw new Error(`${file}:${i + 1}: a ${open === '"' ? "string" : "comment"} is still open at the end of this quint block; close it inside the block`);
      if (fence!.quint) declare(block, rule!);
      fence = undefined;
      block = "";
    } else if (fence?.quint) {
      block += text + "\n";
      meaning.push(text);
      rule!.code += text + "\n";
      qnt.push(text);
      return;
    } else if (!fence && marker && (marker[1][0] === "~" || !marker[2].includes("`"))) {
      const quint = marker[2].trim().split(/\s+/)[0] === "quint";
      if (quint && !rule) throw new Error(`${file}:${i + 1}: a quint block must sit under a ### rule`);
      fence = { mark: marker[1], quint };
    } else if (!fence && text.startsWith("## ")) {
      story = { title: text.slice(3).trim(), line: i + 1, prose: "" };
      // The ledger records a story under its title, so a second one would share its entry.
      const twin = stories.find((s) => s.title === story!.title);
      if (twin) throw new Error(`${file}:${i + 1}: duplicate story "${story.title}" (also at line ${twin.line}); give each ## heading its own title`);
      stories.push(story);
      rule = undefined;
    } else if (!fence && text.startsWith("### ")) {
      rule = { key: `${story?.title ?? ""} / ${text.slice(4).trim()}`, story: story?.title ?? "", line: i + 1, prose: "", code: "", defs: [], locals: [] };
      if (rules.some((r) => r.key === rule!.key)) throw new Error(`${file}:${i + 1}: duplicate rule "${rule.key}"`);
      rules.push(rule);
    } else if (rule) rule.prose += text + "\n";
    else if (story) story.prose += text + "\n";
    qnt.push(i === 0 ? `module ${name} { // ${text}` : text ? `// ${text}` : "");
    meaning.push(i === 0 ? `module ${name} {` : "");
  });
  if (fence?.quint) {
    if (scan(block).mode) throw new Error(`${file}: a quint block is never closed, and a comment or string in it is still open`);
    declare(block, rule!);
  }
  const tangled = qnt.join("\n");
  try {
    return { name, file, rules, stories, imports, uses, qnt: expandListHelpers(tangled) + "\n}\n", tangled, meaning: codeOnly(meaning.join("\n")) };
  } catch (e) {
    throw new Error(`${file}:${(e as Error).message}`);
  }
}

/** Which characters of Quint are code, as opposed to part of a string or a comment, which are comments, and what is still open at the end. */
function scan(text: string): { code: boolean[]; comment: boolean[]; mode: "" | '"' | "//" | "/*" } {
  const code: boolean[] = [];
  const comment: boolean[] = [];
  let mode: "" | '"' | "//" | "/*" = "";
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (mode === "" && text[i] === '"') mode = '"';
    else if (mode === "" && two === "//") { comment[i] = comment[i + 1] = true; i++; mode = "//"; }
    else if (mode === "" && two === "/*") { comment[i] = comment[i + 1] = true; i++; mode = "/*"; }
    else if (mode === "") code[i] = true;
    else if (mode === '"' && text[i] === "\\") i++;
    else if (mode === '"' && text[i] === '"') mode = "";
    else if (mode === "//" && text[i] === "\n") mode = "";
    else if (mode === "//") comment[i] = true;
    else if (mode === "/*" && two === "*/") { comment[i] = comment[i + 1] = true; i++; mode = ""; }
    else if (mode === "/*") comment[i] = true;
  }
  return { code, comment, mode: mode === "//" ? "" : mode };
}

/**
 * Quint with every comment reduced to one space, line breaks kept: what it means, whatever the comments say. Strings are
 * kept whole, and a comment still separates the tokens around it.
 */
function codeOnly(text: string): string {
  const { comment } = scan(text);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (!comment[i] || text[i] === "\n") out += text[i];
    else if (!comment[i - 1] || text[i - 1] === "\n") out += " ";
  }
  return out;
}

/**
 * Rewrite `xs.every(x => e)`, `.some`, `.listMap` and `.includes(v)` into Quint's
 * built-in `foldl`, in place and without moving a line (see LIST_HELPERS in
 * gen.ts for why). Strings and comments are left alone.
 */
export function expandListHelpers(text: string): string {
  const { code } = scan(text);
  let count = 0;
  /** The line breaks of a piece of text that is dropped, so that no line moves. */
  const breaks = (s: string) => s.replace(/[^\n]/g, "");
  const expand = (from: number, to: number): string => {
    const call = /\.(every|some|includes|listMap)\(/g;
    let out = "";
    let at = from;
    call.lastIndex = from;
    for (let m; (m = call.exec(text)) && m.index < to; ) {
      if (!code[m.index]) continue;
      let end = call.lastIndex;
      for (let depth = 1; depth; end++) {
        if (end >= to) throw new Error(`${text.slice(0, m.index).split("\n").length}: no closing parenthesis for .${m[1]}(`);
        if (code[end] && text[end] === "(") depth++;
        else if (code[end] && text[end] === ")") depth--;
      }
      const arg = expand(call.lastIndex, end - 1);
      const n = count++;
      const acc = `std_${m[1]}_${n}`;
      const lambda = arg.match(/^(\s*\(?\s*(\w+)\s*\)?\s*=>)([\s\S]*)$/);
      const item = m[1] === "includes" || !lambda ? `std_x_${n}` : lambda[2];
      const body = m[1] === "includes" ? `${item} == (${arg})`
        : lambda ? breaks(lambda[1]) + lambda[3]
        : `${breaks(arg.match(/^\s*/)![0])}${arg.trim()}(${item})${breaks(arg.match(/\s*$/)![0])}`;
      out += `${text.slice(at, m.index)}.foldl(${LIST_HELPERS[m[1]].init}, (${acc}, ${item}) => ${LIST_HELPERS[m[1]].step(acc, body)})`;
      at = call.lastIndex = end;
    }
    return out + text.slice(at, to);
  };
  return expand(0, text.length);
}

/**
 * Where a column Quint reports on an expanded line of `qnt` lies on the line as tangled: the same column before the
 * first rewrite, shifted after the last, and undefined inside a rewrite, where no column of the original matches.
 */
export function originalColumn(tangled: string, qnt: string, line: number, col: number): number | undefined {
  const was = tangled.split("\n")[line] ?? "";
  const is = qnt.split("\n")[line] ?? "";
  if (was === is) return col;
  let head = 0;
  while (head < was.length && head < is.length && was[head] === is[head]) head++;
  if (col < head) return col;
  let tail = 0;
  while (tail < was.length - head && tail < is.length - head && was[was.length - 1 - tail] === is[is.length - 1 - tail]) tail++;
  return col >= is.length - tail ? col - (is.length - was.length) : undefined;
}


/** Quint with every string and comment blanked out, line breaks kept. */
export const bareQuint = (text: string) => { const { code } = scan(text); return text.replace(/[^\n]/g, (c, i) => (code[i] ? c : " ")); };

/** What one line of a spec is: a story or rule heading, a fence that opens or closes, a line inside a fence, or prose. */
export type LineKind = "story" | "rule" | "open" | "open quint" | "close" | "quint" | "fenced" | "prose";

/**
 * Every line of a spec with what it is. A fence of any kind (``` or ~~~, of any length) closes only with a fence of
 * the same character at least as long and nothing after it; `##` and `###` inside a fence are not headings.
 */
export function scanSpec(text: string): { text: string; kind: LineKind }[] {
  let fence: { mark: string; quint: boolean } | undefined;
  return text.split("\n").map((text) => {
    const marker = text.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence && marker && marker[1][0] === fence.mark[0] && marker[1].length >= fence.mark.length && !marker[2].trim()) {
      fence = undefined;
      return { text, kind: "close" };
    }
    if (fence) return { text, kind: fence.quint ? "quint" : "fenced" };
    if (marker && (marker[1][0] === "~" || !marker[2].includes("`"))) {
      fence = { mark: marker[1], quint: marker[2].trim().split(/\s+/)[0] === "quint" };
      return { text, kind: fence.quint ? "open quint" : "open" };
    }
    return { text, kind: text.startsWith("## ") ? "story" : text.startsWith("### ") ? "rule" : "prose" };
  });
}

/** Every spec, with each one after the specs it imports. */
export function readSpecs(root: string): Spec[] {
  const dir = path.join(root, "spec");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort() : [];
  if (!files.length) throw new Error(`there are no specs: ${dir} holds no .md file`);
  const all = files.map((f) => parseSpec(root, path.join("spec", f)));
  const ordered: Spec[] = [];
  const visit = (spec: Spec, trail: string[]) => {
    if (ordered.includes(spec)) return;
    if (trail.includes(spec.name)) throw new Error(`specs import each other in a circle: ${[...trail, spec.name].join(" -> ")}`);
    for (const i of spec.imports) {
      const dep = all.find((s) => s.name === i);
      if (!dep) throw new Error(`${spec.file} imports ${i}, but there is no spec/${i}.md`);
      visit(dep, [...trail, spec.name]);
    }
    ordered.push(spec);
  };
  all.forEach((s) => visit(s, []));
  return ordered;
}
