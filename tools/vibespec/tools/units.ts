import fs from "node:fs";
import path from "node:path";
import type * as TS from "typescript";
import ts from "typescript";
import { generate, type Model, type Origin } from "./gen.ts";
import { fail } from "./gen/types.ts";
import { run, type Unit } from "./prove.ts";
import { originalColumn, type Spec } from "./parse.ts";
import { defines } from "./review.ts";
import { entry, recall, store, type Memory } from "./cache.ts";
import { plainText, readSrc, type SrcFile } from "./util.ts";

const ANNOTATIONS = ["backend", "pure", "requires", "ensures", "invariant", "decreases", "type", "ghost", "assert"];

/**
 * gen/ holds TypeScript that Node loads as ES modules, whatever the project's package.json says: a project whose
 * package.json says `"type": "commonjs"` would otherwise fail to load every generated module.
 */
function genDir(root: string): string {
  const dir = path.join(root, "gen");
  fs.mkdirSync(dir, { recursive: true });
  const manifest = path.join(dir, "package.json");
  if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, `${JSON.stringify({ type: "module" })}\n`);
  return dir;
}

/** Quint's errors, at their places in the Markdown: tangling keeps line numbers. */
function typeErrors(spec: Spec, ir: any, out: string): Error {
  const errors = (ir?.errors ?? []).map((e: any) => {
    const at = e.locs?.[0];
    const file = at?.source ? `spec/${path.basename(at.source, ".qnt")}.md` : spec.file;
    const col = !at ? undefined : file === spec.file ? originalColumn(spec.tangled, spec.qnt, at.start.line, at.start.col) : at.start.col;
    return at ? `${file}:${at.start.line + 1}${col === undefined ? "" : `:${col + 1}`}  ${e.explanation}` : e.explanation;
  });
  return new Error(errors.join("\n") || out);
}

/** The model of a spec, from Quint's typed IR: gen/<name>.ts and its simulation harness. `models` receives it. */
export function generated(root: string, spec: Spec, ir: any, models: Map<string, Model>): Model {
  const dir = genDir(root);
  const top = new Set<string>((ir.modules?.find((m: any) => m.name === spec.name)?.declarations ?? [])
    .filter((d: any) => d.kind === "def" || d.kind === "typedef").map((d: any) => d.name));
  const assigned = new Set(spec.rules.flatMap(defines));
  const untracked = [...top].find((name) => !assigned.has(name));
  if (untracked) {
    const rule = spec.rules.find((r) => r.locals.includes(untracked));
    throw new Error(`${spec.file}:${rule?.line ?? 1}: \`${untracked}\` is a top-level definition with no rule assignment; start it on its own line in the same column as the definition above it`);
  }
  const origins = new Map<string, Origin>();
  for (const r of spec.rules) for (const d of r.defs) origins.set(d, { rule: r.key, line: r.line });
  const model = generate(ir, spec.name, spec.file, (d) => origins.get(d), models);
  fs.writeFileSync(path.join(dir, `${spec.name}.ts`), model.ts);
  fs.writeFileSync(path.join(dir, `${spec.name}.run.qnt`), model.harness);
  models.set(spec.name, model);
  return model;
}

/**
 * Tangle, typecheck and generate one spec. `models` holds the specs it imports,
 * already generated, and receives this one. Throws with a message that points
 * into the spec.
 */
export async function gen(root: string, spec: Spec, models = new Map<string, Model>()): Promise<Model> {
  const dir = genDir(root);
  const out = path.join(dir, `${spec.name}.ir.json`);
  fs.writeFileSync(path.join(dir, `${spec.name}.qnt`), spec.qnt);
  const typed = await run("quint", ["typecheck", "--out", out, `gen/${spec.name}.qnt`], root);
  const ir = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : { errors: [] };
  fs.rmSync(out, { force: true });
  if (!typed.ok) throw typeErrors(spec, ir, typed.out);
  return generated(root, spec, ir, models);
}

/** The Quint of a spec's imports, theirs first, as far as a cache key may depend on it. */
const importedMeaning = (spec: Spec, specs: Spec[]): string =>
  spec.imports.map((n) => { const dep = specs.find((x) => x.name === n)!; return importedMeaning(dep, specs) + dep.meaning; }).join("");

/**
 * Quint's typed IR of every spec, typechecked all at once and without blocking, or remembered: it depends only on the
 * Quint of the spec and of what it imports. Each promise rejects with the errors of its spec. gen/<name>.qnt is written
 * for every spec, since the simulation harness imports it.
 */
export function typecheckAll(memory: Memory, specs: Spec[]): Map<string, Promise<any>> {
  const dir = genDir(memory.root);
  for (const spec of specs) fs.writeFileSync(path.join(dir, `${spec.name}.qnt`), spec.qnt);
  return new Map(specs.map((spec) => {
    const ir = (async () => {
      const at = await entry(memory.root, "model", [importedMeaning(spec, specs), spec.meaning]);
      const known = recall<any>(memory, at);
      if (known !== undefined) return known;
      const out = path.join(dir, `${spec.name}.ir.json`);
      const typed = await run("quint", ["typecheck", "--out", out, `gen/${spec.name}.qnt`], memory.root);
      let ir: any;
      try { ir = JSON.parse(fs.readFileSync(out, "utf8")); } catch { ir = undefined; }
      fs.rmSync(out, { force: true });
      if (!typed.ok || !ir || ir.errors?.length) throw typeErrors(spec, ir, typed.out);
      store(memory, at, ir);
      return ir;
    })();
    ir.catch(() => {}); // a spec that is not valid is reported in its turn, not as an unhandled rejection
    return [spec.name, ir] as const;
  }));
}


/**
 * LemmaScript verifies one file at a time and does not carry definitions across
 * imports, so every unit is proved as a bundle: what it imports, then itself.
 * An imported module comes with its names prefixed by the module's name and
 * without its own obligations, which are proved once, in its own unit; that
 * keeps the cost of a proof proportional to the module, not to everything
 * beneath it. A law an imported module proved is offered to the unit's proof
 * file as a lemma; nothing else of it is.
 *
 * A unit may have a proof file: spec/<name>.proof.dfy for a spec,
 * src/<path>.proof.dfy for src/<path>.ts.
 */
export async function proofUnits(root: string, models: Model[], srcFiles: SrcFile[] = readSrc(root)): Promise<Unit[]> {
  const byName = new Map(models.map((m) => [m.name, m]));
  const withoutImports = (text: string) => {
    const file = ts.createSourceFile("unit.ts", text, ts.ScriptTarget.Latest, true);
    // `export … from` loads a module as surely as `import` does.
    const imports = file.statements.filter((d): d is TS.ImportDeclaration | TS.ExportDeclaration => ts.isImportDeclaration(d) || (ts.isExportDeclaration(d) && !!d.moduleSpecifier));
    const kept = imports.reduceRight((rest, d) => rest.slice(0, d.getFullStart()) + rest.slice(d.getEnd()), text);
    return { kept, from: imports.map((d) => (d.moduleSpecifier as TS.StringLiteral).text) };
  };
  const withoutObligations = (text: string) => text.replace(/^\s*\/\/@ ensures .*\n/gm, "");
  /** The modules a module needs beside it, dependencies first. */
  const needs = (m: Model, seen: string[] = []): string[] => {
    for (const dep of m.imports) if (!seen.includes(dep)) { needs(byName.get(dep)!, seen); seen.push(dep); }
    return seen;
  };
  const asDependency = (name: string, docs = true) => withoutObligations(withoutImports(byName.get(name)!.render(`${name}_`, docs)).kept);
  /** The laws of modules placed beside a unit, as the unit spells them. */
  const lawsOf = (names: string[], spelled: (dep: string) => string) =>
    names.flatMap((dep) => byName.get(dep)!.laws.map((l) => ({ fn: `${spelled(dep)}${l.name}`, law: l.name, from: `${dep}.ts` })));
  const units: Unit[] = models.map((m) => ({
    unit: `${m.name}.ts`,
    text: [...needs(m).map((n) => asDependency(n)), withoutImports(m.ts).kept].join("\n"),
    meaning: [...needs(m).map((n) => asDependency(n, false)), withoutImports(m.render("", false)).kept].join("\n"),
    src: false,
    proofFile: `spec/${m.name}.proof.dfy`,
    laws: lawsOf(needs(m), (dep) => `${dep}_`),
    rests: [], // proved against the definitions of what it imports, never against their obligations
    transitions: m.stateType ? m.transitions.map((t) => ({ name: t.name, params: t.params.map((p) => p.name) })) : undefined,
  }));

  const src = path.join(root, "src");
  const other = srcFiles.find((u) => !u.ts);
  if (other) throw new Error(`src/${other.file}: \`//@\` appears in it, but only .ts files under src/ are proved; rename it to .ts or remove the annotations`);
  for (const { file: f, code } of srcFiles.filter((u) => u.ts)) {
    // Wherever `//@` appears, even after other text on the line, LemmaScript may read it.
    const used = [...code.matchAll(/\/\/@\s*([\w-]*)/g)].map((m) => m[1]);
    const refused = used.find((k) => !ANNOTATIONS.includes(k));
    if (refused !== undefined) throw new Error(`src/${f}: \`//@ ${refused}\` is not allowed; verified code may only use ${ANNOTATIONS.join(", ")}`);
    if (/\bimport\s*\(|\brequire\s*\(/.test(code)) throw new Error(`src/${f}: verified code may not load other code with import() or require()`);
    checkVerifiedSource(`src/${f}`, code);
    const { kept, from } = withoutImports(code);
    const deps = from.map((spec) => {
      const target = path.resolve(src, path.dirname(f), spec);
      return models.find((m) => target === path.join(root, `gen/${m.name}.ts`))?.name ?? fail(`src/${f}: verified code may only import generated modules (gen/<name>.ts), not ${spec}`);
    });
    if (new Set(deps).size > 1) throw new Error(`src/${f}: verified code may import one generated module; put what it needs from the others into that module's spec`);
    // The module it imports sits beside it under its own names, as the code refers to them.
    const d = deps[0];
    const beside = (docs: boolean) => d ? [...needs(byName.get(d)!).map((n) => asDependency(n, docs)), withoutObligations(withoutImports(byName.get(d)!.render("", docs)).kept)] : [];
    units.push({
      requires: used.filter((k) => k === "requires").length,
      unit: `src-${f.replaceAll(path.sep, "-")}`,
      text: [...beside(true), `// ---- src/${f} ----`, kept].join("\n"),
      // The hand-written code exactly as it is: only what the tools generated is read without its citations.
      meaning: [...beside(false), `// ---- src/${f} ----`, kept].join("\n"),
      src: true,
      proofFile: `src/${f.replace(/\.ts$/, ".proof.dfy")}`,
      laws: d ? [...lawsOf(needs(byName.get(d)!), (dep) => `${dep}_`), ...lawsOf([d], () => "")] : [],
      rests: d ? [...needs(byName.get(d)!), d].map((m) => `${m}.ts`) : [],
    });
  }
  const twice = units.find((u, i) => units.findIndex((v) => v.unit === u.unit) !== i);
  if (twice) throw new Error(`two files would be proved under the name ${twice.unit}; rename one of them`);
  return units;
}

/**
 * Refuse in hand-written verified code what the proof would read one way and Node another: a renamed, default or
 * namespace import, an export other than of a function, constant, type or interface declared in the file, any other
 * top-level statement (LemmaScript does not model one, though Node runs it), and a `//@` that is not in a `//`
 * comment (one in a block comment or a string is not an annotation, though it looks like one). And NUL, which no
 * source needs.
 */
export function checkVerifiedSource(file: string, code: string) {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const refuse = (at: number, why: string): never => { throw new Error(`${file}:${sf.getLineAndCharacterOfPosition(at).line + 1}: ${why}`); };
  plainText(file, code);
  for (const s of sf.statements) {
    const modifier = (ts.canHaveModifiers(s) ? ts.getModifiers(s) ?? [] : []).find((m) => m.kind !== ts.SyntaxKind.ExportKeyword);
    if (modifier) refuse(modifier.getStart(), `\`${modifier.getText()}\` is not allowed in verified code`);
    const clause = ts.isImportDeclaration(s) ? s.importClause : undefined;
    const bindings = clause?.namedBindings;
    if (clause?.name || (bindings && ts.isNamespaceImport(bindings))) refuse(s.getStart(), "verified code may import only by name (`import { a, type B } from ...`): not a default or namespace import");
    const renamed = bindings && ts.isNamedImports(bindings) && bindings.elements.find((e) => e.propertyName);
    if (renamed) refuse(renamed.getStart(), `\`${renamed.getText()}\`: verified code may not rename what it imports, since the proof reads the name as written`);
    const allowed = ts.isImportDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)
      || (ts.isFunctionDeclaration(s) && !!s.body && !s.asteriskToken)
      || (ts.isVariableStatement(s) && (s.declarationList.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.Const);
    if (!allowed) refuse(s.getStart(), "verified code may hold only imports, functions with a body, interfaces, type aliases and const declarations, each exported in its own declaration or not at all");
  }
  // Every comment is the leading trivia of a token; JSDoc is skipped, since its parts lie inside a comment.
  const lineComments: [number, number][] = [];
  const visit = (n: TS.Node) => {
    if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return;
    for (const c of ts.getLeadingCommentRanges(code, n.pos) ?? []) if (c.kind === ts.SyntaxKind.SingleLineCommentTrivia) lineComments.push([c.pos, c.end]);
    n.getChildren(sf).forEach(visit);
  };
  visit(sf);
  for (const m of code.matchAll(/\/\/@/g))
    if (!lineComments.some(([from, to]) => from <= m.index && m.index < to)) refuse(m.index, "`//@` here is not in a `//` comment (it is in a block comment or a string), so it is not an annotation; remove it or make it one");
}

/** Proof files that belong to no unit: a typo, or a source file that is no longer proved. */
export function strayProofFiles(root: string, units: Unit[]): string[] {
  const found = ["spec", "src"].flatMap((dir) => fs.existsSync(path.join(root, dir))
    ? (fs.readdirSync(path.join(root, dir), { recursive: true }) as string[]).filter((f) => f.endsWith(".proof.dfy")).map((f) => path.join(dir, f).split(path.sep).join("/")) : []);
  return found.filter((f) => !units.some((u) => u.proofFile === f));
}

/**
 * Obligations that hold in simulation but that Dafny cannot prove on its own,
 * accepted by a person: per unit, the list, and a fingerprint of the unit's
 * text and proof file when they were accepted. A list accepted for another
 * text no longer counts.
 */
