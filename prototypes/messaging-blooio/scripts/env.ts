// Load BLOOIO_* from the repo-root .env when not already in the environment. Never prints values.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadRootEnv(): void {
  const path = resolve(import.meta.dir, "../../../.env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, v] = m;
    if (process.env[k] === undefined) process.env[k] = v.replace(/^['"]|['"]$/g, "");
  }
}

export function redact(s: string | undefined | null): string {
  if (!s) return "(none)";
  return s.length <= 8 ? "****" : `${s.slice(0, 4)}…(${s.length} chars)`;
}
