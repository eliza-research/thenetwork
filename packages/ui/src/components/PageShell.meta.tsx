import { ntwrkBrand, peonBrand, slopBrand, friendsBrand } from "../../../core/src/generated/brandIdentity.ts";
import { privacyFor } from "../content/legal/index.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import { LegalDocument } from "./LegalDocument.tsx";
import { NotFoundView } from "./NotFoundView.tsx";
import type { PageShellProps } from "./PageShell.tsx";

export const meta: ComponentMeta<PageShellProps> = {
  args: { brand: slopBrand, children: <NotFoundView name={slopBrand.name} /> },
  examples: {
    Network: { brand: ntwrkBrand, children: <NotFoundView name={ntwrkBrand.name} /> },
    Friends: { brand: friendsBrand, children: <NotFoundView name={friendsBrand.name} /> },
    Peon: { brand: peonBrand, children: <NotFoundView name={peonBrand.name} /> },
    Privacy: { brand: slopBrand, children: <LegalDocument app="Slop" text={privacyFor.Slop} /> },
  },
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const hrefs = [...canvasElement.querySelectorAll("footer a")].map((a) => a.getAttribute("href"));
      if (hrefs.join(" ") !== "/privacy /terms") throw new Error(`The footer links ${hrefs.join(" ")}.`);
      if (!canvasElement.querySelector("main#main")) throw new Error("The skip link has no target.");
    },
  },
};
