import { ntwrkBrand } from "../../../core/src/generated/brandIdentity.ts";
import { landingLinks } from "../brand/landing.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { MessagesButtonProps } from "./MessagesButton.tsx";

export const meta: ComponentMeta<MessagesButtonProps> = {
  args: { href: landingLinks(ntwrkBrand.app, { skillVersion: "1.0.0", textLine: "+15555550100" }).messagesHref },
};
