import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import {
  PRODUCTION_BUCKETS,
  PRODUCTION_DOMAINS,
  provisionPagesSites,
  resolveDeployPolicy,
  resolveStateLayer,
} from "./deploy/alchemy-sites.ts";
import { assertStageGuard } from "./tools/vibestack/vibestack/alchemy.ts";

const THIRTY_FIVE_DAYS_SECONDS = 60 * 60 * 24 * 35;

export default Alchemy.Stack(
  "TheNetwork",
  {
    providers: Cloudflare.providers(),
    state: resolveStateLayer("alchemy/thenetwork/"),
  },
  Effect.gen(function* () {
    const stageName = yield* Alchemy.Stage;
    const { stageTarget, stageSlug, backendOrigin, commitSha } = resolveDeployPolicy(stageName);
    const isProduction = stageTarget.kind === "production";
    const isStaging = stageTarget.kind === "staging";
    const suffix = isProduction ? "" : `-${stageSlug}`;

    const photosBucketName = `ntwrk-photos${suffix}`;
    const backupsBucketName = `ntwrk-backups${suffix}`;
    const observatoryWorkerName = isProduction
      ? "network-observatory-production"
      : isStaging
        ? "network-observatory-staging"
        : `network-observatory-${stageSlug}`;
    const observatoryEnabled = process.env.OBSERVATORY_ENABLED === "true";
    const observatoryDomain =
      isProduction && observatoryEnabled
        ? process.env.OBSERVATORY_DOMAIN?.trim() || "console.ntwrk.party"
        : undefined;

    assertStageGuard(stageTarget, {
      resourceIds: {
        photosBucket: photosBucketName,
        backupsBucket: backupsBucketName,
        observatoryWorker: observatoryWorkerName,
      },
      domains: observatoryDomain ? [observatoryDomain] : [],
      productionIds: [...PRODUCTION_BUCKETS, "network-observatory-production"],
      productionDomains: PRODUCTION_DOMAINS,
    });

    const sites = yield* provisionPagesSites({ stageTarget, stageSlug, commitSha });

    const photosBucket = yield* Cloudflare.R2.Bucket("PhotosBucket", {
      name: photosBucketName,
      publicAccess: false,
    }).pipe(Alchemy.AdoptPolicy.adopt(true), Alchemy.RemovalPolicy.retain());

    const backupsBucket = yield* Cloudflare.R2.Bucket("BackupsBucket", {
      name: backupsBucketName,
      publicAccess: false,
      lifecycleRules: [
        {
          id: "expire-backups-35d",
          enabled: true,
          prefix: "",
          deleteObjectsTransition: {
            condition: {
              type: "Age",
              maxAge: THIRTY_FIVE_DAYS_SECONDS,
            },
          },
        },
      ],
    }).pipe(Alchemy.AdoptPolicy.adopt(true), Alchemy.RemovalPolicy.retain());

    const observatory = yield* Cloudflare.Worker("Observatory", {
      name: observatoryWorkerName,
      main: "./apps/observatory/deploy/worker.ts",
      compatibility: {
        date: "2026-09-28",
        flags: ["nodejs_compat"],
      },
      workersDev: false,
      observability: { enabled: true },
      ...(observatoryDomain ? { domain: observatoryDomain } : {}),
      env: {
        CONSOLE: Cloudflare.Container("ObservatoryConsole", {
          className: "ObservatoryConsole",
          context: ".",
          dockerfile: "deploy/backend/Dockerfile",
          instanceType: "standard-1",
          maxInstances: 1,
        }),
        PLATFORM_ENV: isProduction ? "production" : "staging",
        OBSERVATORY_ENABLED: observatoryEnabled ? "true" : "false",
        BUILD_ID: commitSha,
      },
    }).pipe(Alchemy.AdoptPolicy.adopt(true), Alchemy.RemovalPolicy.retain());

    return {
      stage: stageTarget.stage,
      backendOrigin,
      commitSha,
      sites,
      buckets: {
        photos: photosBucket.bucketName,
        backups: backupsBucket.bucketName,
      },
      observatory: {
        workerName: observatory.workerName,
        enabled: observatoryEnabled,
        ...(observatoryDomain ? { domain: observatoryDomain } : {}),
      },
    };
  }),
);
