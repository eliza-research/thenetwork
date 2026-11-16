import type { ComponentMeta } from "../../lib/meta.ts";
import { Select, SelectItem } from "../Select.tsx";
import { FilterBarFocus, type FilterBarProps } from "./FilterBar.tsx";
import { Segments } from "./Segments.tsx";

const select = (label: string) => (
  <Select className="w-32" aria-label={label} defaultValue="all">
    <SelectItem value="all">All</SelectItem>
  </Select>
);

export const meta: ComponentMeta<FilterBarProps> = {
  args: {
    drawerOpen: true,
    tab: "ReviewTab",
    focus: <FilterBarFocus label="Maya + Jon" backShown onBack={() => undefined} onClear={() => undefined} />,
    items: [
      { filterKey: "RangeKey", control: <Segments aria-label="Range" defaultValue="7d" options={[{ value: "today", label: "Today" }, { value: "7d", label: "7d" }, { value: "all", label: "All" }]} /> },
      { filterKey: "BoroughKey", label: "Borough", control: select("Borough") },
      { filterKey: "MembersKey", label: "Members", control: select("Members") },
      { filterKey: "OriginKey", label: "Origin", control: select("Origin") },
      { filterKey: "StateKey", label: "State", control: select("State") },
    ],
  },
  examples: { "Drawer collapsed": { drawerOpen: false } },
};
