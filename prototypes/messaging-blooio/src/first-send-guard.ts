/** Guard for scripts/first-send.ts: both --to (E.164) and --confirm are mandatory. Returns an error string or null. */
export function checkFirstSendArgs(v: { to?: string; confirm?: boolean }): string | null {
  if (!v.to || !v.confirm) return "Refusing to send: both --to <your own E.164 number> and --confirm are required.";
  if (!/^\+[1-9]\d{7,14}$/.test(v.to)) return `Refusing to send: --to must be E.164 (e.g. +14155550123), got ${v.to}`;
  return null;
}
