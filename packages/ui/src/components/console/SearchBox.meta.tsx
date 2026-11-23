import type { ComponentMeta } from "../../lib/meta.ts";
import type { SearchBoxProps } from "./SearchBox.tsx";

export const meta: ComponentMeta<SearchBoxProps> = {
  args: {
    value: "ma",
    groups: "NamesAndPlaces",
    hits: [
      { key: "m1", label: "Maya Chen", meta: "Astoria" },
      { key: "n1", label: "Manhattan Valley", meta: "Manhattan" },
    ],
  },
  examples: {
    "Conversation search": { conversationSearch: true },
    "Conversation results": {
      conversation: { query: "ma", hits: [{ key: "c1", label: "Maya Chen", meta: "Nov 3, 4:12 PM · Network", snippet: "Are you free Thursday evening?" }] },
    },
    "Conversation loading": { conversation: { query: "ma" } },
    Closed: { value: "m", groups: "NoHits" },
  },
};
