import { initial } from "../../../../core/src/generated/staffReview.ts";
import type { ComponentMeta } from "../../lib/meta.ts";
import { ReviewActions, type ReviewCardProps, ReviewPerson } from "./ReviewCard.tsx";

const ctl = { ...initial, cardKey: "opp-1", revision: 1 };
const reasons = [
  { code: "bad_fit", label: "Bad fit" },
  { code: "unsafe", label: "Unsafe" },
  { code: "other", label: "Other" },
];

export const meta: ComponentMeta<ReviewCardProps> = {
  args: {
    ctl,
    selected: true,
    title: "Maya + Jon",
    meta: "intro · social · Engine",
    score: "score 0.82",
    due: <span className="text-sm text-warn">Due in 42m</span>,
    children: (
      <>
        <ReviewPerson name="Maya Chen" place="Astoria" told="Jon also climbs on Thursdays." />
        <ReviewPerson name="Jon Park" place="Long Island City" flags={[{ tone: "warn", label: "Watch" }]} told="Maya also climbs on Thursdays." />
        <ReviewActions
          ctl={ctl}
          reasons={reasons}
          swaps={[{ id: "m2", name: "Jon" }]}
          alternates={2}
          edits={[]}
          plan="Climb at Brooklyn Boulders"
          note=""
          onNoteChange={() => undefined}
          onEditChange={() => undefined}
          onPlanChange={() => undefined}
          onApprove={() => undefined}
          onToggleMode={() => undefined}
          onLeaveMode={() => undefined}
          onReject={() => undefined}
          onReroll={() => undefined}
        />
      </>
    ),
  },
  examples: {
    Closed: { selected: false },
    Rejecting: { ctl: { ...ctl, mode: "RejectReview" } },
  },
};
