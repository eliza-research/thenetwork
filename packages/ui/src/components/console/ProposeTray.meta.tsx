import type { ComponentMeta } from "../../lib/meta.ts";
import type { ProposeTrayProps } from "./ProposeTray.tsx";

export const meta: ComponentMeta<ProposeTrayProps> = {
  args: {
    phase: "TrayIdle",
    picks: [
      { id: "m1", name: "Maya Chen" },
      { id: "m2", name: "Jon Park", busy: true },
    ],
    formShown: true,
    group: false,
    canPropose: true,
    sparksLeft: 3,
    categories: ["social", "professional", "hobby", "help", "romance", "growth", "events"],
    category: "social",
    objective: "",
    why: "",
  },
  examples: {
    "One pick": { picks: [{ id: "m1", name: "Maya Chen" }], formShown: false, canPropose: false },
    "Group of three": {
      picks: [
        { id: "m1", name: "Maya Chen" },
        { id: "m2", name: "Jon Park" },
        { id: "m4", name: "Ana Ruiz" },
      ],
      group: true,
    },
    "Minor picked": { picks: [{ id: "m1", name: "Maya Chen" }, { id: "m3", name: "Sam Ortiz", minor: true }], minorPicked: true, canPropose: false },
  },
};
