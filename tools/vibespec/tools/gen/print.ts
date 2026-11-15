// Quint expressions as TypeScript. Anything outside the supported subset throws with the name of the construct.
import { fail, typeOfIn, type Json, type Types } from "./types.ts";

// Operator precedence, loosest first. Mixed `&&`/`||` is always parenthesised.
const [ARROW, TERNARY, OR, AND, EQ, COMPARE, ADD, MULTIPLY, UNARY, ATOM] = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8];
const BINARY: Record<string, [string, number]> = {
  iadd: ["+", ADD], isub: ["-", ADD], imul: ["*", MULTIPLY],
  ilt: ["<", COMPARE], ilte: ["<=", COMPARE], igt: [">", COMPARE], igte: [">=", COMPARE],
  eq: ["===", EQ], neq: ["!==", EQ],
};
/** Quint's set operations, as array expressions that keep the "no value twice" property. */
type SetArgs = { a: string; b: string; el: string; out: string };
const SET_OPS: Record<string, (x: SetArgs) => string> = {
  contains: ({ a, b }) => `${a}.includes(${b})`,
  in: ({ a, b }) => `${a}.includes(${b})`,
  size: ({ a }) => `${a}.length`,
  union: ({ a, b, el }) => `[...${a}, ...${b}.filter((set_x: ${el}) => !${a}.includes(set_x))]`,
  intersect: ({ a, b, el }) => `${a}.filter((set_x: ${el}) => ${b}.includes(set_x))`,
  exclude: ({ a, b, el }) => `${a}.filter((set_x: ${el}) => !${b}.includes(set_x))`,
  subseteq: ({ a, b, el }) => `${a}.every((set_x: ${el}) => ${b}.includes(set_x))`,
  filter: ({ a, b }) => `${a}.filter(${b})`,
  forall: ({ a, b }) => `${a}.every(${b})`,
  exists: ({ a, b }) => `${a}.some(${b})`,
  map: ({ a, b, out }) => `${a}.map(${b}).reduce((set_acc: ${out}[], set_x: ${out}) => set_acc.includes(set_x) ? set_acc : [...set_acc, set_x], ([] as ${out}[]))`,
};

/** What the printer needs to know about the module an expression is in. */
export interface Scope {
  types: Types;
  /** The type the checker inferred for an expression or parameter, if it recorded one. */
  inferred: (id: number) => Json | undefined;
  /** A reference to a definition, as TypeScript spells it. */
  ref: (name: string) => string;
  /** The name of a helper function the module carries for itself: quotient, remainder, lookup<n>. */
  helper: (which: string) => string;
  /** Checks that a name the spec binds survives translation unchanged. */
  bind: (name: string) => string;
  variants: Set<string>;
  definitions: Set<string>;
  sampleSets: Set<string>;
}

/** Native array methods for the list helpers the tangler marks (LIST_HELPERS in tools/gen.ts). */
const LIST_METHODS: Record<string, string> = { every: "every", some: "some", listMap: "map" };

/** The set and the value of a membership test, whichever way round it is written. */
const members = (op: string, a: Json[]): [Json, Json] => (op === "in" ? [a[1], a[0]] : [a[0], a[1]]);

/** Puts a binding back as it was before an inner scope shadowed it. */
const restore = <V>(m: Map<string, V>, k: string, v: V | undefined) => (v === undefined ? m.delete(k) : m.set(k, v));

export function printer({ types, inferred, ref, helper, bind, variants, definitions, sampleSets }: Scope) {
  const { resolve, tagged, isScalar, setElem, named, ownerOf, typeName, tsType } = types;
  const typeOf = typeOfIn(inferred);
  /** Which arithmetic helpers the printed code needs, and the value types of the maps it looks things up in. */
  const arithmetic = new Set<string>();
  const lookups: string[] = [];
  /** Names that stand for something else while a `match` arm is printed: the arm's binder is the matched value. */
  const renamed = new Map<string, string>();
  const matchedAs = new Map<string, string>(); // binder -> the variant its arm matched
  let nesting = 0;

  /** `ex(e, min)` prints `e`, parenthesised only if it binds looser than `min`. */
  const ex = (e: Json, min = ARROW): string => {
    nesting++;
    const [text, prec] = print(e);
    nesting--;
    return prec < min ? `(${text})` : text;
  };
  const flat = (e: Json, op: string): Json[] => (e.kind === "app" && e.opcode === op ? e.args.flatMap((x: Json) => flat(x, op)) : [e]);
  const tag = (variant: string) => JSON.stringify(variant.split("::").pop());
  // A key is stored with a "$" in front, so that no key can be mistaken for something every object has, such as
  // "constructor" or "__proto__".
  const mapKey = (k: Json) => `"$" + ${ex(k, ADD + 1)}`;
  /** Inside another expression a record literal has no declared type to check against, so it states its own. */
  const typed = (text: string, e: Json): string => {
    const d = nesting > 1 ? named(typeOf(e.id), "rec") : undefined;
    return d ? `(${text} as ${typeName(d)})` : text;
  };
  const scalarOnly = (what: string, xs: Json[]) =>
    xs.every((x) => isScalar(typeOf(x.id))) || fail(`${what} on records or lists is not supported: compare fields, or use every/some`);
  /** `name: value` for each pair of a record literal's arguments. */
  const pairs = (args: Json[]) => args.flatMap((_, i) => (i % 2 ? [] : [`${args[i].value}: ${ex(args[i + 1], TERNARY)}`]));
  /** `{ ...x, a: 1, b: 2 }` arrives as nested updates; this is what is updated, and the updates in order. */
  const unroll = (e: Json): { base: Json; updates: string[] } => {
    const updates: string[] = [];
    for (; e.kind === "app" && e.opcode === "with"; e = e.args[0]) updates.unshift(`${e.args[1].value}: ${ex(e.args[2], TERNARY)}`);
    return { base: e, updates };
  };
  /** `a.append(x).concat(b)` as the items of one array literal, `...a, x, ...b`, rather than spreads nested in spreads. */
  const items = (e: Json): string[] =>
    e.kind === "app" && e.opcode === "append" ? [...items(e.args[0]), ex(e.args[1], TERNARY)]
    : e.kind === "app" && e.opcode === "concat" ? [...items(e.args[0]), ...items(e.args[1])]
    : [`...${ex(e, ATOM)}`];
  /** A lambda. Its parameters carry their types, which LemmaScript cannot always infer. */
  const arrow = (params: Json[], result: Json): string => {
    // A parameter hides an enclosing match arm's binder of the same name: inside the lambda the name is the parameter.
    const hidden = params.map((p) => [p.name, renamed.get(p.name), matchedAs.get(p.name)] as const);
    for (const [n] of hidden) { renamed.delete(n); matchedAs.delete(n); }
    const text = ex(result, TERNARY);
    for (const [n, r, m] of hidden) { restore(renamed, n, r); restore(matchedAs, n, m); }
    const param = (p: Json) => (inferred(p.id) ? `${bind(p.name)}: ${tsType(typeOf(p.id))}` : bind(p.name));
    return `(${params.map(param).join(", ")}) => ${text.startsWith("{") ? `(${text})` : text}`;
  };

  const print = (e: Json): [string, number] => {
    switch (e.kind) {
      case "int":
        if (!Number.isSafeInteger(e.value)) fail(`integer literal ${e.value} is beyond 2^53 and would lose precision in TypeScript`);
        return [String(e.value), e.value < 0 ? UNARY : ATOM];
      case "bool": return [String(e.value), ATOM];
      case "str": return [JSON.stringify(e.value), ATOM];
      case "name": {
        if (sampleSets.has(e.name)) return fail(`${e.name} is a sample set for the simulator and cannot be used in a definition`);
        if (renamed.has(e.name)) return fail(`\`${e.name}\` is what a match arm carries; use its fields (${e.name}.field), or rebuild the variant, rather than the value as a whole`);
        if (!variants.has(e.name)) return [ref(e.name), ATOM];
        const owner = ownerOf(e.name);
        return [tagged(owner.type) ? `({ tag: ${tag(e.name)} } as ${typeName(owner)})` : tag(e.name), ATOM];
      }
      case "let": return fail(`\`val ${e.opdef.name}\` must be at the top of a definition, not inside an expression`);
      case "lambda": return [arrow(e.params, e.expr), ARROW];
      case "app": break;
      default: return fail(`unsupported expression kind ${e.kind}`);
    }
    const a: Json[] = e.args;
    const op: string = e.opcode;
    if (BINARY[op]) {
      const [symbol, prec] = BINARY[op];
      if (op === "eq" || op === "neq") scalarOnly("== and !=", a);
      return [`${ex(a[0], prec)} ${symbol} ${ex(a[1], prec + 1)}`, prec];
    }
    const recv = () => ex(a[0], ATOM);
    switch (op) {
      case "iuminus": return [`0 - ${ex(a[0], ADD + 1)}`, ADD]; // not -x: in JavaScript that gives -0 for 0
      // Quint divides towards zero, and its remainder takes the sign of the dividend. JavaScript's floor and Dafny's
      // division do neither for negative numbers, so both go through helpers that are exact in all three.
      case "idiv": arithmetic.add("quotient"); return [`${helper("quotient")}(${ex(a[0], TERNARY)}, ${ex(a[1], TERNARY)})`, ATOM];
      case "imod": arithmetic.add("quotient").add("remainder"); return [`${helper("remainder")}(${ex(a[0], TERNARY)}, ${ex(a[1], TERNARY)})`, ATOM];
      // A map is a record keyed by strings. Looking a key up is only safe where the same definition has tested for it.
      case "Map": return [a.reduce((m, pair) => `{ ...${m}, [${mapKey(pair.args[0])}]: ${ex(pair.args[1], TERNARY)} }`, `({} as ${tsType(typeOf(e.id))})`), ATOM];
      case "put": case "set": return [`{ ...${recv()}, [${mapKey(a[1])}]: ${ex(a[2], TERNARY)} }`, ATOM];
      case "get": return [`${recv()}[${mapKey(a[1])}]`, ATOM];
      case "keys": return fail("a map cannot be listed or iterated, only asked about one key: write `m.keys().contains(k)`, and keep a list of keys beside the map if you need to go through them");
      case "not": return [`!${ex(a[0], ATOM)}`, UNARY];
      case "and": return [flat(e, "and").map((x) => ex(x, AND + 1)).join(" && "), AND];
      case "or": return [flat(e, "or").map((x) => ex(x, AND + 1)).join(" || "), OR];
      case "implies": return [`!${ex(a[0], ATOM)} || ${ex(a[1], AND + 1)}`, OR];
      case "iff": return [`${ex(a[0], EQ + 1)} === ${ex(a[1], EQ + 1)}`, EQ];
      case "ite": {
        // `if (m.keys().contains(k)) m.get(k) else d` is a lookup with a default. It goes through a helper in which
        // the key is one name, which is the form both TypeScript and the prover can see is safe.
        const [keys, key] = a[0].kind === "app" && (a[0].opcode === "contains" || a[0].opcode === "in") ? members(a[0].opcode, a[0].args) : [];
        const get = a[1].kind === "app" && a[1].opcode === "get" ? a[1] : undefined;
        if (keys?.opcode === "keys" && get && ex(get.args[0]) === ex(keys.args[0]) && ex(get.args[1]) === ex(key)) {
          const of = tsType(resolve(typeOf(keys.args[0].id)).res);
          if (!lookups.includes(of)) lookups.push(of);
          return [`${helper(`lookup${lookups.indexOf(of)}`)}(${ex(keys.args[0], TERNARY)}, ${ex(key, TERNARY)}, ${ex(a[2], TERNARY)})`, ATOM];
        }
        return [`${ex(a[0], OR)} ? ${ex(a[1], OR)} : ${ex(a[2], OR)}`, TERNARY];
      }
      case "field": return [`${a[0].kind === "name" && renamed.has(a[0].name) ? renamed.get(a[0].name) : recv()}.${a[1].value}`, ATOM];
      case "Rec": return [typed(`{ ${pairs(a).join(", ")} }`, e), ATOM];
      case "with": {
        const { base, updates } = unroll(e);
        return [typed(`{ ...${ex(base, ATOM)}, ${updates.join(", ")} }`, e), ATOM];
      }
      // Lists are arrays.
      // An empty list carries its type, which TypeScript cannot infer where it is a fold's starting value.
      case "List": return [a.length ? `[${a.map((x) => ex(x, TERNARY)).join(", ")}]` : `([] as ${tsType(typeOf(e.id))})`, ATOM];
      case "append": case "concat": return [`[${items(e).join(", ")}]`, ATOM];
      case "length": return [`${recv()}.length`, ATOM];
      case "nth": return [`${recv()}[${ex(a[1])}]`, ATOM];
      case "head": return [`${recv()}[0]`, ATOM];
      case "tail": return [`${recv()}.slice(1)`, ATOM];
      case "select": return [`${recv()}.filter(${ex(a[1])})`, ATOM];
      case "foldl": {
        // A fold whose accumulator is marked is one of the list helpers, expanded by the tangler.
        const [acc, item] = a[2].kind === "lambda" ? a[2].params : [];
        const which = acc?.name.match(/^std_(every|some|listMap|includes)_/)?.[1];
        const inner = a[2].expr?.args?.[1];
        if (LIST_METHODS[which]) return [`${recv()}.${LIST_METHODS[which]}(${arrow([item], inner)})`, ATOM];
        if (which === "includes") { scalarOnly("includes", [inner.args[1]]); return [`${recv()}.includes(${ex(inner.args[1], TERNARY)})`, ATOM]; }
        return [`${recv()}.reduce(${ex(a[2])}, ${ex(a[1], TERNARY)})`, ATOM];
      }
    }
    if (variants.has(op)) {
      // A variant that carries a record: Paid({ receipt: 7 }) is { tag: "Paid", receipt: 7 }.
      const owner = ownerOf(op);
      // Updating the matched value in place: Packed({ ...x, labels: … }) inside the Packed arm keeps the tag it has.
      const { base, updates } = unroll(a[0]);
      if (base.kind === "name" && matchedAs.get(base.name) === op.split("::").pop())
        return [updates.length ? `({ ...${renamed.get(base.name)}, ${updates.join(", ")} } as ${typeName(owner)})` : renamed.get(base.name)!, ATOM];
      if (a[0].kind !== "app" || a[0].opcode !== "Rec") fail(`${op}(…): give the record field by field, or update the value matched in the ${op} arm`);
      return [`({ ${[`tag: ${tag(op)}`, ...pairs(a[0].args)].join(", ")} } as ${typeName(owner)})`, ATOM];
    }
    if (op === "matchVariant") {
      // match o { | Draft(d) => … | _ => … } becomes a chain of tests on the tag, with d standing for o itself.
      if (a[0].kind !== "name") fail("`match` must be on a name; bind the value with `val` first");
      const subject = ex(a[0], ATOM);
      const isTagged = tagged(resolve(typeOf(a[0].id)));
      const arms: { test?: string; result: string }[] = [];
      for (let i = 1; i < a.length; i += 2) {
        const binder = a[i + 1].params[0]?.name;
        // Inside the arm the binder stands for the matched value; an outer arm's binder of the same name comes back after.
        const bound = binder && binder !== "_";
        const outer = bound ? [renamed.get(binder), matchedAs.get(binder)] : [];
        if (bound) { renamed.set(binder, subject); matchedAs.set(binder, a[i].value); }
        const result = ex(a[i + 1].expr, OR);
        if (bound) { restore(renamed, binder, outer[0]); restore(matchedAs, binder, outer[1]); }
        arms.push({ test: a[i].value === "_" ? undefined : `${subject}${isTagged ? ".tag" : ""} === ${JSON.stringify(a[i].value)}`, result });
      }
      const last = arms.pop()!;
      return [arms.reduceRight((rest, arm) => `${arm.test} ? ${arm.result} : ${rest}`, last.result), arms.length ? TERNARY : OR];
    }
    if ((op === "contains" || op === "in") && (op === "in" ? a[1] : a[0]).opcode === "keys") {
      const [keys, key] = op === "in" ? [a[1], a[0]] : [a[0], a[1]];
      return [`(${mapKey(key)}) in ${ex(keys.args[0], COMPARE + 1)}`, COMPARE];
    }
    if (SET_OPS[op]) {
      // A set is an array that never holds the same value twice. Only simple values can be in one.
      const t = resolve(typeOf(op === "in" ? a[1].id : a[0].id));
      if (t.kind !== "set") return fail(`\`${op}\` is supported on sets only`);
      const el = tsType(setElem(t));
      const [x, y] = op === "in" ? [a[1], a[0]] : [a[0], a[1]];
      // What `map` makes is a set too, so it is held to the same rule as what it maps.
      return [SET_OPS[op]({ a: ex(x, ATOM), b: y && ex(y, y.kind === "lambda" ? ARROW : ATOM), el, out: op === "map" ? tsType(setElem(resolve(typeOf(e.id)))) : el }), ATOM];
    }
    if (op === "Set") {
      const t = resolve(typeOf(e.id));
      setElem(t);
      const members = [...new Set(a.map((x) => ex(x, TERNARY)))];
      const literal = (x: Json) => ["int", "str", "bool"].includes(x.kind) || (x.kind === "name" && variants.has(x.name));
      if (a.length > 1 && !a.every(literal)) fail("Set(…) with several members that are not literals could hold the same value twice; write Set(a).union(Set(b))");
      return [members.length ? `[${members.join(", ")}]` : `([] as ${tsType(t.elem)}[])`, ATOM];
    }
    if (definitions.has(op)) return [`${ref(op)}(${a.map((x) => ex(x, TERNARY)).join(", ")})`, ATOM];
    if (sampleSets.has(op)) return fail(`${op} is a sample set for the simulator and cannot be used in a definition`);
    return fail(`\`${op}\` is not in the Quint a spec may use (AGENTS.md, "Supported Quint"); write it with the operators listed there`);
  };

  /** A definition body: leading `val`s become `const`s, the rest is returned. */
  const body = (e: Json): string[] => {
    const lines: string[] = [];
    for (; e.kind === "let"; e = e.expr) {
      if (e.opdef.expr.kind === "lambda") fail(`local def ${e.opdef.name} is not supported`);
      lines.push(`const ${bind(e.opdef.name)}: ${tsType(typeOf(e.opdef.id))} = ${ex(e.opdef.expr)};`);
    }
    return [...lines, `return ${ex(e)};`];
  };

  return { ex, body, arithmetic, lookups };
}
export type Printer = ReturnType<typeof printer>;
