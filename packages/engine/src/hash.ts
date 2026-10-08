// Stable hashing for configs, cache keys and ids (ME-004: runs are reproducible from seed + inputs).
import { createHash } from "node:crypto";

export function sha256(str: string): string {
  return createHash("sha256").update(str).digest("hex");
}

/** JSON.stringify with sorted object keys so hashes do not depend on key order. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter(k => o[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}
