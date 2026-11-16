// spec/browserJoin.md, "The page shows the step that the current session allows"
import type { ComponentProps } from "react";
import { StepFrame } from "./StepFrame.tsx";

export type MemberStepProps = Omit<ComponentProps<"section">, "children" | "title">;

/**
 * The join step for a person who is already a member.
 * @model spec/browserJoin.md
 */
export function MemberStep(props: MemberStepProps) {
  return (
    <StepFrame title="You're already in." {...props}>
      <p className="text-foreground">Return to your agent.</p>
    </StepFrame>
  );
}
