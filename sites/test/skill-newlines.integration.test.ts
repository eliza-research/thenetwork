// Build the real sites from isolated LF and CRLF source trees. Git can use either
// line ending for SKILL.md; discovery metadata and the landing prompt need both.
import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

test("production site builds publish skills with LF or CRLF source files", async () => {
  const root = mkdtempSync(join(tmpdir(), "site-skill-newlines-"));
  const repo = join(import.meta.dir, "../..");
  try {
    for (const path of ["sites", "deploy", "packages/core", "packages/platform"]) {
      cpSync(join(repo, path), join(root, path), {
        recursive: true,
        filter: path => !["node_modules", "dist", "test"].includes(basename(path)),
      });
    }
    const { SITES, buildSite } = await import(pathToFileURL(join(root, "sites/sites.ts")).href) as typeof import("../sites.ts");
    for (const ending of ["\n", "\r\n"]) {
      const label = ending === "\n" ? "LF" : "CRLF";
      for (const site of SITES) {
        const path = join(root, "sites/skills", site.skill, "SKILL.md");
        writeFileSync(path, readFileSync(path, "utf8").replace(/\r?\n/g, ending));
      }
      for (const site of SITES) {
        const out = join(root, "built", label, site.domain);
        const result = await buildSite(site, out, { DEPLOY_TARGET: "production" });
        expect(result, `${label} ${site.domain}`).toMatchObject({ ok: true });
        const skill = readFileSync(join(out, "SKILL.md"), "utf8");
        const index = JSON.parse(readFileSync(join(out, ".well-known/agent-skills/index.json"), "utf8"));
        const entry = index.skills.find((x: { name: string }) => x.name === site.skill);
        expect(entry.description.length).toBeGreaterThan(20);
        expect(entry.digest).toBe(`sha256:${createHash("sha256").update(skill).digest("hex")}`);
        expect(readFileSync(join(out, ".well-known/agent-skills", site.skill, "SKILL.md"), "utf8")).toBe(skill);
        expect(readFileSync(join(out, "index.html"), "utf8")).not.toContain("{{AGENTS}}");
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
