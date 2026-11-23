import { initial } from "../../../../core/src/generated/consoleWorkspace.ts";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { HeldItemCardProps } from "./HeldItemCard.tsx";

const held = { ...initial.held, status: "HeldWaiting" as const };

export const meta: ComponentMeta<HeldItemCardProps> = {
  args: {
    held,
    kind: "leak",
    who: "Maya Chen",
    reasons: "names a workplace",
    at: "Nov 14, 3:20 PM",
    text: "Jon works at the bakery on 5th Ave.",
    actionsShown: true,
    reason: "",
  },
  examples: {
    "Reason ready": { held: { ...held, reasonReady: true }, reason: "Checked: no private fact", canRelease: true, canReject: true },
    "Hidden minor text": { held: { ...held, minorHidden: true }, text: undefined },
    Photo: { kind: "photo", held: { ...held, photo: true, reasonReady: true }, reason: "Check the photo", canLoadPhoto: true, text: undefined },
  },
};
