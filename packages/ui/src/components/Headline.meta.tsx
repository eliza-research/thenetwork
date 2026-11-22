import { ntwrkBrand, slopBrand } from "../../../core/src/generated/brandIdentity.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { HeadlineProps } from "./Headline.tsx";

export const meta: ComponentMeta<HeadlineProps> = {
  args: { lead: ntwrkBrand.headlineLead, mark: ntwrkBrand.headlineMark, tail: ntwrkBrand.headlineTail },
  examples: { Long: { lead: slopBrand.headlineLead, mark: slopBrand.headlineMark, tail: slopBrand.headlineTail } },
};
