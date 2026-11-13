// The TypeScript module for one spec: its types, its definitions with their proof obligations, and, for a state
// machine, the event type and the functions that apply and admit events.
import { SENDER, type Param, type Roles, type Transition } from "./classify.ts";
import type { Printer } from "./print.ts";
import type { Json, Types } from "./types.ts";

export interface Source {
  /** The line that opens the file, and one import line per spec this one imports. */
  header: string[];
  typedefs: Json[];
  vals: Json[];
  funs: Json[];
  sig: (d: Json) => { params: Param[]; result: Json };
  typeOf: (id: number) => Json;
  /** The doc comment that ties a definition to its rule in the spec; empty if it has none. */
  doc: (def: string) => string;
  /** One of the module's own top-level names, as this rendering spells it. */
  local: (name: string) => string;
}

export function typescript({ header, typedefs, vals, funs, sig, typeOf, doc, local: L }: Source, roles: Roles, types: Types, print: Printer, helper: (which: string) => string): string {
  const { tsType, declaration, wellFormed, copy } = types;
  const { transitions, always, steps, laws, sender } = roles;
  const state = roles.stateType && tsType(roles.stateType);
  // Who sent an event is never part of it: the program passes it to `enabled` and `step` from what it trusts.
  const carried = (t: Transition) => t.params.filter((p) => p.name !== SENDER);
  const by = sender ? `, ${SENDER}: ${tsType(sender)}` : "";
  const out: string[] = [...header, ``, ...typedefs.map((d) => doc(d.name) + declaration(d))];
  if (state) out.push(
    ``,
    `/** One variant per transition in the spec${sender ? `, without \`${SENDER}\`: who sent it is passed beside it` : ""}. */`,
    `export type ${L("Event")} =`,
    ...transitions.map((t) => `  | { type: ${JSON.stringify(t.name)}${carried(t).map((p) => `; ${p.name}: ${tsType(p.type)}`).join("")} }`).map((l, i, all) => (i === all.length - 1 ? l + ";" : l)),
  );
  out.push(``, ...vals.map((d) => `${doc(d.name)}export const ${L(d.name)}: ${tsType(typeOf(d.id))} = ${print.ex(d.expr)};`));
  if (state) out.push(
    ``,
    `/** Every \`always\` rule at once. Holds initially and after every transition. */`,
    `//@ pure`,
    `export function ${L("inv")}(current: ${state}): boolean {`,
    `  return ${always.length ? always.map((a) => `${L(a)}(current)`).join(" && ") : "true"};`,
    `}`,
  );
  for (const d of funs) {
    const { params, result } = sig(d);
    const t = transitions.find((t) => t.name === d.name);
    // One `ensures` per rule, so a failed proof names the rule that the transition breaks. The transition has no
    // precondition: its guarantees are conditional instead, so that a guard may itself look at the transition's result.
    const given = t && `(${L("inv")}(${params[0].name})${t.guard ? ` && ${L(t.guard)}(${[params[0].name, ...t.guardParams].join(", ")})` : ""}) ==> `;
    const contract = t ? [
      ...always.map((a) => `  //@ ensures ${given}${L(a)}(\\result)`),
      ...steps.map((r) => `  //@ ensures ${given}${L(r.name)}(${[params[0].name, ...(r.via ? [JSON.stringify(t.name)] : []), "\\result"].join(", ")})`),
    ] : laws.some((l) => l.name === d.name) ? [`  //@ ensures \\result === true`] : [];
    out.push(
      ``,
      `${doc(d.name)}//@ pure`,
      `export function ${L(d.name)}(${params.map((p) => `${p.name}: ${tsType(p.type)}`).join(", ")}): ${tsType(result)} {`,
      ...contract,
      ...print.body(d.expr.expr).map((l) => `  ${l}`),
      `}`,
    );
  }
  const call = (fn: string, params: string[]) => `${L(fn)}(${["current", ...params.map((p) => (p === SENDER ? p : `event.${p}`))].join(", ")})`;
  const admits = (t: Transition) => call(t.guard!, t.guardParams);
  const applies = (t: Transition) => call(t.name, t.params.map((p) => p.name));
  const when = (t: Transition) => `event.type === ${JSON.stringify(t.name)}`;
  // A copy through JSON drops what JSON cannot hold; a value it cannot copy at all is not one the program accepts.
  const cloned = [`  let raw: any;`, `  try {`, `    raw = JSON.parse(JSON.stringify(x));`, `  } catch {`, `    return undefined;`, `  }`];
  const parsed = (t: Transition) => `{ ${[`type: ${JSON.stringify(t.name)}`, ...carried(t).map((p) => `${p.name}: ${copy(`raw.${p.name}`, p.type)}`)].join(", ")} }`;
  if (state) out.push(
    ``,
    `/** Do the rules allow this event${sender ? `, from this sender,` : ""} in this state? */`,
    `//@ pure`,
    `export function ${L("enabled")}(current: ${state}, event: ${L("Event")}${by}): boolean {`,
    ...transitions.map((t) => `  if (${when(t)}) return ${t.guard ? admits(t) : "true"};`),
    `  return false;`,
    `}`,
    ``,
    `/** Apply an event${sender ? ` from \`${SENDER}\`, whom the program knows from what it trusts, never from the event` : ""}. An event the rules do not allow leaves the state unchanged. */`,
    `//@ pure`,
    `export function ${L("step")}(current: ${state}, event: ${L("Event")}${by}): ${state} {`,
    `  //@ requires ${L("inv")}(current)`,
    `  //@ ensures ${L("inv")}(\\result)`,
    ...transitions.map((t) => `  if (${when(t)}${t.guard ? ` && ${admits(t)}` : ""}) return ${applies(t)};`),
    `  return current;`,
    `}`,
    ``,
    `/**`,
    ` * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:`,
    ` * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy`,
    ` * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.`,
    ` */`,
    `//@ skip`,
    `export function ${L("parseEvent")}(x: unknown): ${L("Event")} | undefined {`,
    ...cloned,
    `  if (typeof raw !== "object" || raw === null) return undefined;`,
    ...transitions.map((t) => `  if (raw.type === ${JSON.stringify(t.name)}${carried(t).map((p) => ` && ${wellFormed(`raw.${p.name}`, p.type)}`).join("")}) return ${parsed(t)};`),
    `  return undefined;`,
    `}`,
    ``,
    `/**`,
    ` * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must`,
    ` * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing`,
    ` * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every \`always\` rule. The`,
    ` * result is a fresh copy, so nothing the caller keeps can change it afterwards.`,
    ` */`,
    `//@ skip`,
    `export function ${L("parseState")}(x: unknown): ${state} | undefined {`,
    ...cloned,
    `  if (!(${wellFormed("raw", roles.stateType, 0, true)})) return undefined;`,
    `  const parsed: ${state} = ${copy("raw", roles.stateType)};`,
    `  return ${L("inv")}(parsed) ? parsed : undefined;`,
    `}`,
    ``,
    `/** Proof obligation: the initial state satisfies every \`always\` rule. */`,
    `export function ${L("initialHolds")}(): ${state} {`,
    `  //@ ensures ${L("inv")}(\\result)`,
    `  return ${L("initial")};`,
    `}`,
  );
  // The helpers come last: which are needed is known only once every definition has been printed.
  print.lookups.forEach((of, i) => out.push(
    ``,
    `/** What a map holds for a key, or \`otherwise\` if it holds nothing for it. */`,
    `//@ pure`,
    `export function ${helper(`lookup${i}`)}(m: Record<string, ${of}>, k: string, otherwise: ${of}): ${of} {`,
    `  const key = "$" + k;`,
    `  return key in m ? m[key] : otherwise;`,
    `}`,
  ));
  if (print.arithmetic.has("quotient")) out.push(
    ``,
    `/** Whole-number division as Quint does it: towards zero. */`,
    `//@ pure`,
    `export function ${helper("quotient")}(a: number, b: number): number {`,
    `  //@ requires b !== 0`,
    `  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;`,
    `}`,
  );
  if (print.arithmetic.has("remainder")) out.push(
    ``,
    `/** The remainder of that division; it has the sign of the dividend. */`,
    `//@ pure`,
    `export function ${helper("remainder")}(a: number, b: number): number {`,
    `  //@ requires b !== 0`,
    `  return a - b * ${helper("quotient")}(a, b);`,
    `}`,
  );
  return [...out, ``].join("\n");
}
