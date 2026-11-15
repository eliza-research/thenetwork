// What each definition of a spec is, read off its name and its signature.
import { fail, type Json, type Types } from "./types.ts";

export interface Param { name: string; type: Json }
/** `guardParams`: the transition's parameters its guard takes, by name, after the state. */
export interface Transition { name: string; params: Param[]; guard: string | undefined; guardParams: string[] }
export interface Law { name: string; params: Param[] }
/** A `step` rule; `via` if it also takes the name of the transition between the two states. */
export interface StepRule { name: string; via: boolean }
export interface Roles {
  /** The type of `initial`; undefined for a library, which has definitions and laws but no state machine. */
  stateType: Json | undefined;
  transitions: Transition[];
  always: string[];
  sometimes: string[];
  steps: StepRule[];
  laws: Law[];
  /** The type of the transitions' `by` parameter: who sent the event, which the program supplies and no event carries. */
  sender: Json | undefined;
}

/** The parameter that names who sent an event (AGENTS.md, "Who sent an event"). */
export const SENDER = "by";
/** The parameter of a `step` rule that names the transition taken (AGENTS.md, "What goes in the Quint blocks"). */
export const VIA = "via";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * `funs` are the spec's `pure def`s in the order it gives them; `sig` gives a definition's parameters and result.
 * The convention: `initial` is the state; a definition from the state to the state is a transition and `can<Name>`
 * its guard, which takes the state and any of the transition's parameters by name; `alwaysX(state)`,
 * `stepX(before, after)`, `stepX(before, via, after)` and `sometimesX(state)` are rules; `lawX(...)` is a law.
 */
export function classify(funs: Json[], stateType: Json | undefined, sig: (d: Json) => { params: Param[]; result: Json }, { shape, resolve }: Types): Roles {
  const stateShape = stateType && shape(stateType);
  const onState = (d: Json, at = 0) => sig(d).params.length > at && shape(sig(d).params[at].type) === stateShape;
  const isBool = (d: Json) => sig(d).result.kind === "bool";
  // A rule whose name is nearly right would otherwise be an unchecked helper.
  for (const d of funs) {
    const role = d.name.match(/^(always|sometimes|step|law|can)/i)?.[1].toLowerCase();
    if (role && role !== "can" && !new RegExp(`^${role}[A-Z]`).test(d.name) && d.name.toLowerCase() !== role) fail(`${d.name}: write \`${role}\` rules as ${role}Something`);
    if (/^Can[A-Z]/.test(d.name)) fail(`${d.name}: write guards as can${d.name.slice(3)}`);
  }
  const named = (prefix: string) => funs.filter((d) => new RegExp(`^${prefix}[A-Z]`).test(d.name));
  if (!stateType) for (const d of named("(always|sometimes|step)")) fail(`${d.name}: \`${d.name.match(/^[a-z]+/)![0]}\` rules need a state, so the spec must define \`pure val initial\``);
  const stateRule = (prefix: string): string[] => named(prefix).map((d) =>
    isBool(d) && sig(d).params.length === 1 && onState(d) ? d.name : fail(`${d.name}: a \`${prefix}\` rule takes the state and returns bool`));
  const always = stateRule("always");
  const sometimes = stateRule("sometimes");
  const steps: StepRule[] = named("step").map((d) => {
    const ps = sig(d).params;
    const via = ps.length === 3 && ps[1].name === VIA && resolve(ps[1].type).kind === "str";
    const ok = isBool(d) && onState(d, 0) && onState(d, ps.length - 1) && (ps.length === 2 || via);
    return ok ? { name: d.name, via } : fail(`${d.name}: a \`step\` rule takes the state before, optionally \`${VIA}: str\` (the transition taken), and the state after, and returns bool`);
  });
  const laws: Law[] = named("law").map((d) => (isBool(d) ? { name: d.name, params: sig(d).params } : fail(`${d.name}: a law returns bool`)));
  const rules = new Set([...always, ...sometimes, ...steps.map((r) => r.name), ...laws.map((l) => l.name)]);
  const transitions: Transition[] = !stateType ? [] : funs
    .filter((d) => !rules.has(d.name) && onState(d) && shape(sig(d).result) === stateShape)
    .map((d) => {
      const params = sig(d).params.slice(1);
      const guard = funs.find((g) => g.name === `can${cap(d.name)}`);
      if (guard && !onState(guard)) fail(`${guard.name} must take the state first, as ${d.name} does`);
      if (guard && !isBool(guard)) fail(`${guard.name}: a guard returns bool`);
      // A guard takes the state, then any of its transition's parameters, by the same names and types.
      const guardParams = guard ? sig(guard).params.slice(1).map((g) => {
        const p = params.find((p) => p.name === g.name);
        return p && shape(p.type) === shape(g.type) ? g.name : fail(`${guard.name}: \`${g.name}\` must be a parameter of ${d.name}, of the same type`);
      }) : [];
      return { name: d.name, params, guard: guard?.name, guardParams };
    });
  // Without a transition there are no events, and the Event type would be empty, which TypeScript cannot declare.
  if (stateType && !transitions.length) fail("the spec defines `initial` but no transition: add a `pure def` from the state to the state, or drop `initial` to make it a library");
  // In a library, `withdraw` and `canWithdraw` are a component's functions for a machine elsewhere to build on.
  for (const g of stateType ? funs.filter((d) => /^can[A-Z]/.test(d.name)) : [])
    if (!transitions.some((t) => t.guard === g.name)) fail(`${g.name}: no transition named ${g.name[3].toLowerCase()}${g.name.slice(4)}`);
  const senders = transitions.flatMap((t) => t.params.filter((p) => p.name === SENDER));
  if (senders.some((p) => shape(p.type) !== shape(senders[0].type))) fail(`\`${SENDER}\` names who sent an event, so every transition that takes it takes the same type`);
  return { stateType, transitions, always, sometimes, steps, laws, sender: senders[0]?.type };
}
