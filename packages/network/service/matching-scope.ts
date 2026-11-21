// spec/runtimeUnit.md, "Matching runs for an app only inside its launch scope"
// The one reading of whether a network may run matching. The service builds each runtime with it, and its
// /health reports it; the admin console shows that value and the game console asks the same decision.
import { matchingSwitchAllowed } from "../../core/src/generated/runtimeUnit.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { isProduction, type Env } from "../../platform/src/env.ts";
import { liveFlag } from "./channel.ts";

export const networkMatchingAllowed = (env: Env, app: AppId, registryAllows: boolean): boolean =>
  matchingSwitchAllowed(registryAllows, app, isProduction(env), env[liveFlag(app)] === "1");
