import type { Env } from "./env.ts";
import { resolveSenderLine } from "@thenetwork/blooio";
import { APP_IDS, type AppId } from "../../core/src/types.ts";
import { agentSignupBlocked, declaredEnvironment } from "../../core/src/generated/bootPolicy.ts";
import { publicSignupUsesBrowser } from "../../core/src/generated/siteEnrollment.ts";

/** Provider-specific deployed requirements. Does not send or read credentials from anywhere else. */
export function otpConfigProblems(env: Env): string[] {
  if (env.OTP_PROVIDER === "twilio") return ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID"].filter(k => !env[k]);
  if (env.OTP_PROVIDER !== "blooio") return ["OTP_PROVIDER=twilio or blooio"];
  const missing = env.BLOOIO_API_KEY ? [] : ["BLOOIO_API_KEY"];
  try { if (!resolveSenderLine(env)) missing.push("BLOOIO_FROM"); } catch { missing.push("valid matching BLOOIO_FROM/BLOOIO_FROM_NUMBER"); }
  return missing;
}

/** The apps named in PLATFORM_PHONE_OTP_ONLY_APPS (a phone code with no browser challenge), as written. */
export const phoneCodeOnlyApps = (env: Env): string[] =>
  env.PLATFORM_PHONE_OTP_ONLY_APPS ? env.PLATFORM_PHONE_OTP_ONLY_APPS.split(",").map(app => app.trim()) : [];

/** The apps whose published signup skill asks for a phone code over direct HTTPS: every app without a browser Join form. */
export const agentSkillApps: readonly AppId[] = APP_IDS.filter(app => !publicSignupUsesBrowser(app));

/**
 * What a deployed process needs so that each published agent signup skill can finish, as one line;
 * empty when it may start. Both entry points (env.ts bootConfigProblems, deploy/backend loadConfig) call it.
 */
// spec/bootPolicy.md, "A deployed service lets each agent signup skill finish"
export function agentSignupProblems(env: Env): string[] {
  const listed = new Set(phoneCodeOnlyApps(env));
  const environment = declaredEnvironment(env.PLATFORM_ENV ?? "", env.NODE_ENV ?? "");
  const blocked = agentSkillApps.filter(app => agentSignupBlocked({
    environment, phoneCodeOnly: listed.has(app), blooioCodes: env.OTP_PROVIDER === "blooio", cloudSignIn: env.NETWORK_CLOUD_AUTH_ENABLED === "true",
  }));
  return blocked.length
    ? [`PLATFORM_PHONE_OTP_ONLY_APPS=${agentSkillApps.join(",")} with OTP_PROVIDER=blooio (agent signup cannot finish for ${blocked.join(", ")})`]
    : [];
}
