import { ntwrkBrand } from "../../../core/src/generated/brandIdentity.ts";
import { landingLinks } from "../brand/landing.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { StatusLineProps } from "./StatusLine.tsx";

export const meta: ComponentMeta<StatusLineProps> = {
  args: { status: "AgentOpening", agent: "Claude", links: landingLinks(ntwrkBrand.app, { skillVersion: "1.0.0", textLine: "+15555550100" }) },
};
