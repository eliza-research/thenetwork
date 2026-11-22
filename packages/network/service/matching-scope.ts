import { matchingSwitchAllowed } from "../../core/src/generated/runtimeUnit.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { isProduction, type Env } from "../../platform/src/env.ts";
import { liveFlag } from "./channel.ts";

export const networkMatchingAllowed = (env: Env, app: AppId, registryAllows: boolean): boolean =>
  matchingSwitchAllowed(registryAllows, app, isProduction(env), env[liveFlag(app)] === "1");
