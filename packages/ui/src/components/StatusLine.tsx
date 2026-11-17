// spec/landingEntry.md, "A tile copies the prompt, opens its link, and the status line says what to do next"
import type { ComponentProps } from "react";
import type { AgentId, StatusLine as StatusValue } from "../../../core/src/generated/landingEntry.ts";
import { type LandingLinks, statusText } from "../brand/landing.ts";
import { cn } from "../lib/cn.ts";

export type StatusLineProps = Omit<ComponentProps<"p">, "children"> & {
  /** What the status line says. */
  status: StatusValue;
  /** The agent of the last tile press with the page script (`statusAgent` of the landing state); its message fills an agent status. */
  agent: AgentId;
  /** The join message and the shared line number that a Messages status names. */
  links: Pick<LandingLinks, "joinMessage" | "textLine">;
};

/**
 * The live line under the landing controls. It stays empty until the page script has something to say.
 * @model spec/landingEntry.md
 */
export function StatusLine({ status, agent, links, className, ...props }: StatusLineProps) {
  return (
    <p role="status" className={cn("min-h-6 text-sm text-muted-foreground", className)} {...props}>
      {statusText(status, agent, links)}
    </p>
  );
}
