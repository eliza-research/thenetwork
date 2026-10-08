// Supply chain and CD rules (audit sites-infra-18, SITE-10, SITE-14, SITE-23): every action pinned by
// a full commit SHA, wrangler pinned to one exact version everywhere, no `npx -y`, no "latest" in any
// package.json, .wrangler/ ignored, and the deploy workflow gated: production only from main behind
// the "production" environment, previews only for this repository's branches, all four sites.
//   bun test scripts
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");
const WORKFLOWS = readdirSync(join(REPO, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f)).map((f) => `.github/workflows/${f}`);

test("every action is pinned by a 40-hex commit SHA", () => {
  expect(WORKFLOWS.length).toBeGreaterThanOrEqual(2);
  for (const f of WORKFLOWS) {
    for (const m of read(f).matchAll(/uses:\s*([^\s#]+)/g)) {
      const ref = m[1]!;
      if (ref.startsWith("./")) continue;
      expect(ref, `${f}: ${ref}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    }
  }
});

test("service images are pinned by digest", () => {
  for (const f of WORKFLOWS) {
    for (const m of read(f).matchAll(/image:\s*(\S+)/g)) expect(m[1]!, f).toMatch(/@sha256:[0-9a-f]{64}$/);
  }
});

test("wrangler is one exact version in the guard script and the deploy workflow", () => {
  const sh = read("scripts/wrangler.sh");
  const pinned = sh.match(/^WRANGLER_VERSION="(\d+\.\d+\.\d+)"$/m)?.[1];
  expect(pinned).toBeDefined();
  expect(sh).toContain('exec bunx "wrangler@${WRANGLER_VERSION}" "$@"');
  expect(read(".github/workflows/deploy-sites.yml")).toContain(`WRANGLER_VERSION: "${pinned}"`);
  for (const f of [...WORKFLOWS, "scripts/wrangler.sh", "package.json"]) {
    expect(read(f), f).not.toMatch(/npx\s+-y|npx\s+--yes|wrangler@latest/);
  }
});

test("no package.json asks for 'latest'", () => {
  const files = ["package.json", ...["packages", "prototypes"].flatMap((d) => readdirSync(join(REPO, d)).map((p) => `${d}/${p}/package.json`))];
  for (const f of files) {
    let body: string;
    try {
      body = read(f);
    } catch {
      continue;
    }
    expect(body, f).not.toMatch(/":\s*"latest"/);
  }
});

test(".wrangler/ and .dev.vars are ignored", () => {
  const ignore = read(".gitignore").split("\n").map((l) => l.trim());
  expect(ignore).toContain(".wrangler/");
  expect(ignore).toContain(".dev.vars");
  expect(ignore).toContain("dist/");
});

test("CI is secret-free, runs sites, deploy and scripts tests, and requires Postgres", () => {
  const ci = read(".github/workflows/ci.yml");
  expect(ci).not.toMatch(/\$\{\{\s*secrets\./);
  expect(ci).toMatch(/bun test [^\n]*\bsites\b[^\n]*\bdeploy\b[^\n]*\bscripts\b/);
  expect(ci).toContain("tsc --noEmit -p sites/tsconfig.json");
  expect(ci).toContain('REQUIRE_PG: "1"');
  expect(ci).toContain("bun run scripts/require-pg.ts");
  expect(ci).toContain("54339:5432");
  expect(ci).not.toContain("pull_request_target");
});

test("deploy workflow: Pages projects, production only from main behind the production environment, no previews", () => {
  const cd = read(".github/workflows/deploy-sites.yml");
  expect(cd).not.toContain("pull_request_target");
  expect(cd).toContain("environment: production");
  expect(cd).toContain("github.ref == 'refs/heads/main'");
  // Previews ran pull-request code next to a deploy token and the production proxy secret (audit P1).
  expect(cd).not.toMatch(/versions upload|preview-alias|environment: preview/);
  expect(cd).toContain("needs: test");
  expect(cd).toContain("bun run deploy/smoke.ts");
  // Founder decision 8: wrangler pages deploy <dist> --project-name <name> --branch main, never --force.
  expect(cd).toMatch(/pages deploy "\$DIR" --project-name "\$PROJECT" --branch main/);
  expect(cd).not.toMatch(/--force|wrangler-action/);
  for (const [dir, project] of [["ntwrk.love", "ntwrk-love"], ["slop.date", "slop-date"], ["peon.biz", "peon-biz"], ["friends.help", "friends-help"]]) {
    expect(cd, dir).toContain(`dir: ${dir}, project: ${project}`);
  }
  // Another account is a variable, never hard-coded per site; the token is only in the deploy step.
  expect(cd).toContain("vars.CLOUDFLARE_ACCOUNT_ID || env.NTWRK_ACCOUNT_ID");
  expect(cd.match(/secrets\.CLOUDFLARE_API_TOKEN/g)?.length).toBe(1);
  expect(cd).not.toContain("secrets.PLATFORM_PROXY_SECRET");
});

test("wrangler.toml: every site is a Pages project with no Worker routes or account id", () => {
  for (const [d, project] of [["ntwrk.love", "ntwrk-love"], ["slop.date", "slop-date"], ["peon.biz", "peon-biz"], ["friends.help", "friends-help"]]) {
    const t = read(`sites/${d}/wrangler.toml`);
    expect(t, d).toMatch(new RegExp(`^name = "${project}"$`, "m"));
    expect(t, d).toMatch(/^pages_build_output_dir = "\.\/dist"$/m);
    expect(t, d).not.toMatch(/^(routes|main|account_id|workers_dev)\b/m);
  }
});
