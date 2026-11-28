import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { makeBucketState } from "alchemy/State/BucketState";
import { State, StateStoreError } from "alchemy/State/State";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import { APP_IDS, APPS, type AppId } from "../packages/platform/src/apps.ts";
import {
  assertStageGuard,
  hashAssetDirectory,
  makeR2BucketObjects,
  resolveStage,
  type StageTarget,
} from "../tools/vibestack/vibestack/alchemy.ts";
import { RUN_WORKER_FIRST } from "./router.ts";
import { smoke } from "./smoke.ts";

export interface PagesSiteSpec {
  readonly app: AppId;
  readonly domain: string;
  readonly project: string;
}

export const PAGES_SITES: readonly PagesSiteSpec[] = APP_IDS.map((app) => {
  const domain = APPS[app].domain;
  return {
    app,
    domain,
    project: domain.replaceAll(".", "-"),
  };
});

export const REPO_ROOT = path.resolve(import.meta.dirname, "..");
export const WRANGLER_VERSION = "4.136.3";
export const DEFAULT_BACKEND_ORIGIN = "https://api.ntwrk.party";

export const PRODUCTION_PROJECT_NAMES = [
  "ntwrk-party",
  "slop-date",
  "peon-biz",
  "friends-help",
] as const;

export const PRODUCTION_DOMAINS = [
  "ntwrk.party",
  "www.ntwrk.party",
  "slop.date",
  "peon.biz",
  "friends.help",
  "console.ntwrk.party",
  "api.ntwrk.party",
] as const;

export const PRODUCTION_BUCKETS = [
  "ntwrk-photos",
  "ntwrk-backups",
] as const;

export type StateBackendConfig =
  | { readonly kind: "local" }
  | { readonly kind: "cloudflare"; readonly accountId?: string }
  | {
      readonly kind: "r2";
      readonly accountId: string;
      readonly bucket: string;
      readonly accessKeyId: string;
      readonly secretAccessKey: string;
      readonly prefix: string;
    };

function trimmedEnv(env: Readonly<Record<string, string | undefined>>, key: string): string | undefined {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function resolveStateBackendConfig(
  stageName: string,
  defaultPrefix: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): StateBackendConfig {
  const stageTarget = resolveStage({ stage: stageName, cwd: REPO_ROOT, env });
  if (stageTarget.kind === "dev" || stageTarget.kind === "test") {
    return { kind: "local" };
  }
  const accountId = trimmedEnv(env, "CLOUDFLARE_ACCOUNT_ID");
  if (trimmedEnv(env, "ALCHEMY_STATE_STORE") === "cloudflare") {
    return { kind: "cloudflare", ...(accountId ? { accountId } : {}) };
  }
  const bucket = trimmedEnv(env, "R2_STATE_BUCKET");
  const accessKeyId = trimmedEnv(env, "R2_STATE_ACCESS_KEY_ID");
  const secretAccessKey = trimmedEnv(env, "R2_STATE_SECRET_ACCESS_KEY");
  if (bucket && accountId && accessKeyId && secretAccessKey) {
    return {
      kind: "r2",
      accountId,
      bucket,
      accessKeyId,
      secretAccessKey,
      prefix: trimmedEnv(env, "R2_STATE_PREFIX") ?? defaultPrefix,
    };
  }
  return { kind: "local" };
}

export function resolveStateLayer(prefix: string) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const stageName = yield* Alchemy.Stage;
      const config = resolveStateBackendConfig(stageName, prefix, process.env);
      if (config.kind === "local") {
        return Alchemy.localState();
      }
      if (config.kind === "cloudflare") {
        return Cloudflare.state({
          ...(config.accountId ? { accountId: config.accountId } : {}),
        });
      }
      const objects = makeR2BucketObjects<StateStoreError>(
        {
          kind: "s3",
          accountId: config.accountId,
          bucket: config.bucket,
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        {
          tryPromise: Effect.tryPromise,
          makeError: ({ message, cause, status }) =>
            new StateStoreError({
              message,
              ...(cause ? { cause } : {}),
              ...(status !== undefined ? { http: { status } } : {}),
            }),
        },
      );
      return Layer.effect(
        State,
        Effect.gen(function* () {
          const context = yield* Effect.context();
          const scope = yield* Effect.scope;
          const make = makeBucketState({
            id: "r2",
            label: "Cloudflare R2",
            prefix: config.prefix,
            objects: Effect.succeed(objects),
          }).pipe(Scope.provide(scope), Effect.provideContext(context));
          return yield* Effect.cached(make);
        }),
      );
    }),
  );
}

export function validateBackendOrigin(raw: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(`Invalid declared HTTPS BACKEND_ORIGIN: ${raw}`);
  }
  return url.origin;
}

export function resolveCommitSha(): string {
  const raw = (process.env.BUILD_ID ?? process.env.GITHUB_SHA ?? "").trim();
  return /^[a-f0-9]{40}$/.test(raw) ? raw : "0".repeat(40);
}

export function dnsStageSlug(stage: string, maxLen = 28): string {
  const cleaned = stage
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return cleaned.length > 0 ? cleaned : "dev";
}

export function resolveDeployPolicy(stageName: string): {
  readonly stageTarget: StageTarget;
  readonly stageSlug: string;
  readonly backendOrigin: string;
  readonly commitSha: string;
} {
  const stageTarget = resolveStage({ stage: stageName, cwd: REPO_ROOT });
  if (stageTarget.kind === "preview") {
    throw new Error(
      `Stage "${stageTarget.stage}" rejected: pull-request preview deployments are disabled by thenetwork security policy`,
    );
  }
  const backendOrigin = validateBackendOrigin(
    process.env.BACKEND_ORIGIN?.trim() || DEFAULT_BACKEND_ORIGIN,
  );
  const commitSha = resolveCommitSha();
  const stageSlug = dnsStageSlug(stageTarget.stage);
  return { stageTarget, stageSlug, backendOrigin, commitSha };
}

export function resolvePagesTarget(
  site: PagesSiteSpec,
  stageTarget: StageTarget,
  stageSlug: string,
): {
  readonly projectName: string;
  readonly productionBranch: string;
  readonly branch: string;
} {
  const isProduction = stageTarget.kind === "production";
  const branch = isProduction ? "main" : stageSlug;
  return {
    projectName: isProduction ? site.project : `${site.project}-${stageSlug}`,
    productionBranch: branch,
    branch,
  };
}

type CommandRunner = (command: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<void>;

function runCommand(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${String(code)}\n${output.slice(-2000)}`));
    });
  });
}

export function createWranglerWarmup(runner: CommandRunner = runCommand) {
  let pending: Promise<void> | undefined;
  return (env: NodeJS.ProcessEnv = process.env): Promise<void> => {
    if (!pending) {
      pending = runner("pnpm", ["dlx", `wrangler@${WRANGLER_VERSION}`, "--version"], env).catch((err) => {
        pending = undefined;
        throw err;
      });
    }
    return pending;
  };
}

const ensureWranglerReady = createWranglerWarmup();

export const DeployPagesSite = Alchemy.Action(
  "DeployPagesSite",
  (input: {
    readonly projectName: string;
    readonly dir: string;
    readonly app: string;
    readonly assetHash: string;
    readonly commitSha: string;
    readonly branch: string;
  }) =>
    Effect.tryPromise(async () => {
      if (process.env.NTWRK_ALLOW_DEPLOY !== "1") {
        throw new Error(
          `Refusing to deploy Pages project "${input.projectName}": set NTWRK_ALLOW_DEPLOY=1 after founder approval`,
        );
      }
      if (!process.env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
        throw new Error("CLOUDFLARE_ACCOUNT_ID is required to deploy Cloudflare Pages");
      }
      const workerFile = path.join(input.dir, "_worker.js");
      const routesFile = path.join(input.dir, "_routes.json");
      if (!existsSync(workerFile) || !existsSync(routesFile)) {
        throw new Error(`Missing _worker.js or _routes.json in ${input.dir}; run pnpm run sites:build first`);
      }
      await ensureWranglerReady(process.env);
      const args = [
        "dlx",
        `wrangler@${WRANGLER_VERSION}`,
        "pages",
        "deploy",
        input.dir,
        "--project-name",
        input.projectName,
        "--branch",
        input.branch,
        "--commit-dirty=false",
      ];
      if (/^[a-f0-9]{40}$/.test(input.commitSha) && input.commitSha !== "0".repeat(40)) {
        args.push("--commit-hash", input.commitSha);
      }
      await runCommand("pnpm", args, process.env);
      return {
        deployed: true,
        projectName: input.projectName,
        app: input.app,
        assetHash: input.assetHash,
        commitSha: input.commitSha,
      };
    }),
);

export const VerifyPagesSite = Alchemy.Action(
  "VerifyPagesSite",
  (input: {
    readonly subdomain: string;
    readonly app: string;
    readonly assetHash: string;
    readonly commitSha: string;
    readonly deployed: boolean;
    readonly backendLive: boolean;
  }) =>
    Effect.tryPromise(async () => {
      if (!input.deployed) {
        throw new Error(`Deployment did not complete for ${input.app}`);
      }
      const siteUrl = input.subdomain.startsWith("http")
        ? input.subdomain
        : `https://${input.subdomain}`;
      const checks = await smoke(siteUrl, input.app, { api: input.backendLive });
      const failed = checks.filter((check) => !check.ok);
      if (failed.length > 0) {
        const details = failed.map((check) => `${check.name} (${check.detail})`).join("; ");
        throw new Error(`Smoke verification failed for ${siteUrl} (${input.app}): ${details}`);
      }
      return {
        verified: true,
        siteUrl,
        app: input.app,
        assetHash: input.assetHash,
        commitSha: input.commitSha,
        checksPassed: checks.length,
      };
    }).pipe(
      Effect.retry({
        schedule: Schedule.exponential("1 second"),
        times: 5,
      }),
    ),
);

export function provisionPagesSites(options: {
  readonly stageTarget: StageTarget;
  readonly stageSlug: string;
  readonly commitSha: string;
  readonly backendOrigin?: string;
  readonly isDev?: boolean;
}) {
  return Effect.gen(function* () {
    const { stageTarget, stageSlug, commitSha } = options;
    const isProduction = stageTarget.kind === "production";
    const isDev = options.isDev ?? (yield* Alchemy.ALCHEMY_DEV.pipe(Effect.orElseSucceed(() => false)));
    const backendOrigin = options.backendOrigin ?? DEFAULT_BACKEND_ORIGIN;
    const backendLive = process.env.BACKEND_LIVE === "true";
    const proxySecret = trimmedEnv(process.env, "PLATFORM_PROXY_SECRET");
    const siteIds: Record<string, string> = {};
    const siteDomains: string[] = [];

    for (const site of PAGES_SITES) {
      const target = resolvePagesTarget(site, stageTarget, stageSlug);
      siteIds[site.app] = target.projectName;
      if (isProduction) {
        siteDomains.push(site.domain);
      }
    }

    assertStageGuard(stageTarget, {
      resourceIds: siteIds,
      domains: siteDomains,
      productionIds: PRODUCTION_PROJECT_NAMES,
      productionDomains: PRODUCTION_DOMAINS,
    });

    const outputs: Record<
      string,
      {
        readonly projectName: string;
        readonly subdomain: unknown;
        readonly assetHash: string;
        readonly deployed: unknown;
        readonly verified: unknown;
      }
    > = {};

    for (const site of PAGES_SITES) {
      const target = resolvePagesTarget(site, stageTarget, stageSlug);
      const distDir = path.resolve(REPO_ROOT, "sites", site.domain, "dist");
      const workerFile = path.join(distDir, "_worker.js");
      const hasBuiltDist = existsSync(distDir);
      if (isDev) {
        if (existsSync(workerFile)) {
          const assets = hashAssetDirectory(distDir);
          const localSite = yield* Cloudflare.Worker(`Site_${site.app}`, {
            main: workerFile,
            bundle: false,
            workersDev: true,
            assets: {
              directory: assets.directory,
              hash: assets.hash,
              runWorkerFirst: [...RUN_WORKER_FIRST],
            },
            env: {
              APP_ID: site.app,
              SITE_HOST: site.domain,
              BACKEND_ORIGIN: backendOrigin,
              ...(proxySecret ? { PLATFORM_PROXY_SECRET: proxySecret } : {}),
            },
          });
          outputs[site.app] = {
            projectName: target.projectName,
            subdomain: localSite.url,
            assetHash: assets.hash,
            deployed: false,
            verified: false,
          };
        } else {
          outputs[site.app] = {
            projectName: target.projectName,
            subdomain: undefined,
            assetHash: "unbuilt",
            deployed: false,
            verified: false,
          };
        }
        continue;
      }

      if (!hasBuiltDist && process.env.NTWRK_ALLOW_DEPLOY === "1") {
        throw new Error(`Built site directory missing: ${distDir}. Run pnpm run sites:build first.`);
      }
      const assets = hasBuiltDist
        ? hashAssetDirectory(distDir)
        : { directory: distDir, path: distDir, hash: "unbuilt", fileCount: 0, totalBytes: 0 };

      const project = yield* Cloudflare.Pages.Project(`Pages_${site.app}`, {
        name: target.projectName,
        productionBranch: target.productionBranch,
      }).pipe(Alchemy.AdoptPolicy.adopt(true), Alchemy.RemovalPolicy.retain());

      const deployment = yield* DeployPagesSite(`Deploy_${site.app}`, {
        projectName: project.name,
        dir: assets.directory,
        app: site.app,
        assetHash: assets.hash,
        commitSha,
        branch: target.branch,
      });

      const verification = yield* VerifyPagesSite(`Verify_${site.app}`, {
        subdomain: project.subdomain,
        app: site.app,
        assetHash: deployment.assetHash,
        commitSha: deployment.commitSha,
        deployed: deployment.deployed,
        backendLive,
      });

      outputs[site.app] = {
        projectName: target.projectName,
        subdomain: project.subdomain,
        assetHash: assets.hash,
        deployed: deployment.deployed,
        verified: verification.verified,
      };
    }

    return outputs;
  });
}
