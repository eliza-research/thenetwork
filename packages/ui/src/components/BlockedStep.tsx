// spec/browserJoin.md, "The server answer decides between done, blocked and a new sign-in"
import type { ComponentProps } from "react";
import type { BlockReason } from "../../../core/src/generated/browserJoin.ts";
import { apiMessages } from "../api/client.ts";
import { Link } from "./Link.tsx";
import { StepFrame } from "./StepFrame.tsx";

export type BlockedStepProps = Omit<ComponentProps<"section">, "children" | "title"> & {
  /** Why the person cannot join, from the join machine. */
  reason: BlockReason;
  /** The site's own text for a reason, such as one that names the app. */
  messages?: Partial<Record<BlockReason, string>>;
  /** The text of the link back to the home page, such as "Back to peon.biz". */
  homeLabel: string;
  homeHref?: string;
};

const reasons: Readonly<Record<BlockReason, string>> = {
  NoBlock: apiMessages.unknown,
  UnderAge: apiMessages.under_age,
  InviteOnly: apiMessages.invite_only,
  InReview: apiMessages.review,
  NotValid: apiMessages.invalid,
  OtherReason: apiMessages.unknown,
};

/**
 * The join step that tells a person why they cannot join, with a way back home.
 * @model spec/browserJoin.md
 */
export function BlockedStep({ reason, messages, homeLabel, homeHref = "/", ...props }: BlockedStepProps) {
  return (
    <StepFrame title="We can't add you" {...props}>
      <p className="text-foreground">{messages?.[reason] ?? reasons[reason]}</p>
      <p>
        <Link href={homeHref}>{homeLabel}</Link>
      </p>
    </StepFrame>
  );
}
