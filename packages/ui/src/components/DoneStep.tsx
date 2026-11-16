// spec/browserJoin.md, "The done step comes only from a saved profile with consent"
import type { ComponentProps } from "react";
import { StepFrame } from "./StepFrame.tsx";

export type DoneStepProps = Omit<ComponentProps<"section">, "children" | "title"> & {
  /** The first name that the server saved. */
  firstName: string;
  /** Tells the person to go back to the same chat; true when the person came from an agent's link. */
  agentReturn?: boolean;
};

/**
 * The join step after a saved profile.
 * @model spec/browserJoin.md
 */
export function DoneStep({ firstName, agentReturn = false, ...props }: DoneStepProps) {
  return (
    <StepFrame title={`You’re in, ${firstName}.`} {...props}>
      {agentReturn ? <p className="text-foreground">Go back to the same chat to finish setting up your profile.</p> : null}
    </StepFrame>
  );
}
