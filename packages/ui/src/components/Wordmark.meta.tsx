import { friendsBrand, ntwrkBrand, peonBrand, slopBrand } from "../../../core/src/generated/brandIdentity.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { WordmarkProps } from "./Wordmark.tsx";

export const meta: ComponentMeta<WordmarkProps> = {
  args: { brand: ntwrkBrand },
  examples: { "slop.date": { brand: slopBrand }, "peon.biz": { brand: peonBrand }, "friends.help": { brand: friendsBrand } },
};
