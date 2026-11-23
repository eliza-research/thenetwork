import { spawnSync } from "node:child_process";
import { MODEL_DIR, modelName, modelNames, modelSource } from "./quint-check.ts";

const sharedFiles = new Set([
  ".github/workflows/quint.yml",
  ".nvmrc",
  ".npmrc",
  ".pnpmfile.cjs",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "packages/core/src/runtime/process.ts",
  "packages/core/src/runtime/streams.ts",
  "scripts/quint-check.ts",
  "scripts/quint-ci-plan.ts",
  "tools/vibestack/.npmrc",
  "tools/vibestack/.pnpmfile.cjs",
  "tools/vibestack/package.json",
  "tools/vibestack/pnpm-lock.yaml",
  "tools/vibestack/pnpm-workspace.yaml",
  "tools/vibestack/vibestack/simulator.ts",
]);

function plan(base: string): { reason: string; models?: string[] } {
  if (!/^[0-9a-f]{40}$/.test(base) || /^0+$/.test(base)) return { reason: "No comparison base" };
  const changed = spawnSync("git", ["diff", "--name-status", "--no-renames", "-z", base, "HEAD"], { encoding: "utf8" });
  if (changed.status !== 0) return { reason: "Comparison base is unavailable" };

  const paths = changed.stdout.split("\0");
  const affected: string[] = [];
  for (let at = 0; at + 1 < paths.length; at += 2) {
    const [status, file] = paths.slice(at, at + 2);
    if (sharedFiles.has(file) || file.startsWith(".github/actions/setup-quint/")) return { reason: `Shared input changed: ${file}` };
    if (!file.startsWith(`${MODEL_DIR}/`)) continue;
    const model = modelName(file.slice(MODEL_DIR.length + 1));
    if (!model) continue;
    if (status !== "A" && status !== "M") return { reason: `Model was removed or replaced: ${model}` };
    affected.push(model);
  }
  if (!affected.length) return { reason: "No affected standalone models", models: [] };

  try {
    if (modelNames().some((name) => /\bimport\b/.test(modelSource(name)))) {
      return { reason: "Model imports require the full suite" };
    }
  } catch {
    return { reason: "A model could not be read for selection" };
  }
  return { reason: `Affected models: ${affected.join(", ")}`, models: affected };
}

const { reason, models } = plan(process.argv[2] ?? "");
console.error(`Quint CI: ${reason}${models ? "" : ". Run every model."}`);
console.log(`run=${models?.length !== 0}\nmodels=${models?.join(" ") ?? ""}`);
