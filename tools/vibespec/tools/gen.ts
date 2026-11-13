// Quint IR -> TypeScript. Reads the JSON that `quint typecheck --out` writes for a
// pure module and emits one TypeScript module annotated for LemmaScript, plus a
// Quint harness module that drives the same definitions for simulation.
//
// The supported Quint subset is deliberately small; anything outside it throws
// with the name of the construct, so a spec can never be silently mistranslated.
//
// This file reads the module: what it imports, which names it may bind and how a
// name is spelled. The rest is in gen/: types.ts (everything decided by a type),
// print.ts (expressions), classify.ts (which definition is a transition, a guard
// or a rule), typescript.ts and harness.ts (the two outputs).
import { classify, type Law, type Param, type StepRule, type Transition } from "./gen/classify.ts";
import { harness, type Eval } from "./gen/harness.ts";
import { printer } from "./gen/print.ts";
import { typescript } from "./gen/typescript.ts";
import { fail, typeOfIn, typeWalks, type Json } from "./gen/types.ts";

export interface Model {
  name: string;
  imports: string[]; // other specs this one imports, in order
  /** The module under a prefix for proof bundles; `docs = false` omits spec comments for cache keys. */
  render: (prefix: string, docs?: boolean) => string;
  stateType: Json | undefined; // undefined for a library: definitions and laws, no state machine
  transitions: Transition[];
  always: string[];
  sometimes: string[];
  steps: StepRule[];
  laws: Law[];
  /** The type of who sends events (the transitions' `by`), if they say. */
  sender: Json | undefined;
  evals: Eval[];
  /** Definitions the simulator cannot evaluate on their own, because it has no values for a parameter. */
  uncompared: string[];
  /** A value from a Quint trace (ITF) as the generated TypeScript represents it. */
  decode: (type: Json, itf: any) => any;
  /** The same value with every set in a fixed order, so that two sets compare equal however they were built. */
  canon: (type: Json, value: any) => any;
  /** What importers may refer to: `typedefs` are owned here; `visible` includes imported types. */
  exports: { types: string[]; values: string[]; variants: string[]; typedefs: Json[]; visible: Json[] };
  ts: string;
  harness: string;
}

/** Where a definition came from in the spec, for doc comments and ordering. */
export interface Origin { rule: string; line: number }

/**
 * `every`, `some`, `includes` and `listMap` are not Quint: the tangler expands
 * them into Quint's built-in `foldl` (see expandListHelpers in spec.ts), marking
 * the accumulator with one of these prefixes so that they come out here as the
 * native array methods. They cannot be Quint definitions that take a lambda,
 * because Quint evaluates such a definition wrongly when it is used inside its
 * own argument, as in `tasks.some(t => t.parents.some(...))`.
 */
export const LIST_HELPERS: Record<string, { init: string; step: (acc: string, body: string) => string }> = {
  every: { init: "true", step: (acc, body) => `${acc} and (${body})` },
  some: { init: "false", step: (acc, body) => `${acc} or (${body})` },
  listMap: { init: "List()", step: (acc, body) => `${acc}.append(${body})` },
  includes: { init: "false", step: (acc, body) => `${acc} or ${body}` },
};

/** Names a spec may not bind: the generated code, the harness or the proof library (ProofLib) use them, or TypeScript reserves them. */
const TAKEN = new Set(`
  init step probe inv enabled parseEvent parseState initialHolds Event current event raw state prev moved last out lawsHold Out Nothing ProofLib
  Number Math Object Array JSON Record Set Map String Boolean Symbol Error undefined NaN Infinity globalThis
  break case catch class const continue debugger default delete do else enum export extends false finally for function
  if import in instanceof new null return super switch this throw true try typeof var void while with yield let static await
`.split(/\s+/).filter(Boolean));
const GENERATED = /^(eval|quotient|remainder|lookup\d+|std|set|Out)_|^x\d+$|__\d+$/;

export function generate(ir: Json, name: string, source: string, origin: (def: string) => Origin | undefined, deps: Map<string, Model>): Model {
  const decls: Json[] = (ir.modules.find((m: Json) => m.name === name) ?? fail(`module ${name} not found`)).declarations;

  // --- what the module imports -------------------------------------------------
  // `import kernel.* from "./kernel"` brings a library's names in as they are. `import order as O from "./order"`
  // brings any spec in, a state machine included, under the names O::pay, O::Order and so on.
  const links = decls.filter((d) => d.kind === "import").map((d) => {
    const dep = deps.get(d.protoName) ?? fail(`import of ${d.protoName}: there is no spec/${d.protoName}.md`);
    if (d.qualifiedName) return { module: dep.name, exports: dep.exports, alias: d.qualifiedName as string };
    if (d.defName !== "*") fail(`import ${d.protoName}: write \`import ${d.protoName}.* from "./${d.protoName}"\` or \`import ${d.protoName} as X from "./${d.protoName}"\``);
    if (dep.stateType) fail(`import of ${d.protoName}: a spec with a state of its own is imported under a name, as in \`import ${d.protoName} as X from "./${d.protoName}"\``);
    return { module: dep.name, exports: dep.exports, alias: undefined as string | undefined };
  });
  const imports = links.map((l) => l.module);
  const twice = imports.find((m, i) => imports.indexOf(m) !== i);
  if (twice) fail(`${twice} is imported twice; import a spec once, either as it is or under one name`);
  const qualify = (alias: string | undefined, n: string) => (alias ? `${alias}::${n}` : n);
  /** An imported name as this module writes it, and the module it came from. */
  const imported = (kind: "values" | "variants") => links.flatMap((l) => l.exports[kind].map((n) => [qualify(l.alias, n), l.module] as const));
  const cameFrom = new Map(imported("values"));

  // --- what it defines ------------------------------------------------------------
  const localTypedefs = decls.filter((d) => d.kind === "typedef");
  for (const d of localTypedefs) d.module = name; // so that the harness can name a type by the module that defines it
  const localVariants = localTypedefs.flatMap((t) => (t.type.kind === "sum" ? t.type.fields.fields.map((f: Json) => f.fieldName as string) : []));
  const variants = new Set([...localVariants, ...imported("variants").map(([n]) => n)]);
  const defs = decls.filter((d) => d.kind === "def" && !localVariants.includes(d.name));
  for (const d of [...decls.filter((d) => !["def", "typedef", "import"].includes(d.kind)), ...defs.filter((d) => d.qualifier !== "puredef" && d.qualifier !== "pureval")])
    fail(`${d.name ?? d.kind}: only types, imports, \`pure val\` and \`pure def\` belong in a spec (state and actions are generated)`);
  const inferred = (id: number): Json | undefined => ir.types[id]?.type;
  const typeOf = typeOfIn(inferred);
  // A set named `<param>Values` tells the simulator what to try for a parameter. It never reaches TypeScript, so any Quint is allowed in it.
  const isSampleSet = (d: Json) => d.qualifier === "pureval" && d.name.endsWith("Values") && inferred(d.id)?.kind === "set";
  const sampleSets = new Set(defs.filter(isSampleSet).map((d) => d.name as string));
  /** What each sample set holds, and where the spec defines it, so that the harness can hold it to the parameter it is for. */
  const samples = new Map(defs.filter(isSampleSet).map((d) => [d.name as string, { elem: inferred(d.id)!.elem as Json, line: origin(d.name)?.line }]));
  const code = defs.filter((d) => !isSampleSet(d));
  const localNames = new Set(code.map((d) => d.name as string));
  /** A name the spec binds (a type, definition, parameter or local `val`) must survive translation unchanged. */
  const bind = (n: string): string => {
    const owner = imports.find((m) => n.startsWith(`${m}_`));
    return TAKEN.has(n) || GENERATED.test(n) ? fail(`\`${n}\` cannot be used as a name: TypeScript or the generated code uses it`)
      : variants.has(n) ? fail(`\`${n}\` is a variant of a type and cannot also name a parameter or value`)
      : owner ? fail(`\`${n}\` cannot be used as a name: names beginning ${owner}_ are how the generated code refers to that module`)
      : n;
  };
  [...defs, ...localTypedefs].forEach((d) => bind(d.name));

  // --- types: the module's own, and those of what it imports under the names it knows them by ---
  /** A type from a module imported under a name, with the types it mentions renamed the same way. */
  const requalify = (t: Json, alias: string | undefined): Json =>
    !alias || t === null || typeof t !== "object" ? t
    : Array.isArray(t) ? t.map((x) => requalify(x, alias))
    : t.kind === "const" ? { ...t, name: qualify(alias, t.name) }
    : Object.fromEntries(Object.entries(t).map(([k, v]) => [k, requalify(v, alias)]));
  // Every type a module can name comes along with it, including what it imported itself: a machine whose state holds a
  // library's type is imported under a name together with that type (as M::T), however deep the import.
  const seen = new Set<string>();
  const typedefs = [
    ...links.flatMap((l) => l.exports.visible.map((d) => ({ ...d, type: requalify(d.type, l.alias), name: qualify(l.alias, d.name), alias: l.alias ?? d.alias, base: d.base ?? d.name }))),
    ...localTypedefs,
  ].filter((d) => !seen.has(d.name) && !!seen.add(d.name));
  /** Modules whose types this one names without importing them itself; the harness and the TypeScript import them too. */
  const typeOnly = [...new Set(typedefs.map((d) => d.module as string))].filter((m) => m !== name && !imports.includes(m)).sort();
  const types = typeWalks(typedefs, name);

  // --- definitions, by the naming convention ----------------------------------------
  const sig = (d: Json) => {
    const t = typeOf(d.id);
    const params: Param[] = d.expr.params.map((p: Json, i: number) => ({ name: bind(p.name), type: t.args[i] }));
    return { params, result: t.res };
  };
  const bySpecOrder = (x: Json, y: Json) => (origin(x.name)?.line ?? 0) - (origin(y.name)?.line ?? 0);
  const vals = code.filter((d) => d.qualifier === "pureval");
  const funs = code.filter((d) => d.qualifier === "puredef").sort(bySpecOrder);
  for (const d of funs) if (d.expr.kind !== "lambda") fail(`${d.name}: a \`pure def\` takes parameters; for a constant write \`pure val ${d.name} = …\``);
  // A rule must be a definition: as a `pure val` it would be generated as a constant and never checked.
  for (const v of vals) if (/^(always|sometimes|step|law|can)[A-Z]/.test(v.name) && typeOf(v.id).kind === "bool") fail(`${v.name}: a rule or guard is a \`pure def\` with parameters (AGENTS.md, "What goes in the Quint blocks"), not a \`pure val\`; if it is a constant, name it otherwise`);
  const initial = vals.find((d) => d.name === "initial");
  const roles = classify(funs, initial && typeOf(initial.id), sig, types);

  // --- TypeScript -------------------------------------------------------------------
  // A heading is prose from the spec; it must not be able to end the comment it is quoted in.
  const doc = (d: string) => (origin(d) ? `/** ${origin(d)!.rule.replace(/\*\//g, "* /").replace(/[\r\n]+/g, " ")} (${source}:${origin(d)!.line}) */\n` : "");
  const importLine = (l: (typeof links)[number]) => {
    const item = (n: string, isType: boolean) => `${isType ? "type " : ""}${n} as ${l.module}_${n}`;
    return `import { ${[...l.exports.types.map((t) => item(t, true)), ...l.exports.values.map((v) => item(v, false))].join(", ")} } from "./${l.module}.ts";`;
  };
  const header = [
    `// GENERATED from ${source} by tools/spec.ts. Do not edit: change the spec and run \`npm run gen\`.`,
    `//@ backend dafny`,
    ...links.map(importLine),
    ...typeOnly.map((m) => `import { ${[...new Set(typedefs.filter((d) => d.module === m).map((d) => d.base as string))].map((b) => `type ${b} as ${m}_${b}`).join(", ")} } from "./${m}.ts";`),
  ];
  /** The module's TypeScript with its own top-level names under a prefix, and the helper functions it turned out to need. */
  const render = (prefix: string, docs = true): { text: string; helpers: string[] } => {
    const local = (n: string) => prefix + n;
    const helper = (which: string) => local(`${which}_${name}`);
    // A definition from another module is spelled <module>_<name>, however it was imported.
    const ref = (n: string) => (localNames.has(n) ? local(n) : cameFrom.has(n) ? `${cameFrom.get(n)}_${n.split("::").pop()}` : n);
    const scoped = typeWalks(typedefs, name, prefix);
    const print = printer({ types: scoped, inferred, ref, helper, bind, variants, definitions: new Set([...localNames, ...cameFrom.keys()]), sampleSets });
    const text = typescript({ header, typedefs: [...localTypedefs].sort(bySpecOrder), vals, funs, sig, typeOf, doc: docs ? doc : () => "", local }, roles, scoped, print, helper);
    return { text, helpers: [...[...print.arithmetic].map(helper), ...print.lookups.map((_, i) => helper(`lookup${i}`))] };
  };
  const own = render("");

  const run = harness(name, source, [...imports, ...typeOnly], funs, sig, samples, roles, types);
  return {
    name, imports, ...roles, evals: run.evals, uncompared: run.uncompared, harness: run.text,
    ts: own.text, render: (prefix, docs) => render(prefix, docs).text, decode: types.decode, canon: types.canon,
    exports: { types: localTypedefs.map((d) => d.name as string), values: [...localNames, ...own.helpers], variants: localVariants, typedefs: localTypedefs, visible: typedefs },
  };
}
