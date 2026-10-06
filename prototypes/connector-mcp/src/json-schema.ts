// Minimal JSON Schema 2020-12 validator for the keyword subset our tool schemas use. Dependency-free
// and eval-free so it runs on Cloudflare Workers (Ajv compiles with `new Function`, which Workers
// forbid). Tests cross-check every output against the SDK client's Ajv validator as well.
import type { JsonSchema } from "./schemas.ts";

export interface ValidationResult { valid: boolean; errors: string[] }

const typeOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;

function matchesType(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  return actual === t || (t === "number" && actual === "integer");
}

export function validate(schema: JsonSchema, value: unknown, root: JsonSchema = schema, path = "$"): ValidationResult {
  const errors: string[] = [];
  const s = schema as any;
  const err = (m: string) => errors.push(`${path}: ${m}`);

  if (typeof s.$ref === "string") {
    const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
    const target = m ? (root as any).$defs?.[m[1]!] : undefined;
    if (!target) return { valid: false, errors: [`${path}: unresolvable $ref ${s.$ref}`] };
    return validate(target, value, root, path);
  }
  if ("const" in s && JSON.stringify(s.const) !== JSON.stringify(value)) err(`must equal ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.some((e: unknown) => JSON.stringify(e) === JSON.stringify(value))) err(`must be one of ${s.enum.join(", ")}`);
  if (s.type) {
    const types: string[] = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => matchesType(value, t))) { err(`must be ${types.join(" or ")}`); return { valid: false, errors }; }
  }
  if (s.oneOf) {
    const passing = (s.oneOf as JsonSchema[]).filter((sub) => validate(sub, value, root, path).valid).length;
    if (passing !== 1) err(`must match exactly one schema in oneOf (matched ${passing})`);
  }
  if (typeof value === "string") {
    const len = [...value].length;
    if (s.minLength !== undefined && len < s.minLength) err(`shorter than ${s.minLength}`);
    if (s.maxLength !== undefined && len > s.maxLength) err(`longer than ${s.maxLength}`);
    if (s.pattern && !new RegExp(s.pattern, "u").test(value)) err(`does not match ${s.pattern}`);
  }
  if (typeof value === "number") {
    if (s.minimum !== undefined && value < s.minimum) err(`less than ${s.minimum}`);
    if (s.maximum !== undefined && value > s.maximum) err(`greater than ${s.maximum}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) err(`fewer than ${s.minItems} items`);
    if (s.maxItems !== undefined && value.length > s.maxItems) err(`more than ${s.maxItems} items`);
    if (s.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) err("items must be unique");
    if (s.items) value.forEach((v, i) => errors.push(...validate(s.items, v, root, `${path}[${i}]`).errors));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (s.minProperties !== undefined && keys.length < s.minProperties) err(`needs at least ${s.minProperties} properties`);
    for (const r of s.required ?? []) if (!(r in obj)) err(`missing required property ${r}`);
    const props = s.properties ?? {};
    for (const k of keys) {
      if (k in props) errors.push(...validate(props[k], obj[k], root, `${path}.${k}`).errors);
      else if (s.additionalProperties === false) err(`unexpected property ${k}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Applies top-level `default`s (e.g. get_network_updates.limit = 5). */
export function withDefaults<T extends Record<string, unknown>>(schema: JsonSchema, value: T): T {
  const out: Record<string, unknown> = { ...value };
  for (const [k, p] of Object.entries((schema as any).properties ?? {})) {
    if (out[k] === undefined && p && typeof p === "object" && "default" in (p as object)) out[k] = (p as any).default;
  }
  return out as T;
}

/** Adapter so the SDK Server never instantiates Ajv (which needs `new Function`, blocked on Workers). */
export const workerSafeValidator = {
  getValidator<T>(schema: unknown) {
    return (input: unknown) => {
      const r = validate(schema as JsonSchema, input);
      return r.valid
        ? { valid: true as const, data: input as T, errorMessage: undefined }
        : { valid: false as const, data: undefined, errorMessage: r.errors.join("; ") };
    };
  },
};
