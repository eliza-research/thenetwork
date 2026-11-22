// spec/browserJoin.md, "The page sends a number only when it is valid and the security check passed"
import { type ComponentProps, useCallback } from "react";
import type { CheckState } from "../../../core/src/generated/browserJoin.ts";
import { mountTurnstile } from "../api/turnstile.ts";
import { cn } from "../lib/cn.ts";
import { Spinner } from "./Spinner.tsx";

export type SecurityCheckProps = Omit<ComponentProps<"div">, "children"> & {
  /** The state of the check, from the join machine. */
  check: CheckState;
  /** The security check key; with "" no widget loads and only the state shows. */
  siteKey: string;
  /** The widget passed and gave a token for one request. Keep it stable: a new function shows a new widget. */
  onPassed: (token: string) => void;
  /** The widget or its script failed. */
  onFailed: () => void;
  /** The token expired before it was used. */
  onExpired: () => void;
};

const labels: Readonly<Record<Exclude<CheckState, "NoCheck">, string>> = {
  CheckRunning: "Security check running",
  CheckPassed: "Security check passed",
  CheckBroken: "Security check failed",
};

/**
 * Holds the security check widget of the phone step and shows the state of the check by an icon.
 * Give it a new `key` when the machine spends the check, so that a new widget gives a new token.
 * @model spec/browserJoin.md
 */
export function SecurityCheck({ check, siteKey, onPassed, onFailed, onExpired, className, ...props }: SecurityCheckProps) {
  const host = useCallback(
    (element: HTMLDivElement | null) => (element && siteKey ? mountTurnstile(element, siteKey, { onPassed, onFailed, onExpired }) : undefined),
    [siteKey, onPassed, onFailed, onExpired],
  );
  if (check === "NoCheck") return null;
  return (
    <div className={cn("flex items-center gap-3", className)} {...props}>
      <div ref={host} />
      {check === "CheckRunning" ? <Spinner size="sm" label={labels.CheckRunning} className="text-muted-foreground" /> : null}
      {check === "CheckPassed" ? (
        <svg role="img" aria-label={labels.CheckPassed} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-ok">
          <path d="m3 8.5 3.5 3.5 6.5-8" />
        </svg>
      ) : null}
      {check === "CheckBroken" ? (
        <svg role="img" aria-label={labels.CheckBroken} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4 text-destructive">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      ) : null}
    </div>
  );
}
