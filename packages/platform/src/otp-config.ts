import type { Env } from "./env.ts";
import { resolveSenderLine } from "@thenetwork/blooio";

/** Provider-specific deployed requirements. Does not send or read credentials from anywhere else. */
export function otpConfigProblems(env: Env): string[] {
  if (env.OTP_PROVIDER === "twilio") return ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID"].filter(k => !env[k]);
  if (env.OTP_PROVIDER !== "blooio") return ["OTP_PROVIDER=twilio or blooio"];
  const missing = env.BLOOIO_API_KEY ? [] : ["BLOOIO_API_KEY"];
  try { if (!resolveSenderLine(env)) missing.push("BLOOIO_FROM"); } catch { missing.push("valid matching BLOOIO_FROM/BLOOIO_FROM_NUMBER"); }
  return missing;
}

