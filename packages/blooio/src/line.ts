// The Network's sending line. +18087881821 is the founder's Network line on the Blooio account.
//
// Env: BLOOIO_FROM is the canonical name. BLOOIO_FROM_NUMBER (the name .env.example used to document) is
// accepted as an alias. If both are set they must be the same number after E.164 normalization.

import { toE164 } from "./phone.ts";

export const NETWORK_LINE = "+18087881821";

export function resolveSenderLine(env: Record<string, string | undefined> = process.env): string | undefined {
  const a = env.BLOOIO_FROM?.trim() || undefined;
  const b = env.BLOOIO_FROM_NUMBER?.trim() || undefined;
  const na = a ? toE164(a) : undefined;
  const nb = b ? toE164(b) : undefined;
  if (a && !na) throw new Error("BLOOIO_FROM is not a valid E.164 phone number");
  if (b && !nb) throw new Error("BLOOIO_FROM_NUMBER is not a valid E.164 phone number");
  if (na && nb && na !== nb) throw new Error("BLOOIO_FROM and BLOOIO_FROM_NUMBER are both set and differ; set only BLOOIO_FROM");
  return na ?? nb ?? undefined;
}
