// spec/landingEntry.md, "The agent row lists nine agents in a fixed order, each with a kind, a name, a logo and a link"
import type { ComponentProps } from "react";
import { type AgentId, agentName } from "../../../core/src/generated/landingEntry.ts";
import { agentLogoDrawings } from "../brand/agentLogos.ts";
import { cn } from "../lib/cn.ts";

export type AgentLogoProps = Omit<ComponentProps<"svg">, "children"> & {
  /** The agent whose logo to draw. */
  agent: AgentId;
};

/**
 * The monochrome logo of an agent, drawn in the current text color. Its accessible name is the agent's name; pass `aria-hidden` where a control already names the agent.
 * @model spec/landingEntry.md
 */
export function AgentLogo({ agent, className, ...props }: AgentLogoProps) {
  const drawing = agentLogoDrawings[agent];
  const hidden = props["aria-hidden"] === true || props["aria-hidden"] === "true";
  return (
    <svg
      viewBox={drawing.viewBox}
      fill="currentColor"
      fillRule={drawing.evenOdd ? "evenodd" : undefined}
      role={hidden ? undefined : "img"}
      aria-label={hidden ? undefined : agentName(agent)}
      className={cn("size-5 shrink-0", className)}
      {...props}
    >
      {drawing.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
